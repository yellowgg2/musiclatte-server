import { createApp } from '../../apps/api/src/app.js';
import { createAccessTokenRepository } from '../../apps/api/src/storage/access-token-repository.js';
import { parseMetadataPolicy } from '../../apps/api/src/metadata/policy.js';
import { browserHeaders, cookieOf, createTestContext, password } from './auth-harness.js';
export async function createAccessTokenTestContext(enabled = true) {
  const c = await createTestContext();
  let now = 1000;
  const policy = parseMetadataPolicy({
    schemaVersion: 1,
    enabled: true,
    libraries: [
      {
        id: 'library-1',
        musicFolderId: '0',
        relativeRoot: 'Synthetic',
        editors: [password.username],
        writeProfile: 'exclusive',
        preserveOwnership: true,
      },
    ],
    restoreManagers: [],
    limits: { maxTargets: 10, maxFileBytes: 1000000, timeoutMs: 1000 },
  });
  const automation = {
    database: c.storage.db,
    vault: c.storage.vault,
    clock: () => now,
    policy,
    maxTokenAgeMs: 1000,
  };
  const options = { ...c.options, ...(enabled ? { automation } : {}) };
  const app = createApp(options);
  const tokens = createAccessTokenRepository({
    database: c.storage.db,
    vault: c.storage.vault,
    clock: () => now,
    maxAgeMs: 1000,
  });
  const login = await c.login();
  const headers = {
    ...browserHeaders,
    cookie: cookieOf(login),
    'x-csrf-token': login.json().csrfToken,
  };
  const payload = {
    name: 'Synthetic automation',
    scopes: ['metadata:read'],
    libraryIds: ['library-1'],
    expiresAt: 2000,
  };
  return {
    ...c,
    app,
    automation,
    options,
    tokens,
    headers,
    payload,
    setNow: (value: number) => {
      now = value;
    },
    cleanup: async () => {
      await app.close();
      await c.cleanup();
    },
  };
}
