import { afterEach, describe, expect, it } from 'vitest';
import {
  browserHeaders,
  cookieOf,
  createTestContext,
  native,
  origin,
  password,
} from '../../../tests/support/auth-harness.js';

describe('session and permissions API', () => {
  const contexts: Awaited<ReturnType<typeof createTestContext>>[] = [];
  async function makeSUT(allowScan = false) {
    const ctx = await createTestContext({ allowScan });
    contexts.push(ctx);
    return ctx;
  }
  afterEach(async () => {
    for (const ctx of contexts.splice(0)) await ctx.cleanup();
  });
  /** Password exchange stores only encrypted proof and emits a secure opaque cookie. */
  it('should login and restore without exposing credentials', async () => {
    const ctx = await makeSUT();
    const login = await ctx.login();
    expect(login.statusCode).toBe(201);
    expect(login.headers['set-cookie']).toMatch(/HttpOnly/);
    expect(login.headers['set-cookie']).toMatch(/Secure/);
    expect(login.headers['set-cookie']).toMatch(/SameSite=Strict/);
    expect(login.headers['cache-control']).toBe('no-store');
    expect(login.json()).toMatchObject({
      schemaVersion: 1,
      username: password.username,
      authScheme: 'cookie',
      expiresAt: 2000,
    });
    expect(login.json().csrfToken).toEqual(expect.any(String));
    expect(login.json().accessToken).toBeUndefined();
    const restored = await ctx.app.inject({
      url: '/api/v1/session',
      headers: { cookie: cookieOf(login) },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toEqual(login.json());
    expect(login.body).not.toContain(password.password);
    expect(login.body).not.toContain(native.t);
    expect(
      ctx.storage.db.connection.prepare('SELECT encrypted_proof FROM sessions').get()
        ?.encrypted_proof,
    ).not.toContain(native.s);
    expect(ctx.requests.every((url) => !url.searchParams.has('p'))).toBe(true);
  });
  /** Cookie reauthentication rotates the token and CSRF identity, revoking the previous token. */
  it('should rotate on login and reject the previous session', async () => {
    const ctx = await makeSUT();
    const first = await ctx.login();
    const second = await ctx.login({
      ...browserHeaders,
      cookie: cookieOf(first),
      'x-csrf-token': first.json().csrfToken,
    });
    expect(second.statusCode).toBe(201);
    expect(cookieOf(second)).not.toBe(cookieOf(first));
    expect(second.json().csrfToken).not.toBe(first.json().csrfToken);
    expect(
      (await ctx.app.inject({ url: '/api/v1/session', headers: { cookie: cookieOf(first) } }))
        .statusCode,
    ).toBe(401);
  });
  /** Origin, JSON, custom login header and existing-session CSRF are enforced before upstream calls. */
  it.each(['origin', 'null-origin', 'json', 'header', 'csrf'])(
    'should reject invalid cookie login %s',
    async (kind) => {
      const ctx = await makeSUT();
      const first = await ctx.login();
      const count = ctx.requests.length;
      const headers: Record<string, string> = { ...browserHeaders };
      if (kind === 'origin') headers.origin = 'https://evil.example.test';
      if (kind === 'null-origin') headers.origin = 'null';
      if (kind === 'json') headers['content-type'] = 'text/plain';
      if (kind === 'header') delete headers['x-musiclatte-client'];
      if (kind === 'csrf') headers.cookie = cookieOf(first);
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/session',
        headers,
        payload: JSON.stringify(password),
      });
      expect([400, 403, 415]).toContain(response.statusCode);
      expect(ctx.requests).toHaveLength(count);
    },
  );
  /** Expiry is absolute and logout removes the reusable credential. */
  it.each(['logout', 'expiry'])('should deny access after %s', async (mode) => {
    const ctx = await makeSUT();
    const login = await ctx.login();
    const cookie = cookieOf(login);
    if (mode === 'logout') {
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/api/v1/session',
        headers: { ...browserHeaders, cookie, 'x-csrf-token': login.json().csrfToken },
        payload: {},
      });
      expect(response.statusCode).toBe(204);
      expect(response.headers['set-cookie']).toContain('Max-Age=0');
    } else ctx.storage.setNow(2000);
    expect(
      (await ctx.app.inject({ url: '/api/v1/capabilities', headers: { cookie } })).statusCode,
    ).toBe(401);
    expect(
      ctx.storage.db.connection.prepare('SELECT encrypted_proof FROM sessions').get()
        ?.encrypted_proof,
    ).toBeNull();
  });
  /** Native exchange returns a bearer only, with rotation and logout independent of cookies. */
  it('should keep native bearer separate from cookie transport', async () => {
    const ctx = await makeSUT();
    const login = await ctx.login(
      { 'content-type': 'application/json', 'x-musiclatte-client': 'native' },
      native,
    );
    expect(login.statusCode).toBe(201);
    expect(login.headers['set-cookie']).toBeUndefined();
    const token = login.json().accessToken;
    expect(token).toEqual(expect.any(String));
    expect(login.json().csrfToken).toBeUndefined();
    const headers = { authorization: `Bearer ${token}` };
    expect((await ctx.app.inject({ url: '/api/v1/session', headers })).statusCode).toBe(200);
    expect(
      (
        await ctx.app.inject({
          url: '/api/v1/session',
          headers: { cookie: `__Host-musiclatte-session=${token}` },
        })
      ).statusCode,
    ).toBe(401);
    expect((await ctx.app.inject(`/api/v1/session?access_token=${token}`)).statusCode).toBe(400);
    const next = await ctx.login(
      { ...headers, 'content-type': 'application/json', 'x-musiclatte-client': 'native' },
      native,
    );
    expect(next.statusCode).toBe(201);
    expect(next.json().accessToken).not.toBe(token);
    expect((await ctx.app.inject({ url: '/api/v1/session', headers })).statusCode).toBe(401);
    expect(
      (
        await ctx.app.inject({
          method: 'DELETE',
          url: '/api/v1/session',
          headers: { authorization: `Bearer ${next.json().accessToken}` },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await ctx.app.inject({
          url: '/api/v1/session',
          headers: { authorization: `Bearer ${next.json().accessToken}` },
        })
      ).statusCode,
    ).toBe(401);
  });
  /** Cookies cannot be relabeled as native bearer and ambiguous credentials are rejected. */
  it('should reject cross transport and mixed authentication', async () => {
    const ctx = await makeSUT();
    const login = await ctx.login();
    const cookie = cookieOf(login);
    const token = cookie.slice(cookie.indexOf('=') + 1);
    for (const headers of [
      { authorization: `Bearer ${token}` },
      { authorization: `Bearer ${token.replace(/^cookie/, 'bearer')}` },
      { authorization: 'Bearer invalid', cookie },
    ]) {
      expect([400, 401]).toContain(
        (await ctx.app.inject({ url: '/api/v1/session', headers })).statusCode,
      );
    }
    expect(
      (await ctx.login({ ...browserHeaders, 'x-musiclatte-client': 'native' }, native)).statusCode,
    ).toBe(403);
  });
  /** Upstream bad credentials and identity changes revoke sessions; transient failures do not. */
  it.each(['auth', 'identity', 'http401', 'forbidden', 'unavailable'])(
    'should handle upstream %s distinctly',
    async (kind) => {
      const ctx = await makeSUT();
      const login = await ctx.login();
      const cookie = cookieOf(login);
      if (kind === 'auth') ctx.state.error = 40;
      if (kind === 'identity') ctx.state.username = 'other-account';
      if (kind === 'http401') ctx.state.status = 401;
      if (kind === 'forbidden') ctx.state.error = 50;
      if (kind === 'unavailable') ctx.state.status = 503;
      const expected = kind === 'forbidden' ? 403 : kind === 'unavailable' ? 503 : 401;
      const response = await ctx.app.inject({ url: '/api/v1/session', headers: { cookie } });
      expect(response.statusCode).toBe(expected);
      expect(response.body).not.toContain('synthetic-secret-upstream-message');
      ctx.state.error = 0;
      ctx.state.status = 200;
      ctx.state.username = password.username;
      expect(
        (await ctx.app.inject({ url: '/api/v1/session', headers: { cookie } })).statusCode,
      ).toBe(expected === 401 ? 401 : 200);
    },
  );
  /** User supplied upstream, unknown fields and malformed bodies never reach gonic. */
  it.each([
    { ...password, upstream: 'https://evil.example.test' },
    { ...password, extra: true },
    { ...password, username: 1 },
    { kind: 'password', username: password.username },
    { ...native, t: 'invalid' },
  ])('should reject malformed exchange %#', async (payload) => {
    const ctx = await makeSUT();
    const response = await ctx.login(browserHeaders, payload);
    expect(response.statusCode).toBe(400);
    expect(ctx.requests).toHaveLength(0);
    expect(response.body).not.toContain(password.password);
  });
  /** Upstream redirects are not followed and raw request URLs are absent from error responses. */
  it('should refuse redirects and sanitize unknown-route and parse errors', async () => {
    const ctx = await makeSUT();
    ctx.state.redirect = 'https://evil.example.test/steal';
    const response = await ctx.login();
    expect(response.statusCode).toBe(503);
    expect(ctx.requests).toHaveLength(1);
    expect(response.headers.location).toBeUndefined();
    for (const result of [
      await ctx.app.inject('/api/v1/missing?password=synthetic-secret'),
      await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/session',
        headers: browserHeaders,
        payload: '{"password":"synthetic-secret"',
      }),
    ]) {
      expect(result.body).not.toContain('synthetic-secret');
      expect(result.json()).toHaveProperty('error.code');
    }
  });
  /** Discovery and capability reads cannot trigger scan; explicit admin action rechecks role and policy. */
  it('should scan only with opt-in policy and freshly verified adminRole', async () => {
    const ctx = await makeSUT(true);
    ctx.state.adminRole = true;
    const login = await ctx.login();
    const cookie = cookieOf(login);
    const headers = { ...browserHeaders, cookie, 'x-csrf-token': login.json().csrfToken };
    await ctx.app.inject('/.well-known/musiclatte-server');
    const cap = await ctx.app.inject({ url: '/api/v1/capabilities', headers: { cookie } });
    expect(cap.json().features['library.scan'].permission).toBe('allowed');
    expect(ctx.requests.some((u) => u.pathname.includes('Scan'))).toBe(false);
    ctx.state.adminRole = false;
    expect(
      (await ctx.app.inject({ method: 'POST', url: '/api/v1/scan', headers, payload: {} }))
        .statusCode,
    ).toBe(403);
    ctx.state.adminRole = true;
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/v1/scan',
          headers: { ...headers, 'x-csrf-token': 'wrong' },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await ctx.app.inject({ method: 'POST', url: '/api/v1/scan', headers, payload: {} }))
        .statusCode,
    ).toBe(200);
    expect(ctx.requests.slice(-2).map((u) => u.pathname)).toEqual([
      '/rest/getUser',
      '/rest/startScan',
    ]);
    expect(ctx.requests.filter((u) => u.pathname === '/rest/startScan')).toHaveLength(1);
    ctx.state.scanError = 50;
    expect(
      (await ctx.app.inject({ method: 'POST', url: '/api/v1/scan', headers, payload: {} }))
        .statusCode,
    ).toBe(403);
  });
  /** Default policy, nonboolean roles and folder arrays cannot grant management permissions. */
  it.each([true, 'true', undefined])('should default deny scan for role %s', async (role) => {
    const ctx = await makeSUT();
    ctx.state.adminRole = role;
    const login = await ctx.login();
    if (role !== true) {
      expect(login.statusCode).toBe(503);
      return;
    }
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/v1/scan',
          headers: {
            ...browserHeaders,
            cookie: cookieOf(login),
            'x-csrf-token': login.json().csrfToken,
          },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(ctx.requests.some((u) => u.pathname === '/rest/startScan')).toBe(false);
  });
  /** Login failures never create stored sessions or emit credentials. */
  it('should reject wrong password and unsupported token auth without a session', async () => {
    const ctx = await makeSUT();
    expect((await ctx.login(browserHeaders, { ...password, password: 'wrong' })).statusCode).toBe(
      401,
    );
    ctx.state.error = 41;
    const response = await ctx.login();
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('token_auth_unsupported');
    expect(ctx.storage.db.connection.prepare('SELECT count(*) AS n FROM sessions').get()?.n).toBe(
      0,
    );
  });
  /** Deployment policy cannot silently downgrade a configured HTTPS origin. */
  it('should require exact origin on cookie mutations despite spoofed proxy headers', async () => {
    const ctx = await makeSUT();
    const response = await ctx.login({
      ...browserHeaders,
      origin: 'https://evil.example.test',
      'x-forwarded-host': 'evil.example.test',
      host: 'evil.example.test',
    });
    expect(response.statusCode).toBe(403);
    expect(ctx.requests).toHaveLength(0);
    expect(origin).toMatch(/^https:/);
  });
  /** A rejected cookie is cleared so revoked/expired credentials cannot trap the login flow. */
  it('should clear rejected cookies and allow a fresh browser login', async () => {
    const ctx = await makeSUT();
    const login = await ctx.login();
    ctx.state.error = 40;
    const rejected = await ctx.app.inject({
      url: '/api/v1/session',
      headers: { cookie: cookieOf(login) },
    });
    expect(rejected.statusCode).toBe(401);
    expect(rejected.headers['set-cookie']).toContain('Max-Age=0');
    ctx.state.error = 0;
    expect((await ctx.login()).statusCode).toBe(201);
  });
  /** A discovery request never transforms a cookie token into an authenticated bearer. */
  it('should deny missing CSRF on logout without revoking the active session', async () => {
    const ctx = await makeSUT();
    const login = await ctx.login();
    const cookie = cookieOf(login);
    const denied = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/v1/session',
      headers: { ...browserHeaders, cookie },
      payload: {},
    });
    expect(denied.statusCode).toBe(403);
    expect((await ctx.app.inject({ url: '/api/v1/session', headers: { cookie } })).statusCode).toBe(
      200,
    );
  });
});
