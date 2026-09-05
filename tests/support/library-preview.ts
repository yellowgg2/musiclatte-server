/** Local synthetic upstream → real S03/S07 API → normal browser routes. */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createTestContext, password } from './auth-harness.js';
import { librarySongs } from '../../apps/web/src/dev/library-fixtures.js';
import {
  syntheticAudioFixture,
  syntheticCoverFixture,
  syntheticMediaMetadata,
} from '../../packages/test-support/src/media-fixtures.js';
const control = process.env.PREVIEW_CONTROL;
const upstream = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const operation = url.pathname.split('/').at(-1);
  const valid =
    url.searchParams.get('t') ===
    createHash('md5')
      .update(password.password + url.searchParams.get('s'))
      .digest('hex');
  let mode = 'normal';
  try {
    if (control) mode = readFileSync(control, 'utf8').trim();
  } catch {
    /* Default. */
  }
  const q = url.searchParams.get('query') ?? '';
  const id = url.searchParams.get('id');
  const isMedia = operation === 'stream' || operation === 'getCoverArt';
  const isRandom = operation === 'getRandomSongs';
  const isLibrary = [
    'getMusicFolders',
    'getIndexes',
    'getMusicDirectory',
    'search3',
    'getArtist',
    'getAlbum',
    'getRandomSongs',
  ].includes(operation ?? '');
  if (isMedia) {
    if (!valid || mode === 'media-error') {
      response.writeHead(valid ? 503 : 401, { 'content-type': 'text/plain' });
      response.end('Synthetic media unavailable');
      return;
    }
    const body = operation === 'stream' ? syntheticAudioFixture : syntheticCoverFixture;
    response.writeHead(200, {
      'content-type':
        operation === 'stream'
          ? syntheticMediaMetadata.audioContentType
          : syntheticMediaMetadata.coverContentType,
      'content-length': String(body.length),
      etag: syntheticMediaMetadata.etag,
      'last-modified': syntheticMediaMetadata.lastModified,
    });
    if (request.method === 'HEAD') response.end();
    else response.end(body);
    return;
  }
  const error = !valid
    ? 40
    : isLibrary && (mode === 'missing' || id === 'missing')
      ? 70
      : isLibrary && mode === 'error'
        ? 0
        : undefined;
  if (isLibrary && (mode === 'error' || (isRandom && mode === 'random-error'))) {
    response.writeHead(503);
    response.end();
    return;
  }
  const empty = mode === 'empty' || q === 'empty' || id === 'empty';
  const randomEmpty = mode === 'random-empty';
  const songs = empty
    ? []
    : q === 'new'
      ? [{ ...librarySongs[0]!, title: 'Newest result' }]
      : q === 'old'
        ? [{ ...librarySongs[0]!, title: 'Obsolete result' }]
        : librarySongs;
  const album = {
    id: 'album-1',
    name: 'Small hours',
    artist: 'Daylight',
    artistId: 'artist-1',
    song: songs,
  };
  const artist = { id: 'artist-1', name: 'Daylight', album: empty ? [] : [album] };
  const payload: Record<string, object> = {
    ping: {},
    getUser: { user: { username: password.username, adminRole: false } },
    getMusicFolders: { musicFolders: { musicFolder: empty ? [] : [{ id: 0, name: 'My music' }] } },
    getIndexes: {
      indexes: {
        index: empty ? [] : [{ name: 'D', artist: [{ id: 'folder-1', name: 'Daylight folder' }] }],
      },
    },
    getMusicDirectory: {
      directory: {
        id: id ?? 'folder-1',
        name: id === 'empty' ? 'Empty folder' : 'Daylight folder',
        ...(id === 'empty' ? { parent: 'folder-1' } : {}),
        child: empty ? [] : [{ id: 'empty', title: 'Empty folder', isDir: true }, ...songs],
      },
    },
    search3: {
      searchResult3: { song: songs, artist: empty ? [] : [artist], album: empty ? [] : [album] },
    },
    getArtist: { artist },
    getAlbum: { album },
    getRandomSongs: { randomSongs: { song: randomEmpty ? [] : songs } },
  };
  const body = {
    'subsonic-response':
      error !== undefined
        ? {
            status: 'failed',
            version: '1.15.0',
            error: { code: error, message: 'synthetic error' },
          }
        : { status: 'ok', version: '1.15.0', ...payload[operation ?? ''] },
  };
  const send = () => {
    if (!response.destroyed) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    }
  };
  if (isLibrary && (q === 'old' || mode === 'loading')) {
    const timer = setTimeout(send, mode === 'loading' ? 3500 : 2500);
    response.on('close', () => clearTimeout(timer));
  } else send();
});
await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
const address = upstream.address();
if (!address || typeof address === 'string') throw new Error('Preview bind failed');
const storage = (await import('./session-storage-harness.js')).createTestContext;
const data = await storage();
data.setNow(Date.now());
const context = await createTestContext({
  upstream: `http://127.0.0.1:${address.port}`,
  sessions: data.sessionsFor(data.db, 3600000),
  instances: data.instances,
  origin: 'http://127.0.0.1:5173',
  secureCookies: false,
  timeoutMs: 5000,
});
const mobilePreview = (width: number) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>S10 ${width}px preview</title>
<style>html,body{margin:0;min-height:100%;background:#dedbe4}body{display:grid;place-items:start center;padding:24px}iframe{width:${width}px;height:844px;border:1px solid #777;border-radius:20px;background:white;box-shadow:0 12px 40px #29263333}</style>
</head><body><iframe title="Musiclatte ${width}px player preview" src="http://127.0.0.1:5173/music/folders/folder-1?musicFolderId=0"></iframe></body></html>`;
context.app.get('/__preview/mobile', async (_request, reply) =>
  reply.type('text/html').send(mobilePreview(390)),
);
context.app.get('/__preview/narrow', async (_request, reply) =>
  reply.type('text/html').send(mobilePreview(320)),
);
const clock = setInterval(() => data.setNow(Date.now()), 100);
await context.app.listen({ host: '127.0.0.1', port: 3000 });
console.info('S10 synthetic S09 API ready at 127.0.0.1:3000');
async function cleanup() {
  clearInterval(clock);
  await context.cleanup();
  data.cleanup();
  await new Promise<void>((resolve) => {
    upstream.close(() => resolve());
    upstream.closeAllConnections();
  });
}
process.once('SIGINT', () => void cleanup());
process.once('SIGTERM', () => void cleanup());
