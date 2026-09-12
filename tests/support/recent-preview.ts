/** MUSICLATTE_RECENT_PREVIEW: synthetic ledger with real login, playlist and player BFFs. */
import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import {
  metadataFields,
  type RecentDownloadItem,
  type RecentDownloadResponse,
} from '@musiclatte/contracts';
import { createTestContext } from './auth-harness.js';
import { createTestContext as createStorage } from './session-storage-harness.js';
const port = Number(process.env.PORT);
const webPort = Number(process.env.WEB_PORT);
if (![port, webPort].every((value) => Number.isInteger(value) && value > 1024 && value < 65536))
  throw new Error('Explicit preview ports required');
const storage = await createStorage();
storage.setNow(Date.now());
const context = await createTestContext({
  sessions: storage.sessionsFor(storage.db, 3600000),
  instances: storage.instances,
  playlistOperations: storage.playlistOperations,
  origin: `http://127.0.0.1:${webPort}`,
  secureCookies: false,
});
const app = Fastify({ logger: false });
const mobilePreview = (width: number) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Recent downloads ${width}px preview</title>
<style>html,body{margin:0;min-height:100%;background:#dedbe4}body{display:grid;place-items:start center;padding:24px}iframe{width:${width}px;height:844px;border:1px solid #777;border-radius:20px;background:white;box-shadow:0 12px 40px #29263333}</style>
</head><body><iframe title="Musiclatte ${width}px recent downloads preview" src="http://127.0.0.1:${webPort}/music/recent"></iframe></body></html>`;
app.get('/__preview/mobile', async (_request, reply) =>
  reply.type('text/html').send(mobilePreview(390)),
);
app.get('/__preview/narrow', async (_request, reply) =>
  reply.type('text/html').send(mobilePreview(320)),
);
let mode = '';
let generation = 0;
let appendRequests = 0;
const now = Date.now();
const songs = Array.from({ length: 40 }, (_, i) => ({
  id: `recent-${i}-${'x'.repeat(480)}`,
  title:
    i === 0
      ? 'Evening café · A quiet song for the long way home — 오래 기억하고 싶은 저녁의 음악'
      : `Café session ${String(i + 1).padStart(2, '0')}`,
  artist: 'Musiclatte Studio · 오래 기억하고 싶은 음악',
  isDir: false,
  coverArt: 'cover-A',
  duration: 180,
}));
function ready(i: number): RecentDownloadItem {
  return {
    eventId: `event-${i}`,
    state: 'ready',
    song: songs[i]!,
    downloadCompletedAt: new Date(now - (i + 1) * 60000).toISOString(),
    registeredAt: new Date(now - i * 60000).toISOString(),
  };
}
app.addHook('onRequest', async () => {
  storage.setNow(Date.now());
  let next = 'normal';
  try {
    if (process.env.PREVIEW_CONTROL)
      next = readFileSync(process.env.PREVIEW_CONTROL, 'utf8').trim();
  } catch {
    /* Default fixture. */
  }
  if (next !== mode) {
    mode = next;
    if (mode === 'new') generation++;
    context.state.mutationWriteCount = 0;
    context.state.mutationErrorAfter = -1;
    appendRequests = 0;
  }
});
app.get('/api/v1/capabilities', async (request, reply) => {
  const result = await context.app.inject({
    method: 'GET',
    url: '/api/v1/capabilities',
    headers: request.headers,
  });
  if (result.statusCode !== 200) return reply.code(result.statusCode).send(result.json());
  const value = result.json();
  const available = {
    supported: true,
    permission: 'allowed',
    availability: 'available',
  };
  value.features['listening.history'] = available;
  value.features['mixes.saved'] = available;
  value.features['metadata.curation'] = {
    ...available,
    fields: [...metadataFields],
    formats: ['mp3'],
  };
  value.features['metadata.write'] = {
    ...available,
    fields: [...metadataFields],
    formats: ['mp3'],
  };
  value.features['favorites.songs'] = available;
  value.features['library.recentDownloads'] = {
    supported: mode !== 'unsupported',
    permission: mode === 'denied' ? 'denied' : 'allowed',
    availability: mode === 'unavailable' ? 'temporarily_unavailable' : 'available',
  };
  return value;
});
app.get('/api/v1/recent-downloads', async (request, reply) => {
  const authentication = await context.app.inject({
    method: 'GET',
    url: '/api/v1/session',
    headers: request.headers,
  });
  if (authentication.statusCode !== 200 || mode === '401')
    return reply.code(401).send({ error: { code: 'unauthenticated' } });
  if (mode === 'loading') await new Promise((r) => setTimeout(r, 3000));
  if (['error', '503', '403'].includes(mode))
    return reply
      .code(mode === '403' ? 403 : 503)
      .send({ error: { code: mode === '403' ? 'forbidden' : 'upstream_unavailable' } });
  const query = request.query as { cursor?: string; from?: string; to?: string; limit?: string };
  const [offsetText, snapshotText, fromText, toText] = query.cursor?.split('|') ?? [];
  const offset = Number(offsetText ?? 0);
  const asOf = snapshotText ?? new Date(now + generation * 60000).toISOString();
  const filter = {
    from: fromText ?? query.from ?? new Date(now + generation * 60000 - 7 * 86400000).toISOString(),
    to: toText ?? query.to ?? new Date(now + generation * 60000).toISOString(),
  };
  const items: RecentDownloadItem[] = [
    ...(generation && asOf > new Date(now).toISOString()
      ? [
          {
            ...ready(39),
            eventId: 'new-event',
            downloadCompletedAt: new Date(now + generation * 60000 - 1000).toISOString(),
            registeredAt: new Date(now + generation * 60000 - 500).toISOString(),
            song: { ...songs[39]!, id: 'new-song', title: 'New arrival · 새 다운로드' },
          } as RecentDownloadItem,
        ]
      : []),
    ...songs.slice(0, 39).map((_, i) => ready(i)),
    {
      eventId: 'registering',
      state: 'registering',
      downloadCompletedAt: new Date(now - 50 * 60000).toISOString(),
    },
    {
      eventId: 'missing',
      state: 'missing',
      downloadCompletedAt: new Date(now - 51 * 60000).toISOString(),
    },
  ];
  const filtered =
    mode === 'empty'
      ? []
      : items.filter(
          (item) => item.downloadCompletedAt >= filter.from && item.downloadCompletedAt < filter.to,
        );
  const limit = Number(query.limit ?? 20);
  const page = filtered.slice(offset, offset + limit);
  const value: RecentDownloadResponse = {
    schemaVersion: 1,
    filter,
    asOf,
    items: page,
    nextCursor:
      offset + limit < filtered.length
        ? [offset + limit, asOf, filter.from, filter.to].join('|')
        : null,
  };
  return value;
});
// Normal BFF playlist operations and synthetic playable audio stay in the existing harness.
app.setNotFoundHandler(async (request, reply) => {
  if (request.method === 'PATCH' && mode === 'partial' && ++appendRequests >= 2) {
    return reply.code(503).send({ error: { code: 'upstream_unavailable' } });
  }

  const result = await context.app.inject({
    method: request.method as 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: request.url,
    headers: request.headers,
    ...(request.body ? { payload: JSON.stringify(request.body) } : {}),
  });
  for (const [key, value] of Object.entries(result.headers))
    if (value !== undefined) reply.header(key, value);
  return reply.code(result.statusCode).send(result.rawPayload);
});
await app.listen({ host: '127.0.0.1', port });
console.info(`Synthetic recent preview ready on 127.0.0.1:${port}`);
async function cleanup() {
  await app.close();
  await context.cleanup();
  storage.cleanup();
}
process.once('SIGINT', () => void cleanup());
process.once('SIGTERM', () => void cleanup());
