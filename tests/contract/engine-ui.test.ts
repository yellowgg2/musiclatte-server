import { describe, expect, it } from 'vitest';
import { engineFixture, engineFixtures } from '../support/engine-fixtures.js';
import { createTestContext, browserHeaders, cookieOf, password } from '../support/auth-harness.js';
import { createApp } from '../../apps/api/src/app.js';
import {
  availableEntries,
  clientFeatures,
} from '../../apps/web/src/capabilities/client-features.js';
async function makeSUT() {
  const path = '../../apps/web/src/engine/client.js';
  const module = await import(path).catch(() => null);
  expect(module, 'strict engine decoder exists').not.toBeNull();
  return module!;
}
describe('engine UI wire contract', () => {
  /** The first settings consumer enables only the producer/account intersection. */
  it('should enable the engine consumer at its owner Step', () => {
    expect(clientFeatures['engine.manage']).toBe(true);
    for (const supported of [true, false])
      for (const permission of ['allowed', 'denied', 'unknown'] as const)
        for (const availability of ['available', 'temporarily_unavailable', 'unknown'] as const) {
          expect(
            availableEntries({
              schemaVersion: 1,
              instanceId: 'test',
              revision: '1',
              features: { 'engine.manage': { supported, permission, availability } },
            }).includes('engine.manage'),
          ).toBe(supported && permission === 'allowed' && availability === 'available');
        }
  });
  /** All public states decode; unknown, extra, missing and unsafe values fail closed. */
  it('should strictly decode engine status and accepted actions', async () => {
    const { decodeEngineStatus } = await makeSUT();
    for (const value of Object.values(engineFixtures))
      expect(decodeEngineStatus(value)).toEqual(value);
    const value = engineFixture();
    for (const bad of [
      null,
      [],
      {},
      { ...value, status: 'done' },
      { ...value, channel: 'stable' },
      { ...value, schemaVersion: 2 },
      { ...value, executable: '/private' },
      { ...value, activeVersion: '../private' },
      { ...value, activeVersion: 'a'.repeat(129) },
      { ...value, lastCheckedAt: -1 },
      { ...value, lastSuccessfulCheckAt: 1.5 },
      { ...value, lastCheckedAt: Number.MAX_SAFE_INTEGER + 1 },
      { ...value, recoverability: 'yes' },
      { ...value, previousVersion: undefined },
    ])
      expect(() => decodeEngineStatus(bad)).toThrow();
  });
  /** Authentication status takes precedence even over malformed upstream error bodies. */
  it('should map errors and reject wrong success status without exposing raw content', async () => {
    const { createEngineClient } = await makeSUT();
    for (const [status, code] of [
      [401, 'unauthenticated'],
      [403, 'forbidden'],
      [409, 'conflict'],
      [503, 'upstream_unavailable'],
    ] as const) {
      const client = createEngineClient({
        fetcher: async () => new Response('private stderr', { status }),
      });
      await expect(client.read(new AbortController().signal)).rejects.toMatchObject({ code });
    }
    const client = createEngineClient({ fetcher: async () => Response.json(engineFixture()) });
    await expect(
      client.action('check_now', { csrfToken: 'synthetic', signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: 'internal_error' });
  });
  /** Real manager/CSRF producer output is readable and GET never queues an action. */
  it('should consume the real authenticated producer and preserve strict mutations', async () => {
    const { createEngineClient } = await makeSUT();
    const c = await createTestContext();
    c.state.adminRole = true;
    c.storage.engines.initialize('nightly-1');
    c.storage.workerStates.heartbeat({ workerId: 'worker', status: 'idle' });
    const imports = {
      database: c.storage.db,
      clock: () => 1000,
      policy: { enabled: true, libraries: [], engineManagers: [password.username] },
    };
    const app = createApp({ ...c.options, imports });
    const login = await c.login();
    const headers = { ...browserHeaders, cookie: cookieOf(login) };
    const requests: RequestInit[] = [];
    const client = createEngineClient({
      apiOrigin: 'https://api.example.test',
      fetcher: async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe('https://api.example.test/api/v1/engine');
        requests.push(init!);
        const response = await app.inject({
          method: init?.method === 'POST' ? 'POST' : 'GET',
          url: '/api/v1/engine',
          headers: { ...headers, ...Object.fromEntries(new Headers(init?.headers)) },
          ...(init?.body ? { payload: String(init.body) } : {}),
        });
        return new Response(response.body, { status: response.statusCode });
      },
    });
    try {
      const before = c.storage.engines.get();
      expect((await client.read(new AbortController().signal)).status).toBe('never_checked');
      expect(c.storage.engines.get()).toEqual(before);
      expect(
        c.storage.db.connection.prepare('SELECT count(*) AS n FROM engine_requests').get()?.n,
      ).toBe(0);
      const accepted = await client.action('check_now', {
        csrfToken: login.json().csrfToken,
        signal: new AbortController().signal,
      });
      expect(accepted.status).not.toBe('active');
      expect(JSON.parse(String(requests[1]!.body))).toEqual({ action: 'check_now' });
      expect(requests[1]).toMatchObject({
        credentials: 'include',
        cache: 'no-store',
        redirect: 'error',
      });
      await expect(
        client.action('restore_previous', { csrfToken: '', signal: new AbortController().signal }),
      ).rejects.toMatchObject({ code: 'forbidden' });
      c.state.adminRole = false;
      await expect(client.read(new AbortController().signal)).rejects.toMatchObject({
        code: 'forbidden',
      });
    } finally {
      await app.close();
      await c.cleanup();
    }
  });
});
