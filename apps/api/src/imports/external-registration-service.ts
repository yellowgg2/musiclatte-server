import { randomUUID } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import type { ManagementDatabase } from '../storage/database.js';
import {
  createExternalWatchRepository,
  type ExternalFileFingerprint,
} from '../storage/external-watch-repository.js';
import type { SubsonicClient } from '../subsonic/client.js';
import { createExactPathLookup, ExactPathFailure } from '../subsonic/exact-path-lookup.js';
import { createScanCoordinator } from '../subsonic/scan-coordinator.js';
import { resolveFileKey } from './file-keys.js';
import { validateRelativeKey } from './policy.js';

type Failure =
  | 'registration_pending'
  | 'registration_timeout'
  | 'registration_upstream'
  | 'registration_path'
  | 'registration_ambiguous'
  | 'registration_cancelled'
  | 'registration_conflict';

class ExternalRegistrationFailure extends Error {
  constructor(readonly code: Failure) {
    super(code);
  }
}

function fingerprint(path: string): ExternalFileFingerprint {
  const stat = lstatSync(path, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new ExternalRegistrationFailure('registration_conflict');
  return {
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
    linkCount: Number(stat.nlink),
  };
}

export interface ExternalRegistrationOptions {
  database: ManagementDatabase;
  musicRoot: string;
  /** Fixed worker-only token client, never a request/session client. */
  scanClient: Pick<
    SubsonicClient,
    'getScanStatus' | 'startScan' | 'indexes' | 'registrationDirectory'
  >;
  libraries: readonly { id: string; musicFolderId: string; relativeRoot: string }[];
  clock: () => number;
  timeoutMs?: number;
  pollMs?: number;
  retryMs?: number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** Bounded external-target registration through the shared Gonic scan coordinator. */
export function createExternalRegistrationService(options: ExternalRegistrationOptions) {
  const { database, scanClient } = options;
  const db = database.connection;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const pollMs = options.pollMs ?? 1000;
  const retryMs = options.retryMs ?? 30_000;
  for (const value of [timeoutMs, pollMs, retryMs])
    if (!Number.isSafeInteger(value) || value <= 0 || value > 3_600_000)
      throw new Error('invalid_external_registration_config');
  if (pollMs > timeoutMs) throw new Error('invalid_external_registration_config');
  const libraries = new Map(
    options.libraries.map((library) => {
      validateRelativeKey(library.relativeRoot);
      if (!library.id || !library.musicFolderId)
        throw new Error('invalid_external_registration_config');
      return [library.id, { ...library }] as const;
    }),
  );
  if (libraries.size !== options.libraries.length)
    throw new Error('invalid_external_registration_config');
  const now = () => {
    const at = options.clock();
    if (!Number.isSafeInteger(at) || at < 0 || !Number.isSafeInteger(at + 10_000_000))
      throw new Error('invalid_external_registration_clock');
    return at;
  };
  const coordinator = createScanCoordinator({ database, clock: now, timeoutMs, retryMs });
  const repository = createExternalWatchRepository({ database, clock: now });
  const wait = options.wait ?? ((ms, signal) => delay(ms, undefined, { signal }));

  const runOnce = async (external?: AbortSignal): Promise<boolean> => {
    if (external?.aborted) return false;
    const owner = randomUUID();
    const acquired = database.transaction(() => {
      const at = now();
      const importPending = db
        .prepare(
          `SELECT 1 FROM import_items i
           LEFT JOIN registration_attempts r ON r.item_id=i.id
           WHERE i.stage='registering'
             AND (i.lease_owner IS NULL OR i.lease_expires_at<=?)
             AND coalesce(r.next_attempt_at,0)<=?
           LIMIT 1`,
        )
        .get(at, at);
      return !importPending && coordinator.available() && coordinator.acquire(owner);
    });
    if (!acquired) return false;
    const observations = repository.claimObservations({
      workerId: owner,
      leaseDurationMs: timeoutMs + 1000,
      states: ['registering'],
      limit: 50,
    });
    if (!observations.length) {
      coordinator.release(owner, false);
      return false;
    }

    const controller = new AbortController();
    const abort = () => controller.abort();
    external?.addEventListener('abort', abort, { once: true });
    if (external?.aborted) abort();
    const timer = setTimeout(abort, timeoutMs);
    const signal = controller.signal;
    const deadline = now() + timeoutMs;
    const owned = () => {
      signal.throwIfAborted();
      if (now() >= deadline || !coordinator.owns(owner))
        throw new ExternalRegistrationFailure('registration_timeout');
    };
    const keyOf = (libraryId: string, relativeFileKey: string) =>
      `${libraryId}\0${relativeFileKey}`;
    const pending = new Map(
      observations.map((observation) => [
        keyOf(observation.libraryId, observation.relativeFileKey),
        observation,
      ]),
    );
    const failures = new Map<string, Failure>();

    try {
      owned();
      if (!(await scanClient.getScanStatus({ signal })).scanning) {
        owned();
        await scanClient.startScan({ signal });
      }
      for (let round = 0; round <= Math.ceil(timeoutMs / pollMs) && pending.size; round += 1) {
        owned();
        if (!(await scanClient.getScanStatus({ signal })).scanning) {
          const lookup = createExactPathLookup(scanClient, { signal, assertOwned: owned });
          for (const [key, observation] of pending) {
            try {
              owned();
              const library = libraries.get(observation.libraryId);
              if (!library) throw new ExternalRegistrationFailure('registration_path');
              const songId = await lookup(library, observation.relativeFileKey);
              const verifyFile = () => {
                try {
                  const path = resolveFileKey(options.musicRoot, observation.relativeFileKey);
                  if (JSON.stringify(fingerprint(path)) !== JSON.stringify(observation.fingerprint))
                    throw new Error();
                } catch {
                  throw new ExternalRegistrationFailure('registration_conflict');
                }
              };
              verifyFile();
              repository.completeRegistration({
                libraryId: observation.libraryId,
                relativeFileKey: observation.relativeFileKey,
                workerId: owner,
                generation: observation.generation,
                fingerprint: observation.fingerprint!,
                eventId: observation.eventId!,
                mediaLinkId: observation.mediaLinkId!,
                songId,
                verifyFile,
              });
              pending.delete(key);
            } catch (error) {
              failures.set(
                key,
                error instanceof ExternalRegistrationFailure || error instanceof ExactPathFailure
                  ? error.code
                  : error instanceof Error && error.message === 'External registration conflict'
                    ? 'registration_conflict'
                    : 'registration_upstream',
              );
            }
          }
        }
        if (pending.size) await wait(Math.min(pollMs, Math.max(1, deadline - now())), signal);
      }
    } catch (error) {
      const failure: Failure = external?.aborted
        ? 'registration_cancelled'
        : signal.aborted || now() >= deadline
          ? 'registration_timeout'
          : error instanceof ExternalRegistrationFailure
            ? error.code
            : 'registration_upstream';
      for (const key of pending.keys()) if (!failures.has(key)) failures.set(key, failure);
    } finally {
      clearTimeout(timer);
      external?.removeEventListener('abort', abort);
      const at = now();
      for (const [key, observation] of pending) {
        try {
          repository.retryRegistration({
            libraryId: observation.libraryId,
            relativeFileKey: observation.relativeFileKey,
            workerId: owner,
            generation: observation.generation,
            failureCode: failures.get(key) ?? 'registration_timeout',
            nextAttemptAt:
              at + Math.min(3_600_000, retryMs * 2 ** Math.min(7, observation.attempt - 1)),
          });
        } catch {
          // A lost generation is already owned by a later worker; never overwrite it.
        }
      }
      coordinator.release(owner, pending.size > 0);
    }
    return true;
  };

  return { runOnce };
}
