import { request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import {
  browserHeaders,
  cookieOf,
  createTestContext,
  native,
  password,
} from '../../../tests/support/auth-harness.js';

/** Real sessions, SQLite and a loopback upstream; no engine process exists in the HTTP app. */
export async function engineContext() {
  const ctx = await createTestContext();
  let now = 1000;
  const imports = {
    database: ctx.storage.db,
    clock: () => now,
    policy: { enabled: true, libraries: [], engineManagers: [password.username] },
  };
  ctx.state.adminRole = true;
  ctx.storage.engines.initialize('nightly-1');
  ctx.storage.workerStates.heartbeat({ workerId: 'worker', status: 'idle' });
  const app = createApp({ ...ctx.options, imports });
  const login = await ctx.login();
  const headers = {
    ...browserHeaders,
    cookie: cookieOf(login),
    'x-csrf-token': login.json().csrfToken as string,
  };
  return {
    ...ctx,
    app,
    imports,
    headers,
    get: () => app.inject({ url: '/api/v1/engine', headers }),
    post: (payload: object = { action: 'check_now' }) =>
      app.inject({ method: 'POST', url: '/api/v1/engine', headers, payload }),
    count: () =>
      ctx.storage.db.connection.prepare('SELECT count(*) AS n FROM engine_requests').get()?.n,
    setNow: (value: number) => {
      now = value;
    },
    cleanup: async () => {
      await app.close();
      await ctx.cleanup();
    },
  };
}

describe('engine API', () => {
  const contexts: Awaited<ReturnType<typeof engineContext>>[] = [];
  async function makeSUT() {
    const c = await engineContext();
    contexts.push(c);
    return c;
  }
  afterEach(async () => {
    for (const c of contexts.splice(0)) await c.cleanup();
  });

  /** A read returns only public state and never starts the daily scheduler. */
  it('should return an exact read-only nightly projection', async () => {
    const c = await makeSUT();
    const before = c.storage.engines.get();
    const response = await c.get();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      schemaVersion: 1,
      channel: 'nightly',
      activeVersion: 'nightly-1',
      candidateVersion: null,
      previousVersion: null,
      lastCheckedAt: null,
      lastSuccessfulCheckAt: null,
      status: 'never_checked',
      recoverability: 'no_previous',
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(c.storage.engines.get()).toEqual(before);
    expect(c.count()).toBe(0);
    expect(c.requests.every((u) => u.pathname === '/rest/getUser')).toBe(true);
  });

  /** Both current upstream admin role and the explicit operator allowlist are required. */
  it.each(['normal', 'admin-not-listed', 'disabled'])(
    'should deny %s without side effects',
    async (mode) => {
      const c = await makeSUT();
      if (mode === 'normal') c.state.adminRole = false;
      if (mode === 'admin-not-listed') c.imports.policy.engineManagers = [];
      if (mode === 'disabled') c.imports.policy.enabled = false;
      expect((await c.get()).statusCode).toBe(403);
      expect((await c.post()).statusCode).toBe(403);
      expect(c.count()).toBe(0);
    },
  );

  /** Exact action bodies reject arbitrary execution inputs, including forged roles. */
  it.each([
    {},
    { action: 'update' },
    { action: ['check_now'] },
    { action: 'check_now', adminRole: true },
    ...['version', 'channel', 'path', 'url', 'binary', 'command'].map((k) => ({
      action: 'check_now',
      [k]: 'untrusted',
    })),
  ])('should reject invalid action %#', async (payload) => {
    const c = await makeSUT();
    expect((await c.post(payload)).statusCode).toBe(400);
    expect(c.count()).toBe(0);
  });

  /** Cookie mutations retain Origin/CSRF/JSON defenses and do not introduce bearer write scopes. */
  it('should reject missing auth, CSRF, foreign Origin, bearer mutation and all queries', async () => {
    const c = await makeSUT();
    expect((await c.app.inject('/api/v1/engine')).statusCode).toBe(401);
    for (const headers of [
      { ...c.headers, 'x-csrf-token': '' },
      { ...c.headers, origin: 'https://other.example.test' },
    ]) {
      expect(
        (
          await c.app.inject({
            method: 'POST',
            url: '/api/v1/engine',
            headers,
            payload: { action: 'check_now' },
          })
        ).statusCode,
      ).toBe(403);
    }
    const token = (await c.login({ 'content-type': 'application/json' }, native)).json()
      .accessToken;
    expect(
      (
        await c.app.inject({
          method: 'POST',
          url: '/api/v1/engine',
          headers: { authorization: `Bearer ${token}` },
          payload: { action: 'check_now' },
        })
      ).statusCode,
    ).toBe(403);
    for (const url of ['/api/v1/engine?x=1', '/api/v1/engine?action=check_now']) {
      expect((await c.app.inject({ url, headers: c.headers })).statusCode).toBe(400);
      expect(
        (
          await c.app.inject({
            method: 'POST',
            url,
            headers: c.headers,
            payload: { action: 'check_now' },
          })
        ).statusCode,
      ).toBe(400);
    }
    const address = await c.app.listen({ port: 0, host: '127.0.0.1' });
    for (const method of ['GET', 'POST']) {
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const req = httpRequest(
          new URL(address),
          { path: '/api/v1/engine?', method, headers: c.headers },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode));
          },
        );
        req.on('error', reject);
        req.end(method === 'POST' ? JSON.stringify({ action: 'check_now' }) : undefined);
      });
      expect(status).toBe(400);
    }
    expect(c.count()).toBe(0);
  });

  /** Concurrent requests durably collapse without changing the active selection or invoking a process. */
  it('should accept one durable check intent and coalesce replays across app instances', async () => {
    const c = await makeSUT();
    const before = c.storage.engines.get();
    const responses = await Promise.all([c.post(), c.post(), c.post()]);
    expect(responses.map((r) => r.statusCode)).toEqual([202, 202, 202]);
    expect(c.count()).toBe(1);
    expect(c.storage.engines.get()).toEqual(before);
    const other = createApp({
      ...c.options,
      imports: { ...c.imports, database: c.storage.open() },
    });
    try {
      expect(
        (
          await other.inject({
            method: 'POST',
            url: '/api/v1/engine',
            headers: c.headers,
            payload: { action: 'check_now' },
          })
        ).statusCode,
      ).toBe(202);
      expect(c.count()).toBe(1);
    } finally {
      await other.close();
    }
  });

  /** Busy checks are acknowledged as current state; no competing intent is stored. */
  it('should coalesce a running check and reject restore without previous', async () => {
    const c = await makeSUT();
    c.storage.engines.claim('check');
    expect((await c.post()).statusCode).toBe(202);
    expect((await c.post()).json().status).toBe('checking');
    expect(c.count()).toBe(0);
    expect((await c.post({ action: 'restore_previous' })).statusCode).toBe(409);
  });

  /** Worker or engine outages affect writes/capabilities but leave manager diagnosis readable. */
  it('should reflect availability and policy in capabilities and revisions', async () => {
    const c = await makeSUT();
    const caps = async () =>
      (await c.app.inject({ url: '/api/v1/capabilities', headers: c.headers })).json();
    const first = await caps();
    expect(first.features['engine.manage']).toEqual({
      supported: true,
      permission: 'allowed',
      availability: 'available',
    });
    c.setNow(31_000);
    const stale = await caps();
    expect(stale.features['engine.manage'].availability).toBe('temporarily_unavailable');
    expect(stale.revision).not.toBe(first.revision);
    expect((await c.get()).statusCode).toBe(200);
    expect((await c.post()).statusCode).toBe(503);
    c.setNow(1000);
    c.storage.engines.recordCheck({ status: 'failed', succeeded: false });
    expect((await caps()).features['engine.manage'].availability).toBe('temporarily_unavailable');
    c.imports.policy.engineManagers = [];
    const denied = await caps();
    expect(denied.features['engine.manage']).toEqual({
      supported: true,
      permission: 'denied',
      availability: 'available',
    });
    expect(denied.revision).not.toBe(stale.revision);
    c.imports.policy.enabled = false;
    expect((await caps()).features['engine.manage'].supported).toBe(false);
    expect(c.count()).toBe(0);
  });

  /** Revocation during identity I/O must precede the intent write, not merely suppress its response. */
  it.each(['revoke', 'policy', 'role'])(
    'should reject late %s changes before admission',
    async (kind) => {
      const c = await makeSUT();
      let calls = 0;
      c.state.identityResponseGate = async () => {
        if (++calls === 1) {
          if (kind === 'revoke') c.storage.instances.bumpPolicyRevision();
          if (kind === 'policy') c.imports.policy.engineManagers = [];
          if (kind === 'role') c.state.adminRole = false;
        }
      };
      expect((await c.post()).statusCode).toBe(kind === 'revoke' ? 401 : 403);
      expect(c.count()).toBe(0);
    },
  );

  /** A second authenticated account never inherits another manager's allowlist membership. */
  it('should enforce current identity for two accounts and role changes', async () => {
    const c = await makeSUT();
    c.state.accountIdentityFromProof = true;
    const second = await c.login(browserHeaders, { ...password, username: 'other-manager' });
    const headers = {
      ...browserHeaders,
      cookie: cookieOf(second),
      'x-csrf-token': second.json().csrfToken as string,
    };
    expect((await c.app.inject({ url: '/api/v1/engine', headers })).statusCode).toBe(403);
    c.imports.policy.engineManagers.push('other-manager');
    expect((await c.app.inject({ url: '/api/v1/engine', headers })).statusCode).toBe(200);
    c.state.adminRole = false;
    expect(
      (
        await c.app.inject({
          method: 'POST',
          url: '/api/v1/engine',
          headers,
          payload: { action: 'check_now' },
        })
      ).statusCode,
    ).toBe(403);
    expect(c.count()).toBe(0);
  });
  /** Private lifecycle fields and failed restore details never cross the public response boundary. */
  it('should redact internal state and reject a known invalid previous selection', async () => {
    const c = await makeSUT();
    c.storage.engines.recordCheck({
      status: 'candidate_ready',
      candidateVersion: 'nightly-2',
      succeeded: true,
    });
    c.storage.engines.activateCandidate();
    expect((await c.post({ action: 'restore_previous' })).statusCode).toBe(202);
    c.storage.db.connection.exec("UPDATE engine_requests SET status='failed'");
    const response = await c.get();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      activeVersion: 'nightly-2',
      previousVersion: 'nightly-1',
      lastCheckedAt: 1000,
      lastSuccessfulCheckAt: 1000,
      recoverability: 'temporarily_unavailable',
    });
    expect(response.body).not.toMatch(
      /candidateKey|candidateHash|operationToken|executable|argv|stderr|credential|failureCode/,
    );
    expect((await c.post({ action: 'restore_previous' })).statusCode).toBe(409);
    expect(
      (await c.app.inject({ url: '/api/v1/capabilities', headers: c.headers })).json().features[
        'engine.manage'
      ].availability,
    ).toBe('temporarily_unavailable');
  });

  /** Capabilities must use the latest role after the optional random-song network probe. */
  it('should not publish stale manager permission after a probe-time role change', async () => {
    const c = await makeSUT();
    c.state.identityResponseGate = async () => {
      c.state.adminRole = false;
    };
    const result = await c.app.inject({ url: '/api/v1/capabilities', headers: c.headers });
    expect(result.statusCode).toBe(200);
    expect(result.json().features['engine.manage'].permission).toBe('denied');
  });
});
