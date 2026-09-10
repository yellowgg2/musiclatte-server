/** MUSICLATTE_RECENT_PREVIEW: synthetic ledger with real login, playlist and player BFFs. */
import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import type { RecentDownloadItem, RecentDownloadResponse } from '@musiclatte/contracts';
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
});
const app = Fastify({ logger: false });
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
    fields: ['title', 'artist', 'album', 'cover', 'lyrics'],
    formats: ['mp3'],
  };
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
await app.listen({ host: '127.0.0.1', port: 3000 });
console.info('Synthetic recent preview ready on 127.0.0.1:3000');
async function cleanup() {
  await app.close();
  await context.cleanup();
  storage.cleanup();
}
process.once('SIGINT', () => void cleanup());
process.once('SIGTERM', () => void cleanup());
