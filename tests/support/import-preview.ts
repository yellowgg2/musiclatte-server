/** MUSICLATTE_IMPORT_PREVIEW: synthetic jobs, normal product routes, no real downloader or media. */
import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import type { ImportJob, ImportStage } from '@musiclatte/contracts';
import { createTestContext } from './auth-harness.js';
import { createTestContext as createStorage } from './session-storage-harness.js';
const storage = await createStorage();
storage.setNow(Date.now());
const context = await createTestContext({
  sessions: storage.sessionsFor(storage.db, 3600000),
  instances: storage.instances,
  origin: 'http://127.0.0.1:5173',
  secureCookies: false,
});
storage.setNow(Date.now());
const app = Fastify({ logger: false });
let mode = '';
let jobs: ImportJob[] = [];
let nextId = 1;
const operations = new Map<string, ImportJob>();
const submitted = new Map<string, number>();
const sample = (stage: ImportStage = 'ready'): ImportJob => ({
  id: 'sample-job',
  libraryId: 'music',
  createdAt: Date.now() - 60000,
  cancelRequestedAt: null,
  retryOfJobId: null,
  status: stage === 'ready' ? 'partial' : 'running',
  items: [
    {
      id: 'saved-item',
      sourceId: 'abcdefghijk',
      title: 'Evening café · A quiet song for the long way home — 오래 기억하고 싶은 저녁의 음악',
      channel: 'Musiclatte Studio · 긴 이름의 테스트 채널',
      stage,
      ...(stage === 'ready' ? { mediaLinkId: 'media-synthetic' } : {}),
    },
    {
      id: 'failed-item',
      sourceId: '12345678901',
      title: 'A second song',
      stage: 'failed',
      failureCode: 'download_failed',
    },
  ],
});
function control() {
  let next = 'normal';
  try {
    if (process.env.PREVIEW_CONTROL)
      next = readFileSync(process.env.PREVIEW_CONTROL, 'utf8').trim();
  } catch {
    /* Deterministic default. */
  }
  if (next !== mode) {
    mode = next;
    jobs = ['empty', 'normal', 'loading', 'invalid'].includes(mode)
      ? []
      : [sample(mode === 'registering' || mode === 'restart' ? 'registering' : 'ready')];
    operations.clear();
    submitted.clear();
  }
}
function advance() {
  for (const job of jobs) {
    const start = submitted.get(job.id);
    if (!start) continue;
    const elapsed = Date.now() - start;
    if (job.cancelRequestedAt !== null) {
      job.status = 'cancelled';
      job.items = job.items.map((i) => (i.stage === 'ready' ? i : { ...i, stage: 'cancelled' }));
      submitted.delete(job.id);
      continue;
    }
    const stages: ImportStage[] = [
      'queued',
      'resolving',
      'downloading',
      'postprocessing',
      'publishing',
      'registering',
      'ready',
    ];
    const stage = stages[Math.min(6, Math.floor(elapsed / 2500))]!;
    job.status = stage === 'ready' ? (job.items.length > 1 ? 'partial' : 'completed') : 'running';
    job.items = job.items.map((item, index) => ({
      ...item,
      stage: stage === 'ready' && index > 0 ? 'failed' : stage,
      ...(stage === 'ready' && index === 0 ? { mediaLinkId: 'media-synthetic' } : {}),
      ...(stage === 'ready' && index > 0 ? { failureCode: 'download_failed' as const } : {}),
    }));
  }
}
app.addHook('onRequest', async () => {
  storage.setNow(Date.now());
  control();
  advance();
});
app.get('/api/v1/capabilities', async (request, reply) => {
  const response = await context.app.inject({
    method: 'GET',
    url: '/api/v1/capabilities',
    headers: request.headers,
  });
  if (response.statusCode !== 200)
    return reply.code(response.statusCode).type('application/json').send(response.body);
  const value = response.json();
  value.features['imports.youtube'] = {
    supported: true,
    permission: mode === 'denied' ? 'denied' : 'allowed',
    availability: mode === 'unavailable' ? 'temporarily_unavailable' : 'available',
  };
  return value;
});
app.get('/api/v1/imports', async (_request, reply) => {
  if (mode === 'loading') await new Promise((r) => setTimeout(r, 3000));
  if (mode === 'error') return reply.code(503).send({ error: { code: 'upstream_unavailable' } });
  return {
    schemaVersion: 1,
    jobs,
    libraries: [{ id: 'music' }, { id: 'archive' }],
    nextCursor: null,
  };
});
app.get('/api/v1/imports/:id', async (request) => ({
  schemaVersion: 1,
  job: jobs.find((j) => j.id === (request.params as { id: string }).id),
}));
app.post('/api/v1/imports', async (request, reply) => {
  const body = request.body as { operationId: string; libraryId: string; urls: string[] };
  if (mode === 'denied') return reply.code(403).send({ error: { code: 'forbidden' } });
  let job = operations.get(body.operationId);
  if (!job) {
    job = {
      id: `job-${nextId++}`,
      libraryId: body.libraryId,
      createdAt: Date.now(),
      cancelRequestedAt: null,
      retryOfJobId: null,
      status: 'queued',
      items: body.urls.map((url, index) => ({
        id: `item-${nextId}-${index}`,
        sourceId: new URL(url).searchParams.get('v') ?? 'abcdefghijk',
        stage: 'queued',
        title: `Synthetic song ${index + 1}`,
      })),
    };
    jobs.unshift(job);
    operations.set(body.operationId, job);
    submitted.set(job.id, Date.now());
  }
  return reply.code(202).send({ schemaVersion: 1, job });
});
app.post('/api/v1/imports/:id/retries', async (request, reply) => {
  const body = request.body as { operationId: string; itemIds: string[] };
  const parent = jobs.find((j) => j.id === (request.params as { id: string }).id)!;
  let job = operations.get(body.operationId);
  if (!job) {
    job = {
      ...parent,
      id: `job-${nextId++}`,
      createdAt: Date.now(),
      status: 'queued',
      retryOfJobId: parent.id,
      items: parent.items
        .filter((i) => i.stage === 'failed' && body.itemIds.includes(i.id))
        .map(({ failureCode: _failure, ...item }) => ({ ...item, stage: 'queued' })),
    };
    jobs.unshift(job);
    operations.set(body.operationId, job);
    submitted.set(job.id, Date.now());
  }
  return reply.code(202).send({ schemaVersion: 1, job });
});
app.delete('/api/v1/imports/:id', async (request) => {
  const job = jobs.find((j) => j.id === (request.params as { id: string }).id)!;
  job.cancelRequestedAt = Date.now();
  submitted.set(job.id, Date.now());
  return { schemaVersion: 1, job };
});
for (const width of [390, 320])
  app.get(`/__preview/${width}`, async (_request, reply) =>
    reply
      .type('text/html')
      .send(
        `<!doctype html><html><head><title>Imports ${width}px preview</title><style>body{margin:0;background:#dedbe4;display:grid;justify-content:center}iframe{width:${width}px;height:844px;border:0}</style></head><body><iframe title="Musiclatte ${width}px preview" src="http://127.0.0.1:5173/imports"></iframe></body></html>`,
      ),
  );
app.setNotFoundHandler(async (request, reply) => {
  const response = await context.app.inject({
    method: request.method as 'GET' | 'POST' | 'DELETE',
    url: request.url,
    headers: request.headers,
    ...(request.body ? { payload: JSON.stringify(request.body) } : {}),
  });
  for (const [key, value] of Object.entries(response.headers))
    if (value !== undefined) reply.header(key, value);
  return reply.code(response.statusCode).send(response.rawPayload);
});
await app.listen({ host: '127.0.0.1', port: 3000 });
console.info('Synthetic imports preview ready on 127.0.0.1:3000');
async function cleanup() {
  await app.close();
  await context.cleanup();
  storage.cleanup();
}
process.once('SIGINT', () => void cleanup());
process.once('SIGTERM', () => void cleanup());
