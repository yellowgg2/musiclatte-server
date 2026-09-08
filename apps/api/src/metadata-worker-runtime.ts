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

export { readMetadataWorkerConfig } from './metadata/runtime-config.js';

export function createMetadataScheduler(tasks: {
  recover(signal: AbortSignal): Promise<boolean>;
  file(signal: AbortSignal): Promise<boolean>;
  reflect(signal: AbortSignal): Promise<boolean>;
}) {
  let running = false;
  return {
    async cycle(signal: AbortSignal): Promise<boolean> {
      if (running || signal.aborted) return false;
      running = true;
      let worked = false;
      try {
        for (const work of [tasks.recover, tasks.file, tasks.reflect]) {
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
    const account = async (work: MetadataWork) => {
      const stored = sessions.findByIdHash(work.actorSessionId);
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
        !sessions.findByIdHash(work.actorSessionId)
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
            'SELECT relative_key,digest FROM metadata_cover_uploads WHERE id=? AND identity_key=? AND library_id=?',
          )
          .get(work.patch.cover.uploadId, work.identityKey, work.libraryId);
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
    const scheduler = createMetadataScheduler({
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
