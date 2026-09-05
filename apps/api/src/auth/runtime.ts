import { isAbsolute } from 'node:path';
import { registerReadiness } from '../health/readiness.js';
import { createApp } from '../app.js';
import { openDatabase } from '../storage/database.js';
import { createInstanceRepository } from '../storage/instance-repository.js';
import { createSessionRepository } from '../storage/session-repository.js';
import { createPlaylistOperationRepository } from '../storage/playlist-operation-repository.js';
import { loadKey } from '../security/key-store.js';
import { createCredentialVault } from '../security/credential-vault.js';
import { readSessionPolicy } from '../config/session-policy.js';

/** Startup uses operator-owned paths and an already provisioned key; never rekeys an existing DB. */
export function createConfiguredApp(env: Record<string, string | undefined>) {
  let database: ReturnType<typeof openDatabase> | undefined;
  try {
    const required = (name: string) => {
      const value = env[name];
      if (!value) throw new Error();
      return value;
    };
    const origin = required('PUBLIC_ORIGIN');
    const upstream = required('GONIC_UPSTREAM');
    const directory = required('MANAGEMENT_DIRECTORY');
    const keyPath = required('CREDENTIAL_KEY_PATH');
    if (!isAbsolute(directory) || !isAbsolute(keyPath)) throw new Error();
    const url = new URL(origin);
    if (
      url.origin !== origin ||
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      (env.NODE_ENV === 'production' && url.protocol !== 'https:')
    )
      throw new Error();
    if (env.ALLOW_SCAN !== undefined && !['true', 'false'].includes(env.ALLOW_SCAN))
      throw new Error();
    const rawTimeout = env.SUBSONIC_TIMEOUT_MS ?? '5000';
    if (
      !/^[1-9]\d*$/.test(rawTimeout) ||
      !Number.isSafeInteger(Number(rawTimeout)) ||
      Number(rawTimeout) > 2_147_483_647
    )
      throw new Error();
    const { maxAgeMs } = readSessionPolicy(env);
    const key = loadKey(keyPath);
    const vault = createCredentialVault(key);
    database = openDatabase(directory);
    const instances = createInstanceRepository(database, vault.keyId);
    const sessions = createSessionRepository({ database, vault, maxAgeMs, clock: Date.now });
    const playlistOperations = createPlaylistOperationRepository({ database, clock: Date.now });
    const app = createApp({
      sessions,
      instances,
      playlistOperations,
      signingKey: key,
      origin,
      upstream,
      timeoutMs: Number(rawTimeout),
      secureCookies: url.protocol === 'https:',
      allowScan: env.ALLOW_SCAN === 'true',
    });
    const ownedDatabase = database;
    registerReadiness(app, upstream, Number(rawTimeout), () => {
      ownedDatabase.connection
        .prepare('SELECT policy_revision FROM instance WHERE singleton=1')
        .get();
    });
    app.addHook('onClose', async () => {
      ownedDatabase.close();
    });
    return app;
  } catch {
    database?.close();
    throw new Error('Invalid authentication configuration');
  }
}
