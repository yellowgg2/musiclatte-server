import { createApp } from '../../apps/api/src/app.js';
import { createListeningRepository } from '../../apps/api/src/storage/listening-repository.js';
import { browserHeaders, cookieOf, createTestContext } from './auth-harness.js';
export async function createListeningContext(scrobble = true, enabled = true) {
  const ctx = await createTestContext();
  let now = Date.parse('2026-09-09T00:10:00.000Z');
  const repository = createListeningRepository({ database: ctx.storage.db, clock: () => now });
  const app = createApp({
    ...ctx.options,
    ...(enabled ? { listening: { repository, scrobble, clock: () => now } } : {}),
  });
  const login = await ctx.login();
  const headers = {
    ...browserHeaders,
    cookie: cookieOf(login),
    'x-csrf-token': login.json().csrfToken,
  };
  return {
    ...ctx,
    app,
    repository,
    headers,
    advance(ms: number) {
      now += ms;
    },
    async cleanup() {
      await app.close();
      await ctx.cleanup();
    },
  };
}
export const listeningPayload = {
  eventId: 'a'.repeat(22),
  songId: 'tr-1',
  startedAt: '2026-09-09T00:00:00.000Z',
  qualifiedAt: '2026-09-09T00:04:00.000Z',
  listenedMs: 240000,
};
