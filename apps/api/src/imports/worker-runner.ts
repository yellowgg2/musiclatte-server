import { createRegistrationService, type RegistrationOptions } from './registration-service.js';
import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { join, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { ManagementDatabase } from '../storage/database.js';
import { createDownloader, type Engine } from './downloader.js';
import { createWorkerLedger } from './worker-state.js';
import { prepareMediaFileKey, publishMediaFile, resolveFileKey } from './file-keys.js';

export interface WorkerOptions {
  database: ManagementDatabase;
  registration?: Omit<RegistrationOptions, 'database' | 'clock'>;
  clock: () => number;
  musicRoot: string;
  stagingRoot: string;
  libraryRoot: (libraryId: string) => string;
  acquireEngine: (sourceId: string) => Promise<Engine>;
  ffprobe: string;
  leaseDurationMs: number;
  timeoutMs: number;
  /** Optional boundary observer; a thrown error suspends work for durable recovery. */
  checkpoint?: (stage: string) => void;
  logger?: (event: Record<string, string>) => void;
}
const failures = new Set([
  'invalid_metadata',
  'invalid_media',
  'file_conflict',
  'invalid_file_key',
  'download_failed',
  'process_aborted',
  'process_output_limit',
  'process_spawn_failed',
  'process_cleanup_failed',
  'publish_failed',
  'publish_uncertain',
  'worker_interrupted',
  'invalid_engine',
]);
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

/** One serial worker. Construction is inert; deployment owns engine provision and process activation. */
export function createWorkerRunner(options: WorkerOptions) {
  for (const value of [options.leaseDurationMs, options.timeoutMs])
    if (!Number.isSafeInteger(value) || value < 50 || value > 86_400_000)
      throw new Error('invalid_worker_config');
  resolveFileKey(options.musicRoot, '.worker-root-probe');
  resolveFileKey(options.stagingRoot, '.worker-root-probe');
  if (
    options.musicRoot === options.stagingRoot ||
    options.musicRoot.startsWith(options.stagingRoot + sep) ||
    options.stagingRoot.startsWith(options.musicRoot + sep)
  )
    throw new Error('invalid_worker_config');
  const owner = randomUUID();
  const ledger = createWorkerLedger(
    options.database,
    options.clock,
    owner,
    options.leaseDurationMs,
  );
  const downloader = createDownloader(options);
  const registration = options.registration
    ? createRegistrationService({
        ...options.registration,
        database: options.database,
        clock: options.clock,
      })
    : undefined;
  let busy = false;
  let stopping = false;
  let active: AbortController | undefined;
  const cleanup = (keys: string[]) => {
    for (const key of keys) {
      // Never enumerate/delete arbitrary root contents or follow a persisted symlink.
      if (!uuid.test(key)) throw new Error('worker_cleanup_failed');
      resolveFileKey(options.stagingRoot, '.worker-root-probe');
      const path = join(options.stagingRoot, key);
      const stat = lstatSync(path, { throwIfNoEntry: false });
      if (!stat) {
        ledger.cleaned(key);
        continue;
      }
      if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path)
        throw new Error('worker_cleanup_failed');
      rmSync(path, { recursive: true });
      ledger.cleaned(key);
    }
  };
  const cleanupCompleted = () => {
    const rows = options.database.connection
      .prepare(
        "SELECT a.staging_key FROM import_attempts a JOIN import_items i ON i.id=a.item_id WHERE a.cleaned_at IS NULL AND i.stage IN ('registering','ready','duplicate','failed','cancelled') AND i.lease_owner IS NULL",
      )
      .all();
    cleanup(rows.map((row) => String(row.staging_key)));
  };
  const runOnce = async (): Promise<boolean> => {
    if (busy || stopping) return false;
    busy = true;
    let timer: NodeJS.Timeout | undefined;
    let crashed = false;
    let itemId: string | undefined;
    let finalized = false;
    let publication = false;
    let jobId: string | undefined;
    const checkpoint = (stage: string) => {
      const event: Record<string, string> = { stage };
      if (itemId && uuid.test(itemId)) event.itemId = itemId;
      if (jobId && uuid.test(jobId)) event.jobId = jobId;
      try {
        options.logger?.(event);
      } catch {
        /* Logging cannot change worker state. */
      }
      try {
        options.checkpoint?.(stage);
      } catch (error) {
        crashed = true;
        throw error;
      }
    };
    try {
      cleanupCompleted();
      const claim = ledger.claim();
      if (!claim) {
        if (!registration) return false;
        active = new AbortController();
        return await registration.runOnce(active.signal);
      }
      const { job, item, recovering } = claim;
      itemId = item.id;
      jobId = job.id;
      publication = item.stage === 'publishing';
      active = new AbortController();
      const signal = active.signal;
      const check = () => {
        ledger.heartbeat(item.id);
        if (!publication && (stopping || ledger.imports.getJob(job.id)?.cancelRequestedAt !== null))
          active?.abort();
      };
      check();
      timer = setInterval(
        () => {
          try {
            check();
          } catch {
            active?.abort();
          }
        },
        Math.max(10, Math.min(100, Math.floor(options.leaseDurationMs / 3))),
      );
      checkpoint('claimed');
      if (recovering && !publication) {
        cleanup(ledger.stagingKeys(item.id));
        ledger.finish(item.id, job.cancelRequestedAt !== null, 'worker_interrupted');
        finalized = true;
        return true;
      }
      if (!publication && signal.aborted) {
        cleanup(ledger.stagingKeys(item.id));
        ledger.finish(item.id, job.cancelRequestedAt !== null, 'worker_interrupted');
        finalized = true;
        return true;
      }
      let intent = ledger.intent(item.id);
      if (!intent) {
        const existing = ledger.findSource(job.libraryId, item.sourceId);
        if (existing) {
          await downloader.validateFile(options.musicRoot, existing.fileKey, item.sourceId, signal);
          ledger.assertOwned(item.id);
          intent = ledger.newIntent(existing.fileKey, `${randomUUID()}/audio.mp3`, true);
          ledger.saveIntent(item.id, intent);
          publication = true;
        } else {
          const stagingKey = randomUUID();
          ledger.startAttempt(item.id, stagingKey);
          mkdirSync(join(options.stagingRoot, stagingKey), { mode: 0o700 });
          const acquired = await new Promise<Engine>((resolve, reject) => {
            let settled = false;
            const finish = (result: { engine: Engine } | { error: unknown }) => {
              if (settled) return;
              settled = true;
              clearTimeout(timeout);
              signal.removeEventListener('abort', abort);
              if ('engine' in result) resolve(result.engine);
              else reject(result.error);
            };
            const abort = () => finish({ error: new Error('worker_interrupted') });
            const timeout = setTimeout(abort, options.timeoutMs);
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort();
            else
              Promise.resolve()
                .then(() => options.acquireEngine(item.sourceId))
                .then(
                  (engine) => finish({ engine }),
                  (error) => finish({ error }),
                );
          });
          const engine = Object.freeze({
            version: acquired.version,
            executable: acquired.executable,
          });
          ledger.engine(item.id, engine.version);
          signal.throwIfAborted();
          const artifact = await downloader.run(
            item.sourceId,
            engine,
            stagingKey,
            signal,
            (stage, metadata) => {
              check();
              signal.throwIfAborted();
              ledger.advance(item.id, stage, metadata);
              checkpoint(stage);
            },
          );
          check();
          signal.throwIfAborted();
          const fileKey = prepareMediaFileKey(options.musicRoot, {
            relativeRoot: options.libraryRoot(job.libraryId),
            channelName: artifact.metadata.channel,
            channelId: artifact.metadata.channelId,
            title: artifact.metadata.title,
            videoId: item.sourceId,
          });
          // Existing exact files are verified before recording whether this is a duplicate.
          const target = resolveFileKey(options.musicRoot, fileKey);
          const exists = Boolean(lstatSync(target, { throwIfNoEntry: false }));
          if (exists)
            await downloader.validateFile(options.musicRoot, fileKey, item.sourceId, signal);
          check();
          signal.throwIfAborted();
          intent = ledger.newIntent(fileKey, artifact.fileKey, exists);
          ledger.saveIntent(item.id, intent);
          publication = true;
        }
        checkpoint('intent');
      }
      ledger.assertOwned(item.id);
      const result = await publishMediaFile({
        musicRoot: options.musicRoot,
        stagingRoot: options.stagingRoot,
        stagedFileKey: intent.stagingKey,
        pendingToken: intent.eventId,
        commitIdentity: (identity) => ledger.recordIdentity(item.id, identity),
        checkpoint,
        fileKey: intent.fileKey,
        videoId: item.sourceId,
        inspectAudio: (file) => downloader.inspectAudio(file, signal),
        beforeCommit: () => {
          ledger.assertOwned(item.id);
          signal.throwIfAborted();
        },
      });
      checkpoint('published');
      ledger.assertOwned(item.id);
      // New durable intent + verified exact file on recovery is the same publication receipt.
      const identity = lstatSync(resolveFileKey(options.musicRoot, intent.fileKey));
      const duplicate =
        intent.disposition === 'duplicate' ||
        (result === 'duplicate_candidate' && !ledger.ownsPublishedFile(item.id, identity));
      ledger.complete(item.id, duplicate);
      finalized = true;
      checkpoint('recorded');
      return true;
    } catch (error) {
      if (crashed) throw error;
      const failure =
        error instanceof Error && failures.has(error.message) ? error.message : 'download_failed';
      try {
        options.logger?.({ stage: 'failed', failureCode: failure });
      } catch {
        /* Logger isolation. */
      }
      if (itemId) {
        ledger.assertOwned(itemId);
        // Any uncertainty after intent remains recoverable; never delete a possibly published file.
        const intent = ledger.intent(itemId);
        const definitelyUnpublished =
          publication &&
          intent !== null &&
          !lstatSync(resolveFileKey(options.musicRoot, intent.fileKey), {
            throwIfNoEntry: false,
          }) &&
          failure !== 'publish_uncertain';
        if (!publication || definitelyUnpublished) {
          cleanup(ledger.stagingKeys(itemId));
          const cancelled =
            jobId !== undefined && ledger.imports.getJob(jobId)?.cancelRequestedAt !== null;
          ledger.finish(itemId, cancelled, failure);
          finalized = true;
        }
      }
      return itemId !== undefined;
    } finally {
      if (timer) clearInterval(timer);
      active = undefined;
      if (!crashed && finalized && itemId) cleanup(ledger.stagingKeys(itemId));
      ledger.stop();
      busy = false;
    }
  };
  return {
    runOnce,
    async run(signal: AbortSignal) {
      const stop = () => {
        stopping = true;
        active?.abort();
      };
      // Only the explicitly started worker loop owns this temporary listener.
      process.on('SIGTERM', stop);
      signal.addEventListener('abort', stop, { once: true });
      if (signal.aborted) stop();
      try {
        while (!stopping) {
          if (!(await runOnce())) {
            ledger.idle();
            await delay(50, undefined, { signal }).catch(() => {});
          }
        }
      } finally {
        process.off('SIGTERM', stop);
        signal.removeEventListener('abort', stop);
        ledger.stop();
      }
    },
  };
}
