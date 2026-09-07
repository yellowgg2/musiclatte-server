import { lstatSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import type { ManagementDatabase } from '../storage/database.js';
import { readMetadataConfig } from './config.js';
import type { MetadataOptions } from './provider.js';

export const metadataVerifiedProfile = 'posix-exclusive-mp3-id3v23-v24-v1';
/** API receives only read tools and the shared upload store. Scan credentials/backup paths belong to the worker. */
export function readApiMetadataOptions(
  env: Record<string, string | undefined>,
  database: ManagementDatabase,
  clock: () => number,
): MetadataOptions | undefined {
  const config = readMetadataConfig(env);
  if (!config.enabled) return undefined;
  const file = (name: string) => {
    const value = env[name];
    if (!value || !isAbsolute(value) || !statSync(value).isFile())
      throw new Error('invalid_metadata_config');
    return value;
  };
  const ffmpeg = file('METADATA_FFMPEG');
  const ffprobe = file('METADATA_FFPROBE');
  const uploadRoot = env.METADATA_UPLOAD_ROOT;
  if (
    !uploadRoot ||
    !isAbsolute(uploadRoot) ||
    realpathSync(uploadRoot) !== uploadRoot ||
    uploadRoot === config.musicRoot ||
    uploadRoot.startsWith(`${config.musicRoot}/`)
  )
    throw new Error('invalid_metadata_config');
  const upload = lstatSync(uploadRoot);
  if (
    !upload.isDirectory() ||
    upload.isSymbolicLink() ||
    (upload.mode & 0o777) !== 0o700 ||
    upload.uid !== process.getuid?.()
  )
    throw new Error('invalid_metadata_config');
  const helperPath = join(dirname(config.helperPath), 'metadata.py');
  if (!lstatSync(helperPath).isFile() || lstatSync(helperPath).isSymbolicLink())
    throw new Error('invalid_metadata_config');
  return {
    database,
    clock,
    policy: config.policy,
    uploadRoot,
    runtime: {
      musicRoot: config.musicRoot,
      python: config.python,
      helperPath,
      ffmpeg,
      ffprobe,
      maxFileBytes: config.policy.limits.maxFileBytes,
      timeoutMs: config.policy.limits.timeoutMs,
    },
    verifiedProfile: env.METADATA_WRITE_PROFILE === metadataVerifiedProfile,
    workerReady: () => {
      const row = database.connection
        .prepare('SELECT status,heartbeat_at FROM metadata_worker_state WHERE singleton=1')
        .get();
      const age =
        row?.heartbeat_at === null || row?.heartbeat_at === undefined
          ? -1
          : clock() - Number(row.heartbeat_at);
      return !!row && ['idle', 'working'].includes(String(row.status)) && age >= 0 && age < 30000;
    },
  };
}
