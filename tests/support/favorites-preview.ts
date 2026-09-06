/** Local synthetic favorites fixture for normal browser routes and the real BFF contract. */
import { readFileSync } from 'node:fs';
import { createTestContext } from './auth-harness.js';
import { createTestContext as createStorageContext } from './session-storage-harness.js';

const control = process.env.PREVIEW_CONTROL;
const storage = await createStorageContext();
storage.setNow(Date.now());
const context = await createTestContext({
  origin: 'http://127.0.0.1:5173',
  secureCookies: false,
  timeoutMs: 5000,
  sessions: storage.sessionsFor(storage.db, 3_600_000),
  instances: storage.instances,
  playlistOperations: storage.playlistOperations,
});

const mobilePreview = (width: number) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Favorites ${width}px preview</title>
<style>html,body{margin:0;min-height:100%;background:#dedbe4}body{display:grid;place-items:start center;padding:24px}iframe{width:${width}px;height:844px;border:1px solid #777;border-radius:20px;background:white;box-shadow:0 12px 40px #29263333}</style>
</head><body><iframe title="Musiclatte ${width}px favorites preview" src="http://127.0.0.1:5173/music/favorites"></iframe></body></html>`;

context.app.get('/__preview/mobile', async (_request, reply) =>
  reply.type('text/html').send(mobilePreview(390)),
);
context.app.get('/__preview/narrow', async (_request, reply) =>
  reply.type('text/html').send(mobilePreview(320)),
);

let current = '';
const clock = setInterval(() => {
  storage.setNow(Date.now());
  let mode = 'normal';
  try {
    if (control) mode = readFileSync(control, 'utf8').trim() || 'normal';
  } catch {
    /* Default to the deterministic favorite list. */
  }
  if (mode === current) return;
  current = mode;
  context.state.favoriteWriteObserved = false;
  context.state.favoriteWriteError = mode === 'rollback' ? 60 : 0;
  context.state.favoritePostwriteError = mode === 'postwrite-error' ? 60 : 0;
  context.state.favoriteSilentNoop = mode === 'outcome-unknown';
  context.state.favoriteDelayMs = mode === 'loading' ? 3000 : 0;
  context.state.favoriteReadError = mode === 'read-error' ? 60 : 0;
  context.state.favoriteSongIdsByUsername.set(
    'fixture-listener',
    mode === 'empty' ? [] : mode === 'native-star' ? ['tr-A'] : ['tr-B', 'tr-A'],
  );
}, 50);

await context.app.listen({ host: '127.0.0.1', port: 3000 });
console.info('S10 favorites preview ready at 127.0.0.1:3000');

async function cleanup() {
  clearInterval(clock);
  await context.cleanup();
  storage.cleanup();
}

process.once('SIGINT', () => void cleanup());
process.once('SIGTERM', () => void cleanup());
