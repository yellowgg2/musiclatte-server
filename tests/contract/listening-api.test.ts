import { afterEach, expect, it } from 'vitest';
import {
  createListeningContext,
  listeningPayload as payload,
} from '../support/listening-harness.js';
const contexts: Awaited<ReturnType<typeof createListeningContext>>[] = [];
afterEach(async () => {
  for (const c of contexts.splice(0)) await c.cleanup();
});
/** Strict events reject unknown owners, inadequate listening and ambiguous time values. */
it('should enforce strict input and cookie CSRF before mutation', async () => {
  const c = await createListeningContext();
  contexts.push(c);
  for (const bad of [
    { ...payload, owner: 'other' },
    { ...payload, listenedMs: 0 },
    { ...payload, eventId: 'short' },
    { ...payload, qualifiedAt: '2026-09-09T00:02:00+00:00' },
    { ...payload, source: 'native' },
    { ...payload, listenedMs: 999999 },
  ])
    expect(
      (
        await c.app.inject({
          method: 'POST',
          url: '/api/v1/listening/events',
          headers: c.headers,
          payload: bad,
        })
      ).statusCode,
    ).toBe(400);
  expect(
    (
      await c.app.inject({
        method: 'POST',
        url: '/api/v1/listening/events',
        headers: { cookie: c.headers.cookie },
        payload,
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await c.app.inject({
        method: 'POST',
        url: '/api/v1/listening/events',
        headers: c.headers,
        payload,
      })
    ).statusCode,
  ).toBe(201);
});
/** Runtime opt-in is strict and startup recovery cannot take over another live API owner. */
it('should configure local recording and serialize restart recovery', async () => {
  const c = await createListeningContext(false);
  contexts.push(c);
  const { readListeningConfig } = await import('../../apps/api/src/config/runtime.js');
  expect(readListeningConfig({})).toEqual({ enabled: false, scrobble: false });
  expect(() => readListeningConfig({ LISTENING_ENABLED: '1' })).toThrow();
  const { createConfiguredApp } = await import('../../apps/api/src/auth/runtime.js');
  const { origin, browserHeaders, password, cookieOf } = await import('../support/auth-harness.js');
  const event = {
    identityKey: 'a'.repeat(64),
    eventIdHash: 'b'.repeat(64),
    requestHash: 'c'.repeat(64),
    songId: 'tr-1',
    startedAt: 0,
    qualifiedAt: 1,
  };
  const stored = c.repository.insert(event);
  c.repository.claim(stored.sequence);
  await c.app.close();
  const env = {
    PUBLIC_ORIGIN: origin,
    GONIC_UPSTREAM: c.options.upstream,
    MANAGEMENT_DIRECTORY: c.storage.data,
    CREDENTIAL_KEY_PATH: c.storage.keyPath,
    LISTENING_ENABLED: 'true',
    SESSION_MAX_AGE_SECONDS: '60',
  };
  const app = createConfiguredApp(env);
  try {
    expect(c.repository.receipt(event.identityKey, event.eventIdHash)?.status).toBe('uncertain');
    expect(() => createConfiguredApp(env)).toThrow('Invalid authentication configuration');
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/session',
      headers: browserHeaders,
      payload: password,
    });
    expect(login.statusCode).toBe(201);
    const caps = await app.inject({
      url: '/api/v1/capabilities',
      headers: { cookie: cookieOf(login) },
    });
    expect(caps.json().features['listening.history']).toEqual({
      supported: true,
      permission: 'allowed',
      availability: 'available',
    });
    expect(c.requests.filter((url) => url.pathname === '/rest/scrobble')).toHaveLength(0);
  } finally {
    await app.close();
  }
  const restarted = createConfiguredApp(env);
  await restarted.close();
});
/** Native bearer uses the existing authenticated route, while mixed credentials and duplicates fail. */
it('should accept bearer auth and reject mixed auth or duplicate fields', async () => {
  const c = await createListeningContext(false);
  contexts.push(c);
  const { native } = await import('../support/auth-harness.js');
  const login = await c.login(
    { 'content-type': 'application/json', 'x-musiclatte-client': 'native' },
    native,
  );
  const authorization = `Bearer ${login.json().accessToken}`;
  expect(
    (
      await c.app.inject({
        method: 'POST',
        url: '/api/v1/listening/events',
        headers: { authorization },
        payload,
      })
    ).statusCode,
  ).toBe(201);
  expect(
    (
      await c.app.inject({
        url: '/api/v1/listening/history',
        headers: { authorization, cookie: c.headers.cookie },
      })
    ).statusCode,
  ).toBe(400);
  const duplicate = JSON.stringify(payload).replace(
    '"songId":"tr-1"',
    '"songId":"tr-1","songId":"tr-2"',
  );
  expect(
    (
      await c.app.inject({
        method: 'POST',
        url: '/api/v1/listening/events',
        headers: c.headers,
        payload: duplicate,
      })
    ).statusCode,
  ).toBe(400);
});
