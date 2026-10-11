/** Local synthetic playlist fixture for the normal browser route and real BFF contract. */
import { readFileSync } from 'node:fs';
import { createTestContext } from './auth-harness.js';
import { createTestContext as createStorageContext } from './session-storage-harness.js';

const control = process.env.PREVIEW_CONTROL;
const port = Number(process.env.PORT ?? 3000);
const webPort = Number(process.env.WEB_PORT ?? 5173);
const storage = await createStorageContext();
storage.setNow(Date.now());
const context = await createTestContext({
  origin: `http://127.0.0.1:${webPort}`,
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
</head><body><iframe title="Musiclatte ${width}px playlist preview" src="http://127.0.0.1:${webPort}/playlists"></iframe></body></html>`;

context.app.get('/__preview/mobile', async (_request, reply) =>
  reply.type('text/html').send(mobilePreview(390)),
);
context.app.get('/__preview/narrow', async (_request, reply) =>
  reply.type('text/html').send(mobilePreview(320)),
);

context.state.accountIdentityFromProof = true;
context.app.get('/__preview/stats', async () => ({
  list: context.requests.filter((url) => url.pathname.endsWith('/getPlaylists')).length,
  detail: context.requests.filter((url) => url.pathname.endsWith('/getPlaylist')).length,
  song: context.requests.filter((url) => url.pathname.endsWith('/getSong')).length,
}));
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
  context.state.mutationWriteCount = 0;
  context.state.playlistExists = mode !== 'list-empty' && mode !== 'missing';
  context.state.playlistName = mode === 'conflict' ? 'Server-updated playlist' : longName;
  context.state.playlistEntryIds =
    mode === 'detail-empty'
      ? []
      : mode === 'selection-partial'
        ? Array.from({ length: 40 }, (_, index) => `selection-${index}-${'x'.repeat(480)}`)
        : entries;
  context.state.collectionError = mode === 'error' ? 60 : mode === 'denied' ? 50 : 0;
  context.state.collectionDelayMs = mode === 'loading' ? 3500 : 0;
  context.state.mutationMismatch = mode === 'outcome-unknown';
  context.state.mutationErrorAfter = mode === 'selection-partial' ? 2 : -1;
  context.state.playlistCoverArt = mode === 'cover-fallback' ? '' : 'cover-A';
  context.state.mediaStatus = mode === 'cover-error' ? 503 : 0;
  context.state.coverJsonError =
    mode === 'cover-undecodable'
      ? { code: 0, message: 'Synthetic failed to decode cover art' }
      : undefined;
  const artwork = mode.startsWith('artwork');
  context.state.playlistIds = artwork
    ? Array.from({ length: 24 }, (_, index) => `pl-${index + 1}`)
    : ['pl-1'];
  context.state.playlistFixtures = artwork
    ? Object.fromEntries(
        context.state.playlistIds.map((id, index) => [
          id,
          {
            id,
            name: index === 0 ? longName : `${longName} ${index + 1}`,
            coverArt: '',
            entryIds: index === 3 ? [] : entries,
            entryCoverArt: index === 1 || index === 3 ? {} : { 1: `cover-later-${index + 1}` },
            ...(index === 2 ? { error: 60 } : {}),
            ...(index === 0 && mode === 'artwork-slow' ? { delayMs: 2500 } : {}),
          },
        ]),
      )
    : {};
}, 50);

await context.app.listen({ host: '127.0.0.1', port });
console.info(`Synthetic playlist preview ready at 127.0.0.1:${port}`);

async function cleanup() {
  clearInterval(clock);
  await context.cleanup();
  storage.cleanup();
}

process.once('SIGINT', () => void cleanup());
process.once('SIGTERM', () => void cleanup());
