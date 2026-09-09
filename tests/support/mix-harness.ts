import { createApp } from '../../apps/api/src/app.js';
import { createMixRepository } from '../../apps/api/src/storage/mix-repository.js';
import { browserHeaders, cookieOf, createTestContext } from './auth-harness.js';
export async function createMixContext(enabled = true) {
  const ctx = await createTestContext();
  const app = createApp({
    ...ctx.options,
    ...(enabled
      ? { mixes: createMixRepository({ database: ctx.storage.db, clock: Date.now }) }
      : {}),
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
    headers,
    async cleanup() {
      await app.close();
      await ctx.cleanup();
    },
  };
}
