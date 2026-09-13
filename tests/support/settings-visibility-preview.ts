/** Synthetic normal-Router preview for Phase 16 Settings capability visibility. */
import { readFileSync } from 'node:fs';
import { createApp } from '../../apps/api/src/app.js';
import { parseMetadataPolicy } from '../../apps/api/src/metadata/policy.js';
import { createTestContext } from './auth-harness.js';
import { createTestContext as createStorage } from './session-storage-harness.js';

const storage = await createStorage();
storage.setNow(Date.now());
const context = await createTestContext({
  sessions: storage.sessionsFor(storage.db, 3600000),
  instances: storage.instances,
  playlistOperations: storage.playlistOperations,
  origin: 'http://127.0.0.1:5173',
  secureCookies: false,
  allowScan: true,
});
context.state.accountIdentityFromProof = true;
const policy = parseMetadataPolicy({
  schemaVersion: 1,
  enabled: true,
  libraries: [
    {
      id: 'music',
      musicFolderId: '0',
      relativeRoot: 'Synthetic',
      editors: ['fixture-listener'],
      writeProfile: 'exclusive',
      preserveOwnership: true,
    },
  ],
  restoreManagers: [],
  limits: { maxTargets: 10, maxFileBytes: 1000000, timeoutMs: 1000 },
});
const app = createApp({
  ...context.options,
  allowScan: true,
  automation: {
    database: storage.db,
    vault: storage.vault,
    clock: () => Date.now(),
    policy,
    maxTokenAgeMs: 30 * 86400000,
  },
});
const control = process.env.PREVIEW_CONTROL;
const clock = setInterval(() => {
  storage.setNow(Date.now());
  let mode = 'ordinary';
  try {
    if (control) mode = readFileSync(control, 'utf8').trim();
  } catch {
    /* Default ordinary fixture. */
  }
  context.state.adminRole = mode === 'admin';
}, 50);

await app.listen({ host: '127.0.0.1', port: 3000 });
console.info('Phase 16 Settings preview ready on 127.0.0.1:3000');

async function cleanup() {
  clearInterval(clock);
  await app.close();
  await context.cleanup();
  storage.cleanup();
}
process.once('SIGINT', () => void cleanup());
process.once('SIGTERM', () => void cleanup());
