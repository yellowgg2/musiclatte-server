import { accessSync, constants, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { readMetadataConfig } from './config.js';

export type MetadataEnvironment = Record<string, string | undefined>;
export function metadataDirectory(path: string | undefined, privateRoot: boolean, writable = true) {
  if (!path || !isAbsolute(path) || realpathSync(path) !== path)
    throw new Error('invalid_metadata_config');
  const stat = lstatSync(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (privateRoot && ((stat.mode & 0o777) !== 0o700 || stat.uid !== process.getuid?.()))
  )
    throw new Error('invalid_metadata_config');
  accessSync(path, constants.R_OK | constants.X_OK | (writable ? constants.W_OK : 0));
  return path;
}
export function readMetadataWorkerConfig(env: MetadataEnvironment) {
  try {
    const metadata = readMetadataConfig(env);
    if (!metadata.enabled) return metadata;
    const management = metadataDirectory(env.MANAGEMENT_DIRECTORY, true);
    const privateRoot = metadataDirectory(env.METADATA_DATA_ROOT, true);
    const uploadRoot = metadataDirectory(env.METADATA_UPLOAD_ROOT, true);
    const musicRoot = metadataDirectory(metadata.musicRoot, false);
    const coverCacheRoot =
      env.METADATA_GONIC_COVER_CACHE_ROOT === undefined
        ? undefined
        : metadataDirectory(env.METADATA_GONIC_COVER_CACHE_ROOT, false);
    const roots = [
      management,
      privateRoot,
      uploadRoot,
      musicRoot,
      ...(coverCacheRoot ? [coverCacheRoot] : []),
    ];
    if (
      roots.some((root, i) =>
        roots.some((other, j) => i !== j && (root === other || root.startsWith(`${other}/`))),
      )
    )
      throw new Error();
    const executable = (name: string) => {
      const path = env[name];
      if (
        !path ||
        !isAbsolute(path) ||
        !lstatSync(path).isFile() ||
        lstatSync(path).isSymbolicLink()
      )
        throw new Error();
      accessSync(path, constants.R_OK | constants.X_OK);
      return path;
    };
    const ffmpeg = executable('METADATA_FFMPEG');
    const ffprobe = executable('METADATA_FFPROBE');
    const projector = executable('METADATA_COVER_PROJECTOR');
    const credentialPath = env.METADATA_CREDENTIAL_PATH;
    if (
      !credentialPath ||
      !isAbsolute(credentialPath) ||
      realpathSync(credentialPath) !== credentialPath
    )
      throw new Error();
    const stat = lstatSync(credentialPath);
    if (!stat.isFile() || stat.size > 8192 || (stat.mode & 0o027) !== 0) throw new Error();
    const credential = JSON.parse(readFileSync(credentialPath, 'utf8')) as Record<string, unknown>;
    if (
      !credential ||
      Object.keys(credential).sort().join(',') !== 'password,username' ||
      typeof credential.username !== 'string' ||
      !credential.username.length ||
      typeof credential.password !== 'string' ||
      !credential.password.length
    )
      throw new Error();
    const keyPath = env.CREDENTIAL_KEY_PATH;
    if (!keyPath || !isAbsolute(keyPath) || realpathSync(keyPath) !== keyPath) throw new Error();
    const upstream = new URL(env.GONIC_UPSTREAM ?? '');
    if (
      !['http:', 'https:'].includes(upstream.protocol) ||
      upstream.username ||
      upstream.password ||
      upstream.search ||
      upstream.hash
    )
      throw new Error();
    return {
      ...metadata,
      management,
      privateRoot,
      uploadRoot,
      musicRoot,
      ffmpeg,
      ffprobe,
      projector,
      coverCacheRoot,
      keyPath,
      upstream: upstream.href,
      credential: { username: credential.username, password: credential.password },
      transactionHelper: join(metadata.helperPath, '..', 'file_transaction.py'),
    };
  } catch {
    throw new Error('invalid_metadata_config');
  }
}
