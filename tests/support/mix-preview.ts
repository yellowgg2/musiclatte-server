/** Disposable synthetic upstream and real API for normal-route browser verification. */
import { readFileSync } from 'node:fs';
import { createApp } from '../../apps/api/src/app.js';
import { createMixRepository } from '../../apps/api/src/storage/mix-repository.js';
import { createTestContext } from './auth-harness.js';
const port = Number(process.env.PORT);
const webPort = Number(process.env.WEB_PORT);
if (![port, webPort].every((value) => Number.isInteger(value) && value > 1024 && value < 65536))
  throw new Error('Explicit preview ports required');
const context = await createTestContext();
context.storage.setNow(Date.now());
const app = createApp({
  ...context.options,
  origin: `http://127.0.0.1:${webPort}`,
  secureCookies: false,
  sessions: context.storage.sessionsFor(context.storage.db, 3_600_000),
  mixes: createMixRepository({ database: context.storage.db, clock: Date.now }),
});
let lastMode = '';
const timer = setInterval(() => {
  context.storage.setNow(Date.now());
  let mode = '';
  try {
    if (process.env.PREVIEW_CONTROL)
      mode = readFileSync(process.env.PREVIEW_CONTROL, 'utf8').trim();
  } catch {
    /* Default synthetic success. */
  }
  context.state.emptyLibrary = mode === 'empty';
  context.state.randomStatus = mode === 'error' ? 503 : 200;
  context.state.libraryStall = mode === 'loading';
  if (mode === 'conflict' && mode !== lastMode)
    context.storage.db.connection.prepare('UPDATE saved_mixes SET revision=revision+1').run();
  lastMode = mode;
}, 100);
await app.listen({ host: '127.0.0.1', port });
console.info(`Mix preview ready on 127.0.0.1:${port}`);
let closing = false;
async function cleanup() {
  if (closing) return;
  closing = true;
  clearInterval(timer);
  await app.close();
  await context.cleanup();
}
process.once('SIGINT', () => void cleanup());
process.once('SIGTERM', () => void cleanup());
