/** Local synthetic playlist fixture for the normal browser route and real BFF contract. */
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
const longName =
  'A very long afternoon playlist for quiet listening, duplicated songs, and narrow screens';
const entries = [
  'track-A',
  'track-B',
  'track-A',
  ...Array.from({ length: 12 }, (_, index) => `track-${String(index + 3).padStart(2, '0')}`),
];

const mobilePreview = (width: number) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Playlist ${width}px preview</title>
<style>html,body{margin:0;min-height:100%;background:#dedbe4}body{display:grid;place-items:start center;padding:24px}iframe{width:${width}px;height:844px;border:1px solid #777;border-radius:20px;background:white;box-shadow:0 12px 40px #29263333}</style>
</head><body><iframe title="Musiclatte ${width}px playlist preview" src="http://127.0.0.1:5173/playlists"></iframe></body></html>`;

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
    /* Default to the complete deterministic playlist. */
  }
  if (mode === current) return;
  current = mode;
  context.state.playlistExists = mode !== 'list-empty' && mode !== 'missing';
  context.state.playlistName = longName;
  context.state.playlistEntryIds = mode === 'detail-empty' ? [] : entries;
  context.state.collectionError = mode === 'error' ? 60 : mode === 'denied' ? 50 : 0;
  context.state.collectionDelayMs = mode === 'loading' ? 3500 : 0;
  context.state.playlistCoverArt = mode === 'cover-fallback' ? '' : 'cover-A';
  context.state.mediaStatus = mode === 'cover-error' ? 503 : 0;
}, 50);

await context.app.listen({ host: '127.0.0.1', port: 3000 });
console.info('S06 playlist preview ready at 127.0.0.1:3000');

async function cleanup() {
  clearInterval(clock);
  await context.cleanup();
  storage.cleanup();
}

process.once('SIGINT', () => void cleanup());
process.once('SIGTERM', () => void cleanup());
