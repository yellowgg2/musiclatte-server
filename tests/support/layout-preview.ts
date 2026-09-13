/** Synthetic normal-Router preview for Phase 16 route-wide outer-gutter verification. */
import Fastify from 'fastify';
import { createTestContext } from './auth-harness.js';
import { createTestContext as createStorage } from './session-storage-harness.js';

const storage = await createStorage();
storage.setNow(Date.now());
const context = await createTestContext({
  sessions: storage.sessionsFor(storage.db, 3_600_000),
  instances: storage.instances,
  playlistOperations: storage.playlistOperations,
  origin: 'http://127.0.0.1:5173',
  secureCookies: false,
});
context.state.accountIdentityFromProof = true;

const app = Fastify({ logger: false });
app.get('/api/v1/capabilities', async (request, reply) => {
  const response = await context.app.inject({
    url: '/api/v1/capabilities',
    headers: request.headers,
  });
  if (response.statusCode !== 200) return reply.code(response.statusCode).send(response.json());
  const result = response.json();
  for (const feature of [
    'imports.youtube',
    'library.recentDownloads',
    'listening.history',
    'metadata.curation',
    'mixes.saved',
  ]) {
    result.features[feature] = {
      supported: true,
      permission: 'allowed',
      availability: 'available',
    };
  }
  return result;
});
app.setNotFoundHandler(async (request, reply) => {
  const result = await context.app.inject({
    method: request.method as 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: request.url,
    headers: request.headers,
    ...(request.body ? { payload: JSON.stringify(request.body) } : {}),
  });
  for (const [key, value] of Object.entries(result.headers)) {
    if (value !== undefined) reply.header(key, value);
  }
  return reply.code(result.statusCode).send(result.rawPayload);
});

const clock = setInterval(() => storage.setNow(Date.now()), 100);
await app.listen({ host: '127.0.0.1', port: 3000 });
console.info('Phase 16 layout preview ready on 127.0.0.1:3000');

async function cleanup() {
  clearInterval(clock);
  await app.close();
  await context.cleanup();
  storage.cleanup();
}
process.once('SIGINT', () => void cleanup());
process.once('SIGTERM', () => void cleanup());
