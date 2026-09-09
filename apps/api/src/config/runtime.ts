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
