/** Local-only fixture: real S03 API with synthetic upstream and disposable session storage. */
import { readFileSync } from 'node:fs';
import { createTestContext as storageContext } from './session-storage-harness.js';
import { createTestContext } from './auth-harness.js';
const storage = await storageContext();
const sessions = storage.sessionsFor(
  storage.db,
  Number(process.env.PREVIEW_SESSION_AGE_MS ?? 300000),
);
const context = await createTestContext({
  sessions,
  instances: storage.instances,
  origin: 'http://127.0.0.1:5173',
  secureCookies: false,
  timeoutMs: 5000,
});
const control = process.env.PREVIEW_CONTROL;
let current = 'normal';
const clock = setInterval(() => {
  let mode = 'normal';
  try {
    if (control) mode = readFileSync(control, 'utf8').trim();
  } catch {
    /* Default fixture. */
  }
  storage.setNow(Date.now());
  context.state.status = mode === 'denied' ? 403 : mode === 'outage' ? 503 : 200;
  context.state.stall = mode === 'loading';
  if (mode === 'expire' && current !== 'expire') storage.instances.bumpPolicyRevision();
  current = mode;
}, 50);
storage.setNow(Date.now());
await context.app.listen({ host: '127.0.0.1', port: 3000 });
console.info('S06 synthetic API fixture listening on 127.0.0.1:3000');
async function cleanup() {
  clearInterval(clock);
  await context.cleanup();
  storage.cleanup();
}
process.once('SIGINT', () => void cleanup());
process.once('SIGTERM', () => void cleanup());
