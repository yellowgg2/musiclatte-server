import { afterEach, expect, it } from 'vitest';
import { createMixContext } from '../support/mix-harness.js';
const contexts: Awaited<ReturnType<typeof createMixContext>>[] = [];
afterEach(async () => {
  for (const c of contexts.splice(0)) await c.cleanup();
});
/** Cookie intent and strict payloads protect account-owned mix mutations. */
it('should require authentication csrf and unambiguous JSON', async () => {
  const c = await createMixContext();
  contexts.push(c);
  expect((await c.app.inject('/api/v1/mixes')).statusCode).toBe(401);
  const payload = { operationId: 'a'.repeat(22), name: 'Mix', conditions: {} };
  const noCSRF = { ...c.headers };
  delete noCSRF['x-csrf-token'];
  expect(
    (await c.app.inject({ method: 'POST', url: '/api/v1/mixes', headers: noCSRF, payload }))
      .statusCode,
  ).toBe(403);
  expect(
    (
      await c.app.inject({
        method: 'POST',
        url: '/api/v1/mixes',
        headers: c.headers,
        payload: { ...payload, owner: 'other' },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await c.app.inject({
        method: 'POST',
        url: '/api/v1/mixes',
        headers: c.headers,
        payload:
          '{"operationId":"aaaaaaaaaaaaaaaaaaaaaa","name":"Mix","conditions":{"size":2,"size":3}}',
      })
    ).statusCode,
  ).toBe(400);
});
/** Runtime flags reject truthy shortcuts and default to false. */
it('should require an exact boolean runtime flag', async () => {
  const { readMixEnabled } = await import('../../apps/api/src/config/runtime.js');
  expect(readMixEnabled({})).toBe(false);
  expect(readMixEnabled({ MIXES_ENABLED: 'true' })).toBe(true);
  for (const value of ['1', '', 'TRUE', 'yes'])
    expect(() => readMixEnabled({ MIXES_ENABLED: value })).toThrow();
});
/** Bearer clients can save without cookie CSRF, while mixed credentials are rejected. */
it('should support bearer auth and reject mixed credentials', async () => {
  const c = await createMixContext();
  contexts.push(c);
  const { native } = await import('../support/auth-harness.js');
  const login = await c.login(
    { 'content-type': 'application/json', 'x-musiclatte-client': 'native' },
    native,
  );
  expect(login.statusCode).toBe(201);
  const authorization = `Bearer ${login.json().accessToken}`;
  const payload = { operationId: 'b'.repeat(22), name: 'Bearer mix', conditions: {} };
  expect(
    (
      await c.app.inject({
        method: 'POST',
        url: '/api/v1/mixes',
        headers: { authorization },
        payload,
      })
    ).statusCode,
  ).toBe(201);
  expect(
    (
      await c.app.inject({
        url: '/api/v1/mixes',
        headers: { authorization, cookie: c.headers.cookie },
      })
    ).statusCode,
  ).toBe(400);
});
/** Operator configuration actually injects the repository into a running API instance. */
it('should enable the configured runtime without deployment overlays', async () => {
  const c = await createMixContext();
  contexts.push(c);
  const { createConfiguredApp } = await import('../../apps/api/src/auth/runtime.js');
  const { browserHeaders, password, cookieOf, origin } = await import('../support/auth-harness.js');
  const app = createConfiguredApp({
    PUBLIC_ORIGIN: origin,
    GONIC_UPSTREAM: c.options.upstream,
    MANAGEMENT_DIRECTORY: c.storage.data,
    CREDENTIAL_KEY_PATH: c.storage.keyPath,
    MIXES_ENABLED: 'true',
    SESSION_MAX_AGE_SECONDS: '60',
  });
  try {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/session',
      headers: browserHeaders,
      payload: password,
    });
    expect(login.statusCode).toBe(201);
    expect(
      (await app.inject({ url: '/api/v1/mixes', headers: { cookie: cookieOf(login) } })).statusCode,
    ).toBe(200);
  } finally {
    await app.close();
  }
});
