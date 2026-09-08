import { afterEach, expect, it } from 'vitest';
import {
  createTestContext,
  browserHeaders,
  cookieOf,
} from '../../../tests/support/auth-harness.js';
import { createApp } from '../src/app.js';
import { createCredentialVault } from '../src/security/credential-vault.js';
import { createSubsonicClient } from '../src/subsonic/client.js';
let context: Awaited<ReturnType<typeof createTestContext>>;
let app: ReturnType<typeof createApp>;
afterEach(async () => {
  await app?.close();
  await context?.cleanup();
});
/** Schedule APIs persist only encrypted authority and apply normal browser mutation guards. */
it('requires admin permission and CSRF, then persists six-hour settings', async () => {
  context = await createTestContext({ allowScan: true });
  app = createApp({
    ...context.options,
    scan: {
      database: context.storage.db,
      vault: createCredentialVault(context.options.signingKey),
      clock: () => 1000,
      policyRevision: () => context.storage.instances.get().policyRevision,
      allowed: () => true,
      client: (proof) =>
        createSubsonicClient({ upstream: context.options.upstream, timeoutMs: 300, proof }),
    },
  });
  const login = await context.login();
  const headers = {
    ...browserHeaders,
    cookie: cookieOf(login),
    'x-csrf-token': login.json().csrfToken,
  };
  expect((await app.inject({ url: '/api/v1/scan/schedule', headers })).statusCode).toBe(403);
  context.state.adminRole = true;
  expect((await app.inject({ url: '/api/v1/scan', headers })).json()).toMatchObject({
    schemaVersion: 1,
    scanning: false,
  });
  expect((await app.inject({ url: '/api/v1/scan/schedule', headers })).json()).toMatchObject({
    enabled: false,
    intervalMinutes: 360,
  });
  const payload = { enabled: true, intervalMinutes: 360 };
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/v1/scan/schedule',
        headers: { ...headers, 'x-csrf-token': 'bad' },
        payload,
      })
    ).statusCode,
  ).toBe(403);
  for (const intervalMinutes of [0, 14, 10081, 1.5])
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/v1/scan/schedule',
          headers,
          payload: { ...payload, intervalMinutes },
        })
      ).statusCode,
    ).toBe(400);
  const response = await app.inject({
    method: 'PUT',
    url: '/api/v1/scan/schedule',
    headers,
    payload,
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ ...payload, nextRunAt: 21601000 });
  expect(response.body).not.toContain('encrypted');
  expect(
    context.storage
      .open()
      .connection.prepare('SELECT enabled,interval_minutes FROM scan_schedule')
      .get(),
  ).toEqual({ enabled: 1, interval_minutes: 360 });
  expect(
    (await app.inject({ method: 'POST', url: '/api/v1/scan', headers, payload: {} })).json(),
  ).toMatchObject({ accepted: true });
  context.state.adminRole = false;
  expect(
    (await app.inject({ method: 'PUT', url: '/api/v1/scan/schedule', headers, payload }))
      .statusCode,
  ).toBe(403);
});
