import { existsSync, readdirSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { createKey, loadKey } from '../security/key-store.js';

/** Compose first run only: a missing key alongside any existing management state is fatal. */
export function initializeContainerStorage(directory: string, keyPath: string): void {
  try {
    if (!isAbsolute(directory) || !isAbsolute(keyPath)) throw new Error();
    if (!existsSync(keyPath)) {
      if (readdirSync(directory).length) throw new Error();
      createKey(keyPath);
    }
    loadKey(keyPath);
  } catch {
    throw new Error('Container storage initialization failed');
  }
}

export function readMixEnabled(env: Record<string, string | undefined>): boolean {
  if (env.MIXES_ENABLED !== undefined && !['true', 'false'].includes(env.MIXES_ENABLED))
    throw new Error('Invalid mix configuration');
  return env.MIXES_ENABLED === 'true';
}
/** Both switches are opt-in; forwarding never enables the local feature implicitly. */
export function readListeningConfig(env: Record<string, string | undefined>) {
  for (const name of ['LISTENING_ENABLED', 'LISTENING_SCROBBLE_ENABLED'])
    if (env[name] !== undefined && !['true', 'false'].includes(env[name]!))
      throw new Error('Invalid listening configuration');
  return {
    enabled: env.LISTENING_ENABLED === 'true',
    scrobble: env.LISTENING_SCROBBLE_ENABLED === 'true',
  };
}

export function readStreamQualityEnabled(env: Record<string, string | undefined>): boolean {
  if (
    env.STREAM_QUALITY_ENABLED !== undefined &&
    !['true', 'false'].includes(env.STREAM_QUALITY_ENABLED)
  )
    throw new Error('Invalid stream quality configuration');
  return env.STREAM_QUALITY_ENABLED === 'true';
}
