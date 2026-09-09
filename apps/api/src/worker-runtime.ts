import { readAutomationConfig } from './automation/config.js';
import { configuredMediaFence } from './curation/runtime.js';
import { createMediaPublicationLedger } from './metadata/media-fence.js';
import { createMetadataFileAccess } from './metadata/file-access.js';
import { createMetadataRevision } from './metadata/revision.js';
import { loadKey } from './security/key-store.js';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { accessSync, constants, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { readImportConfig } from './imports/config.js';
import { createWorkerRunner } from './imports/worker-runner.js';
import { importHeartbeatMaxAgeMs } from './imports/import-service.js';
import { createEngineProvider } from './engine/provider.js';
import { createEngineRequestWorker } from './engine/request-worker.js';
import { openDatabase, validateSchema } from './storage/database.js';
import { createSubsonicClient } from './subsonic/client.js';

type Environment = Record<string, string | undefined>;
function canonical(path: string | undefined) {
  if (!path || !isAbsolute(path) || resolve(path) !== path || realpathSync(path) !== path)
    throw new Error();
  return path;
}
function directory(path: string | undefined, privateRoot: boolean) {
  const value = canonical(path);
  const stat = lstatSync(value);
  if (!stat.isDirectory() || (privateRoot && (stat.mode & 0o077) !== 0)) throw new Error();
  if (privateRoot && process.getuid && stat.uid !== process.getuid()) throw new Error();
  accessSync(value, constants.R_OK | constants.W_OK | constants.X_OK);
  return value;
}
/** Config probes inspect mounts and private files without opening/migrating the DB or executing tools. */
export function readWorkerConfig(env: Environment) {
  try {
    if ((env.IMPORTS_ENABLED ?? 'false') === 'false') return { enabled: false as const };
    const credentialPath = canonical(env.IMPORT_CREDENTIAL_PATH);
    const stat = lstatSync(credentialPath);
    if (
      !stat.isFile() ||
      stat.size > 8192 ||
      (stat.mode & 0o007) !== 0 ||
      (stat.mode & 0o022) !== 0
    )
      throw new Error();
    const credential: unknown = JSON.parse(readFileSync(credentialPath, 'utf8'));
    if (
      !credential ||
      typeof credential !== 'object' ||
      Array.isArray(credential) ||
      Object.keys(credential).sort().join(',') !== 'password,username' ||
      !('username' in credential) ||
      !('password' in credential) ||
      typeof credential.username !== 'string' ||
      typeof credential.password !== 'string'
    )
      throw new Error();
    const config = readImportConfig({
      ...env,
      IMPORT_WORKER_USERNAME: credential.username,
      IMPORT_WORKER_PASSWORD: credential.password,
    });
    if (!config.enabled) throw new Error();
    const management = directory(env.MANAGEMENT_DIRECTORY, true);
    const musicRoot = directory(env.IMPORT_MUSIC_ROOT, false);
    const stagingRoot = directory(env.IMPORT_STAGING_ROOT, true);
    const engineRoot = directory(env.IMPORT_ENGINE_ROOT, true);
    const roots = [management, musicRoot, stagingRoot, engineRoot];
    if (roots.some((a, i) => roots.some((b, j) => i !== j && (a === b || a.startsWith(b + sep)))))
      throw new Error();
    const upstream = new URL(env.GONIC_UPSTREAM ?? '');
    if (
      !['http:', 'https:'].includes(upstream.protocol) ||
      upstream.username ||
      upstream.password ||
      upstream.search ||
      upstream.hash
    )
      throw new Error();
    const seedPath = canonical(env.IMPORT_SEED_PATH);
    const seedVersion = env.IMPORT_SEED_VERSION ?? '';
    const seedHash = env.IMPORT_SEED_SHA256 ?? '';
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(seedVersion) || !/^[a-f0-9]{64}$/.test(seedHash))
      throw new Error();
    if (
      !lstatSync(seedPath).isFile() ||
      createHash('sha256').update(readFileSync(seedPath)).digest('hex') !== seedHash
    )
      throw new Error();
    const ffmpeg = canonical(env.IMPORT_FFMPEG_PATH ?? '/usr/bin/ffmpeg');
    const ffprobe = canonical(env.IMPORT_FFPROBE_PATH ?? '/usr/bin/ffprobe');
    for (const path of [seedPath, ffmpeg, ffprobe])
      accessSync(path, constants.R_OK | constants.X_OK);
    return {
      ...config,
      management,
      musicRoot,
      stagingRoot,
      engineRoot,
      upstream: upstream.href,
      ffmpeg,
      ffprobe,
      seed: { executable: seedPath, version: seedVersion, hash: seedHash },
    };
  } catch {
    throw new Error('invalid_worker_config');
  }
}
/** A separate read-only connection cannot create storage, migrate schemas, or refresh a stale heartbeat. */
export function workerHealth(env: Environment, now = Date.now()): boolean {
  let db: DatabaseSync | undefined;
  try {
    if (env.IMPORTS_ENABLED !== 'true') return false;
    const path = canonical(join(canonical(env.MANAGEMENT_DIRECTORY), 'management.sqlite'));
    if (!lstatSync(path).isFile()) return false;
    db = new DatabaseSync(path, { readOnly: true, timeout: 100 });
    validateSchema(db);
    const row = db.prepare('SELECT status,heartbeat_at FROM worker_state WHERE singleton=1').get();
    const age = typeof row?.heartbeat_at === 'number' ? now - row.heartbeat_at : -1;
    return (
      (row?.status === 'idle' || row?.status === 'working') &&
      age >= 0 &&
      age <= importHeartbeatMaxAgeMs
    );
  } catch {
    return false;
  } finally {
    db?.close();
  }
}
/** One process owns download/registration and an abortable serial engine maintenance loop. */
export async function runWorker(env: Environment, signal: AbortSignal) {
  const config = readWorkerConfig(env);
  if (!config.enabled) return;
  const database = openDatabase(config.management);
  const stop = new AbortController();
  const combined = AbortSignal.any([signal, stop.signal]);
  const tasks: Promise<void>[] = [];
  try {
    const provider = createEngineProvider({
      database,
      clock: Date.now,
      root: config.engineRoot,
      seed: config.seed,
      ffmpeg: config.ffmpeg,
      node: process.execPath,
    });
    await provider.initialize();
    const s = randomBytes(16).toString('hex');
    const scanClient = createSubsonicClient({
      upstream: config.upstream,
      timeoutMs: 5000,
      proof: {
        username: config.workerCredentials.username,
        s,
        t: createHash('md5')
          .update(config.workerCredentials.password + s)
          .digest('hex'),
      },
    });
    const automation = readAutomationConfig(env);
    let mediaProtection;
    if (automation.enabled && automation.curation) {
      const runtime = {
        python: env.MEDIA_FENCE_PYTHON ?? '/usr/bin/python3',
        helperPath: fileURLToPath(new URL('../helpers/file_access.py', import.meta.url)),
        musicRoot: config.musicRoot,
        timeoutMs: 60000,
        maxFileBytes: 2 * 1024 * 1024 * 1024,
      };
      const fence = configuredMediaFence(env, runtime, [config.stagingRoot, config.engineRoot]);
      if (!env.CREDENTIAL_KEY_PATH) throw new Error('invalid_worker_config');
      const revisions = createMetadataRevision(loadKey(env.CREDENTIAL_KEY_PATH));
      const access = createMetadataFileAccess(runtime);
      mediaProtection = {
        fence,
        publications: createMediaPublicationLedger(database, Date.now),
        fileIdentity: (libraryId: string, relativeFileKey: string) =>
          revisions.fileIdentity({ libraryId, relativeFileKey }),
        inspect: (key: string) => access.inspect(key),
      };
    }
    const runner = createWorkerRunner({
      ...(mediaProtection ? { mediaProtection } : {}),
      database,
      clock: Date.now,
      musicRoot: config.musicRoot,
      stagingRoot: config.stagingRoot,
      ffprobe: config.ffprobe,
      timeoutMs: 900_000,
      leaseDurationMs: 30_000,
      libraryRoot: (id) => {
        const library = config.policy.libraries.find((entry) => entry.id === id);
        if (!library) throw new Error('library_denied');
        return library.relativeRoot;
      },
      acquireEngine: (source, abort) => provider.acquire(source, abort),
      registration: { scanClient, libraries: config.policy.libraries },
    });
    const requests = createEngineRequestWorker({ database, clock: Date.now, provider });
    const maintenance = async () => {
      while (!combined.aborted) {
        await requests.processNext(combined);
        await provider.checkDue(combined);
        await delay(1000, undefined, { signal: combined }).catch(() => {});
      }
    };
    tasks.push(runner.run(combined), maintenance());
    await Promise.all(tasks);
  } finally {
    stop.abort();
    await Promise.allSettled(tasks);
    database.close();
  }
}
