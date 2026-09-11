import { readAutomationConfig } from './automation/config.js';
import { configuredMediaFence, createCurationScheduler } from './curation/runtime.js';
import { createMediaPublicationLedger } from './metadata/media-fence.js';
import { createBackupPreviewIndexer } from './metadata/backup-preview.js';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { loadKey } from './security/key-store.js';
import { createCredentialVault } from './security/credential-vault.js';
import { openDatabase, validateSchema } from './storage/database.js';
import { createSessionRepository } from './storage/session-repository.js';
import { createMetadataRepository } from './storage/metadata-repository.js';
import { createMetadataFileStore } from './metadata/file-store.js';
import { createMetadataHelper } from './metadata/helper-client.js';
import { createMetadataWorker, type MetadataWork } from './metadata/worker.js';
import { createMetadataReflector } from './metadata/reflection.js';
import { createGonicCoverCache } from './metadata/gonic-cover-cache.js';
import { createMetadataRevision } from './metadata/revision.js';
import { metadataVerifiedProfile } from './metadata/api-config.js';
import { createMetadataCoverVerifier } from './metadata/cover-verifier.js';
import { metadataSelfTest } from './metadata/self-test.js';
import { canEditMetadata, canRestoreMetadata } from './metadata/policy.js';
import {
  metadataDirectory,
  readMetadataWorkerConfig,
  type MetadataEnvironment,
} from './metadata/runtime-config.js';
import { createSubsonicClient } from './subsonic/client.js';
import { createMetadataJobAuthorizer } from './auth/metadata-job-authorizer.js';
import { createOrganizationRepository } from './storage/organization-repository.js';
import { createOrganizationFileStore } from './metadata/organization-file-store.js';
import { createOrganizationWorker } from './metadata/organization-worker.js';
import { captureMetadataReferences } from './metadata/reference-check.js';
import { createMetadataFileAccess } from './metadata/file-access.js';
import { createOrganizationRegistration } from './metadata/organization-registration.js';
import { createReferenceMigration } from './metadata/reference-migration.js';
import { createCurationRepository } from './storage/curation-repository.js';
import { curationSnapshot, reconcileVerifiedSnapshot } from './curation/reconciliation.js';

export { readMetadataWorkerConfig } from './metadata/runtime-config.js';

export function createMetadataScheduler(tasks: {
  recover(signal: AbortSignal): Promise<boolean>;
  organize?(signal: AbortSignal): Promise<boolean>;
  file(signal: AbortSignal): Promise<boolean>;
  reflect(signal: AbortSignal): Promise<boolean>;
  inventory?(signal: AbortSignal): Promise<boolean>;
}) {
  let running = false;
  return {
    async cycle(signal: AbortSignal): Promise<boolean> {
      if (running || signal.aborted) return false;
      running = true;
      let worked = false;
      try {
        for (const work of [
          tasks.recover,
          ...(tasks.organize ? [tasks.organize] : []),
          tasks.file,
          tasks.reflect,
          ...(tasks.inventory ? [tasks.inventory] : []),
        ]) {
          if (signal.aborted) break;
          worked = (await work(signal)) || worked;
        }
        return worked;
      } finally {
        running = false;
      }
    },
  };
}
/** Read-only health inspection cannot initialize keys, execute tools, or refresh its own receipt. */
export function metadataWorkerHealth(env: MetadataEnvironment, now = Date.now()): boolean {
  let db: DatabaseSync | undefined;
  try {
    if (env.METADATA_ENABLED !== 'true') return false;
    const management = metadataDirectory(env.MANAGEMENT_DIRECTORY, true, false);
    metadataDirectory(env.METADATA_DATA_ROOT, true);
    metadataDirectory(env.METADATA_UPLOAD_ROOT, true);
    const path = join(management, 'management.sqlite');
    if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) return false;
    db = new DatabaseSync(path, { readOnly: true, timeout: 100 });
    validateSchema(db);
    const row = db
      .prepare('SELECT status,heartbeat_at FROM metadata_worker_state WHERE singleton=1')
      .get();
    const age = typeof row?.heartbeat_at === 'number' ? now - row.heartbeat_at : -1;
    return !!row && ['idle', 'working'].includes(String(row.status)) && age >= 0 && age < 30000;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

export async function runMetadataWorker(env: MetadataEnvironment, external: AbortSignal) {
  const config = readMetadataWorkerConfig(env);
  if (!config.enabled) return;
  if (process.versions.node !== '24.20.0' || env.METADATA_WRITE_PROFILE !== metadataVerifiedProfile)
    throw new Error('unsupported_metadata_profile');
  const automation = readAutomationConfig(env);
  const fence =
    automation.enabled && (automation.curation || automation.organization)
      ? configuredMediaFence(env, { ...config, timeoutMs: config.policy.limits.timeoutMs }, [
          config.privateRoot,
          config.uploadRoot,
        ])
      : undefined;
  const key = loadKey(config.keyPath);
  const database = openDatabase(config.management);
  const db = database.connection;
  const stop = new AbortController();
  const signal = AbortSignal.any([external, stop.signal]);
  const workerId = randomUUID();
  let timer: ReturnType<typeof setInterval> | undefined;
  let healthy = false;
  let owns = false;
  const heartbeat = () => {
    const active = db
      .prepare('SELECT item_id FROM metadata_file_locks WHERE owner=? AND expires_at>? LIMIT 1')
      .get(workerId, Date.now());
    const result = db
      .prepare(
        'UPDATE metadata_worker_state SET status=?,heartbeat_at=?,active_item_id=? WHERE singleton=1 AND worker_id=?',
      )
      .run(
        healthy ? (active ? 'working' : 'idle') : 'unhealthy',
        Date.now(),
        healthy && active ? String(active.item_id) : null,
        workerId,
      );
    if (Number(result.changes) !== 1) {
      stop.abort();
      throw new Error('worker_interrupted');
    }
  };
  try {
    database.transaction(() => {
      const row = db
        .prepare('SELECT worker_id,heartbeat_at FROM metadata_worker_state WHERE singleton=1')
        .get()!;
      if (row.worker_id !== null && Number(row.heartbeat_at) > Date.now() - 30000)
        throw new Error('metadata_worker_busy');
      db.prepare(
        "UPDATE metadata_worker_state SET worker_id=?,status='unhealthy',heartbeat_at=?,active_item_id=NULL WHERE singleton=1",
      ).run(workerId, Date.now());
      owns = true;
    });
    timer = setInterval(() => {
      try {
        heartbeat();
      } catch {
        stop.abort();
      }
    }, 1000);
    const helper = createMetadataHelper({
      musicRoot: config.musicRoot,
      python: config.python,
      helperPath: join(dirname(config.helperPath), 'metadata.py'),
      ffmpeg: config.ffmpeg,
      ffprobe: config.ffprobe,
      maxFileBytes: config.policy.limits.maxFileBytes,
      timeoutMs: config.policy.limits.timeoutMs,
    });
    const fileStore = createMetadataFileStore({
      ...(fence
        ? {
            lockRoot: env.MEDIA_FENCE_ROOT!,
            publications: createMediaPublicationLedger(database, Date.now),
          }
        : {}),
      ...config,
      helperPath: config.transactionHelper,
      timeoutMs: config.policy.limits.timeoutMs,
      maxFileBytes: config.policy.limits.maxFileBytes,
    });
    await metadataSelfTest(config, signal);
    const salt = randomBytes(16).toString('hex');
    const scanClient = createSubsonicClient({
      upstream: config.upstream,
      timeoutMs: 5000,
      proof: {
        username: config.credential.username,
        s: salt,
        t: createHash('md5')
          .update(config.credential.password + salt)
          .digest('hex'),
      },
    });
    const ping = await scanClient.ping({ signal });
    if (
      ping.serverType !== 'gonic' ||
      ping.serverVersion?.replace(/^v/, '') !== '0.22.0' ||
      !(await scanClient.currentUser({ signal })).adminRole
    )
      throw new Error('unsupported_metadata_profile');
    const sessions = createSessionRepository({
      database,
      vault: createCredentialVault(key),
      maxAgeMs: 1,
      clock: Date.now,
    });
    const repository = createMetadataRepository({ database, clock: Date.now });
    const revisions = createMetadataRevision(key);
    const grants = createMetadataJobAuthorizer({ database, vault: createCredentialVault(key) });
    const publications = createMediaPublicationLedger(database, Date.now);
    const fileAccess = createMetadataFileAccess({
      musicRoot: config.musicRoot,
      python: config.python,
      helperPath: join(dirname(config.helperPath), 'file_access.py'),
      timeoutMs: config.policy.limits.timeoutMs,
      maxFileBytes: config.policy.limits.maxFileBytes,
    });
    const account = async (work: MetadataWork) => {
      const credential = () =>
        work.actorTokenId
          ? grants.authorizeAcceptedWork(work)
          : work.actorSessionId
            ? sessions.findByIdHash(work.actorSessionId)
            : null;
      const stored = credential();
      if (!stored || stored.policyRevision !== work.policyRevision)
        throw new Error('permission_changed');
      const signed = createHmac('sha256', key)
        .update(
          JSON.stringify([
            'musiclatte-auth',
            1,
            'metadata-identity',
            JSON.stringify([stored.instanceId, stored.username]),
          ]),
        )
        .digest('hex');
      if (signed !== work.identityKey) throw new Error('permission_changed');
      const client = createSubsonicClient({
        upstream: config.upstream,
        timeoutMs: 5000,
        proof: stored.proof,
      });
      const user = await client.currentUser({ signal });
      const folders = (await client.folders({ signal })).map((folder) => folder.id);
      const library = config.policy.libraries.find((entry) => entry.id === work.libraryId);
      const { song, path } = await client.recentSong(work.trackId, { signal });
      const binding = db
        .prepare('SELECT revision,gonic_song_id,relative_file_key FROM media_links WHERE id=?')
        .get(work.mediaLinkId);
      if (
        !library ||
        user.username !== stored.username ||
        !folders.includes(library.musicFolderId) ||
        song.id !== work.trackId ||
        song.isDir ||
        path !== work.key ||
        !work.key.startsWith(`${library.relativeRoot}/`) ||
        !binding ||
        binding.revision !== work.bindingRevision ||
        binding.gonic_song_id !== work.trackId ||
        binding.relative_file_key !== work.key ||
        revisions.fileIdentity({ libraryId: work.libraryId, relativeFileKey: work.key }) !==
          work.fileIdentity ||
        !credential()
      )
        throw new Error('permission_changed');
      return { client, user, folders, library };
    };
    const authorize = async (work: MetadataWork) => {
      const { user, folders, library } = await account(work);
      if (
        work.restore
          ? !canRestoreMetadata(config.policy, { ...user, musicFolderIds: folders }, work.libraryId)
          : !canEditMetadata(config.policy, user.username, work.libraryId)
      )
        throw new Error('permission_changed');
      let cover;
      if (work.patch.cover?.op === 'set') {
        const row = db
          .prepare(
            'SELECT relative_key,digest FROM metadata_cover_uploads WHERE id=? AND identity_key=? AND library_id=? AND actor_token_id IS ?',
          )
          .get(work.patch.cover.uploadId, work.identityKey, work.libraryId, work.actorTokenId);
        if (!row || !/^[a-f0-9-]{36}\.upload$/.test(String(row.relative_key)))
          throw new Error('invalid_cover');
        const root = lstatSync(config.uploadRoot, { bigint: true });
        cover = {
          root: config.uploadRoot,
          key: String(row.relative_key),
          expectedDigest: String(row.digest),
          rootIdentity: { device: String(root.dev), inode: String(root.ino) },
        };
      }
      return { preserveOwnership: library.preserveOwnership, ...(cover ? { cover } : {}) };
    };
    const reflector = createMetadataReflector({
      database,
      repository,
      scanClient,
      libraries: config.policy.libraries,
      clock: Date.now,
      accountClient: async (work) => (await account(work)).client,
      fileSnapshot: (work) => helper.read({ key: work.key, signal }),
      ...(config.coverCacheRoot
        ? { refreshCoverCache: createGonicCoverCache(config.coverCacheRoot) }
        : {}),
      coverMatches: createMetadataCoverVerifier({
        database,
        privateRoot: config.privateRoot,
        projector: config.projector,
        helper,
        signal,
      }),
    });
    const worker = createMetadataWorker({
      repository,
      fileStore,
      workerId,
      leaseDurationMs: 30000,
      authorize,
      revision: (work, digest) =>
        revisions.fileRevision({ libraryId: work.libraryId, relativeFileKey: work.key, digest }),
      beforeWrite: reflector.beforeWrite,
      reflect: (claim, work) => reflector.reflect(claim, work, signal),
    });
    const curation =
      automation.enabled && automation.curation && fence
        ? createCurationScheduler({
            database,
            clock: Date.now,
            signingKey: key,
            policy: automation.curation,
            libraries: config.policy.libraries,
            source: scanClient,
            helper,
            fence,
            runtime: {
              ...config,
              timeoutMs: config.policy.limits.timeoutMs,
              maxFileBytes: config.policy.limits.maxFileBytes,
            },
          })
        : undefined;
    const organizationPolicy = automation.enabled ? automation.organization : undefined;
    const organizationRepository = createOrganizationRepository({ database, clock: Date.now });
    const organizationAccount = async (
      claim: Parameters<typeof organizationRepository.readBaseline>[0],
    ) => {
      if (!organizationPolicy) throw new Error('permission_changed');
      const accepted = grants.authorizeAcceptedOrganization(claim.itemId);
      if (
        accepted.intent.libraryId !== claim.libraryId ||
        accepted.intent.sourceKey !== claim.sourceKey ||
        accepted.intent.targetKey !== claim.targetKey ||
        accepted.intent.fileIdentity !== claim.fileIdentity ||
        accepted.intent.audioIdentity !== claim.audioIdentity ||
        accepted.intent.oldTrackId !== claim.oldTrackId
      )
        throw new Error('permission_changed');
      const client = createSubsonicClient({
        upstream: config.upstream,
        timeoutMs: 5000,
        proof: accepted.proof,
      });
      const user = await client.currentUser({ signal });
      const folders = (await client.folders({ signal })).map((folder) => folder.id);
      const library = config.policy.libraries.find((entry) => entry.id === claim.libraryId);
      const account = organizationPolicy.accounts.find(
        (entry) => entry.username === accepted.username,
      );
      if (
        user.username !== accepted.username ||
        !library ||
        !account ||
        !folders.includes(library.musicFolderId) ||
        !canEditMetadata(config.policy, accepted.username, claim.libraryId)
      )
        throw new Error('permission_changed');
      return { username: accepted.username, client };
    };
    const organizationWorker =
      organizationPolicy && fence
        ? createOrganizationWorker({
            repository: organizationRepository,
            fileStore: createOrganizationFileStore({
              musicRoot: config.musicRoot,
              python: config.python,
              helperPath: join(dirname(config.helperPath), 'organization_move.py'),
              accessHelperPath: join(dirname(config.helperPath), 'file_access.py'),
              timeoutMs: config.policy.limits.timeoutMs,
              maxFileBytes: config.policy.limits.maxFileBytes,
              fence,
              fileIdentity: (libraryId, relativeFileKey) =>
                revisions.fileIdentity({ libraryId, relativeFileKey }),
              inspectAudio: async (relativeFileKey) =>
                curationSnapshot(await helper.read({ key: relativeFileKey, signal })).audioIdentity,
              assertAvailable: (fileIdentity) => publications.assertAvailable(fileIdentity),
            }),
            fileIdentity: (libraryId, relativeFileKey) =>
              revisions.fileIdentity({ libraryId, relativeFileKey }),
            authorize: async (claim) => ({ client: (await organizationAccount(claim)).client }),
            captureReferences: (client, trackId) =>
              captureMetadataReferences(
                client as ReturnType<typeof createSubsonicClient>,
                trackId,
                signal,
              ),
          })
        : undefined;
    const organizationCurationRepository =
      organizationPolicy && automation.enabled && automation.curation
        ? createCurationRepository({
            database,
            clock: Date.now,
            cursorKey: key,
            limits: automation.curation.limits,
          })
        : undefined;
    const organizationRegistration =
      organizationPolicy && organizationCurationRepository
        ? createOrganizationRegistration({
            database,
            clock: Date.now,
            timeoutMs: config.policy.limits.timeoutMs,
            pollMs: 1000,
            retryMs: 30000,
            wait: (ms, abort) => delay(ms, undefined, { signal: abort }),
            scanClient,
            libraries: config.policy.libraries,
            repository: organizationRepository,
            inspect: async (relativeFileKey) => {
              const snapshot = await helper.read({ key: relativeFileKey, signal });
              return { snapshot, audioIdentity: curationSnapshot(snapshot).audioIdentity };
            },
            sourceAbsent: async (relativeFileKey) => {
              try {
                await fileAccess.inspect(relativeFileKey, signal);
                return false;
              } catch (error) {
                return error instanceof Error && error.message === 'file_unavailable';
              }
            },
            fileIdentity: (libraryId, relativeFileKey) =>
              revisions.fileIdentity({ libraryId, relativeFileKey }),
            revision: (libraryId, relativeFileKey, digest) =>
              revisions.fileRevision({ libraryId, relativeFileKey, digest }),
            reconcile: (trackRef, snapshot, revision) =>
              reconcileVerifiedSnapshot(
                organizationCurationRepository,
                trackRef,
                snapshot,
                revision,
                [],
              ),
          })
        : undefined;
    const organizationReferences = organizationPolicy
      ? createReferenceMigration({
          repository: organizationRepository,
          authorize: organizationAccount,
        })
      : undefined;
    const scheduler = createMetadataScheduler({
      ...(curation ? { inventory: (abort: AbortSignal) => curation.cycle(abort) } : {}),
      ...(organizationWorker
        ? {
            organize: async () => {
              const recovery = organizationRepository.claimNext({
                workerId,
                leaseDurationMs: 30000,
                recoveryOnly: true,
              });
              if (recovery) {
                await organizationWorker.recover(recovery).catch(() => {});
                return true;
              }
              const registration = organizationRepository.claimNext({
                workerId,
                leaseDurationMs: 30000,
                registrationOnly: true,
              });
              if (registration && organizationRegistration) {
                await organizationRegistration.process(registration, signal).catch(() => {});
                return true;
              }
              const references = organizationRepository.claimNext({
                workerId,
                leaseDurationMs: 30000,
                referenceOnly: true,
              });
              if (references && organizationReferences) {
                await organizationReferences.process(references, signal).catch(() => {});
                return true;
              }
              const claim = organizationRepository.claimNext({
                workerId,
                leaseDurationMs: 30000,
                fileOnly: true,
              });
              if (!claim) return false;
              await organizationWorker.process(claim).catch(() => {});
              return true;
            },
          }
        : {}),
      recover: async (abort) => (await worker.recoverPending(abort)).processed > 0,
      file: (abort) => worker.runOnce(abort, 'file'),
      reflect: (abort) => reflector.runOnce(abort),
    });
    const backupHelper = createMetadataHelper({
      ...config,
      musicRoot: config.privateRoot,
      helperPath: join(dirname(config.helperPath), 'metadata.py'),
      maxFileBytes: config.policy.limits.maxFileBytes,
      timeoutMs: config.policy.limits.timeoutMs,
    });
    const indexBackup = createBackupPreviewIndexer({
      database,
      clock: Date.now,
      read: (key) => backupHelper.read({ key, signal }),
    });
    healthy = true;
    heartbeat();
    while (!signal.aborted) {
      await scheduler.cycle(signal);
      if (!signal.aborted) await indexBackup();
      await delay(500, undefined, { signal }).catch(() => {});
    }
  } finally {
    stop.abort();
    if (timer) clearInterval(timer);
    if (owns)
      db.prepare(
        "UPDATE metadata_worker_state SET status='stopped',worker_id=NULL,heartbeat_at=NULL,active_item_id=NULL WHERE singleton=1 AND worker_id=?",
      ).run(workerId);
    database.close();
  }
}
