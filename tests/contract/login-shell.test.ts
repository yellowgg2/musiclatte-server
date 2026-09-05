import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, origin, password } from '../support/auth-harness.js';
import { createSessionClient } from '../../apps/web/src/auth/client.js';
import { createSessionStore } from '../../apps/web/src/auth/session-store.js';
import { resolveConfig } from 'vite';
import { resolve } from 'node:path';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function makeSUT() {
  const context = await createTestContext();
  cleanups.push(context.cleanup);
  const now = Date.now();
  context.storage.setNow(now);
  let cookie = '';
  const fetcher: typeof fetch = async (input, init) => {
    const headers = Object.fromEntries(new Headers(init?.headers));
    headers.origin = origin;
    if (cookie) headers.cookie = cookie;
    const response = await context.app.inject({
      url: String(input),
      method: (init?.method ?? 'GET') as 'GET' | 'POST' | 'DELETE',
      headers,
      ...(init?.body ? { payload: String(init.body) } : {}),
    });
    const setCookie = response.headers['set-cookie'];
    if (setCookie) cookie = String(setCookie).split(';')[0]!;
    return new Response(response.statusCode === 204 ? null : response.body, {
      status: response.statusCode,
    });
  };
  const store = createSessionStore(createSessionClient({ fetcher }));
  cleanups.push(async () => store.dispose());
  return { context, store, now };
}
describe('S03 producer to S06 consumer', () => {
  /** Browser development requests preserve origin-root API paths through the Vite proxy. */
  it('should proxy cookie API calls separately from SPA base', async () => {
    const config = await resolveConfig({ root: resolve('apps/web') }, 'serve');
    expect(config.server.proxy?.['/api']).toMatchObject({
      target: 'http://127.0.0.1:3000',
      changeOrigin: false,
    });
  });
  /** Expiry must clear the old HttpOnly cookie before the next password exchange. */
  it('should reauthenticate after expiration on the first valid submit', async () => {
    const { store, context, now } = await makeSUT();
    await store.restore();
    await store.login(password.username, password.password);
    expect(store.getSnapshot().status).toBe('signed-in');
    context.storage.setNow(now + 2000);
    await new Promise((resolve) => setTimeout(resolve, 1050));
    expect(store.getSnapshot().reason).toBe('expired');
    await store.login(password.username, password.password);
    expect(store.getSnapshot().status).toBe('signed-in');
    await store.logout();
    expect(store.getSnapshot().status).toBe('signed-out');
    await store.restore();
    expect(store.getSnapshot().status).toBe('signed-out');
  });
  /** Upstream temporary failure preserves the account; permission rejection stays distinct. */
  it('should preserve an authenticated profile through upstream outage', async () => {
    const { store, context } = await makeSUT();
    await store.login(password.username, password.password);
    context.state.status = 503;
    await store.restore();
    expect(store.getSnapshot().session?.username).toBe(password.username);
    expect(store.getSnapshot().error).toBe('upstream_unavailable');
    context.state.status = 403;
    await store.restore();
    expect(store.getSnapshot().error).toBe('forbidden');
  });
});
