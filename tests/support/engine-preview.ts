/** MUSICLATTE_ENGINE_PREVIEW: synthetic engine projections, normal login and player BFF. */
import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import { enginePublicStatuses, type EngineStatusResponse } from '@musiclatte/contracts';
import { engineFixture, engineFixtures } from './engine-fixtures.js';
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
context.state.accountIdentityFromProof = true;
const app = Fastify({ logger: false });
let mode = '';
let value = engineFixture();
let action: { kind: string; started: number; before: EngineStatusResponse } | null = null;
app.addHook('onRequest', async () => {
  storage.setNow(Date.now());
  let next = 'active';
  try {
    if (process.env.PREVIEW_CONTROL)
      next = readFileSync(process.env.PREVIEW_CONTROL, 'utf8').trim();
  } catch {
    /* Default synthetic state. */
  }
  if (next !== mode) {
    mode = next;
    action = null;
    value = engineFixtures[mode] ?? engineFixture();
    if (mode === 'restore-unavailable')
      value = engineFixture({ recoverability: 'temporarily_unavailable' });
    if (mode === 'long')
      value = engineFixture({
        status: 'validation_failed',
        activeVersion: 'nightly-' + '2026.09.07-'.repeat(10),
      });
  }
});
app.get('/api/v1/capabilities', async (request, reply) => {
  const response = await context.app.inject({
    url: '/api/v1/capabilities',
    headers: request.headers,
  });
  if (response.statusCode !== 200) return reply.code(response.statusCode).send(response.json());
  const result = response.json();
  result.features['engine.manage'] = {
    supported: mode !== 'unsupported',
    permission: mode === 'denied' ? 'denied' : mode === 'unknown' ? 'unknown' : 'allowed',
    availability: ['unavailable', 'update_failed', 'validation_failed'].includes(mode)
      ? 'temporarily_unavailable'
      : 'available',
  };
  return result;
});
app.route({
  method: ['GET', 'POST'],
  url: '/api/v1/engine',
  handler: async (request, reply) => {
    const authentication = await context.app.inject({
      url: '/api/v1/session',
      headers: request.headers,
    });
    if (authentication.statusCode !== 200 || mode === '401')
      return reply.code(401).send({ error: { code: 'unauthenticated' } });
    if (['denied', 'unsupported', 'unknown', '403'].includes(mode))
      return reply.code(403).send({ error: { code: 'forbidden' } });
    if (['503', '409'].includes(mode))
      return reply
        .code(Number(mode))
        .send({ error: { code: mode === '409' ? 'conflict' : 'upstream_unavailable' } });
    const captured = structuredClone(value);
    if (mode === 'late-read' && request.method === 'GET') {
      await new Promise((r) => setTimeout(r, 5000));
      return { ...captured, activeVersion: 'late-private-version' };
    }
    if (request.method === 'POST') {
      if (
        request.headers['x-csrf-token'] !== authentication.json().csrfToken ||
        request.headers.origin !== 'http://127.0.0.1:5173'
      )
        return reply.code(403).send({ error: { code: 'csrf_rejected' } });
      const body = request.body as { action?: string };
      if (
        !body ||
        Object.keys(body).length !== 1 ||
        !['check_now', 'restore_previous'].includes(body.action ?? '')
      )
        return reply.code(400).send({ error: { code: 'invalid_request' } });
      if (mode === 'late-action') {
        await new Promise((r) => setTimeout(r, 5000));
        return reply.code(401).send({ error: { code: 'unauthenticated' } });
      }
      if (
        body.action === 'restore_previous' &&
        (!value.previousVersion || value.recoverability !== 'available')
      )
        return reply.code(409).send({ error: { code: 'conflict' } });
      action ??= { kind: body.action!, started: Date.now(), before: structuredClone(value) };
      return reply.code(202).send(captured);
    }
    if (action && mode !== 'stuck') {
      if (Date.now() - action.started < 5000) {
        if (action.kind === 'check_now') value = { ...value, status: 'checking' };
      } else {
        value =
          action.kind === 'restore_previous'
            ? {
                ...value,
                activeVersion: action.before.previousVersion,
                previousVersion: action.before.activeVersion,
                status: 'restored',
              }
            : {
                ...value,
                status:
                  mode === 'check-failure'
                    ? 'update_failed'
                    : mode === 'candidate-flow'
                      ? 'candidate_pending_validation'
                      : 'active',
                candidateVersion: mode === 'candidate-flow' ? 'nightly-2026.09.08' : null,
                lastCheckedAt: Date.now(),
              };
        action = null;
      }
    }
    if (!enginePublicStatuses.includes(value.status)) throw new Error('Invalid preview state');
    return value;
  },
});
app.setNotFoundHandler(async (request, reply) => {
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
console.info('Synthetic engine preview ready on 127.0.0.1:3000');
async function cleanup() {
  await app.close();
  await context.cleanup();
  storage.cleanup();
}
process.once('SIGINT', () => void cleanup());
process.once('SIGTERM', () => void cleanup());
