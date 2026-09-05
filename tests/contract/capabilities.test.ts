import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cookieOf, createTestContext, password } from '../support/auth-harness.js';

interface Decoder {
  decodeDiscovery: (value: unknown) => unknown;
  decodeCapabilities: (value: unknown) => {
    features: Record<
      string,
      { supported: boolean | null; permission: string; availability: string }
    >;
  };
  discoveryOutcome: (status: number, body: unknown) => { extension: string; standard: string };
}
async function decoder(): Promise<Decoder> {
  const path = resolve('packages/contracts/src/capabilities.ts');
  expect(existsSync(path), 'versioned capability decoder must exist').toBe(true);
  return import(path);
}
const manifest = {
  protocol: 'musiclatte-server',
  schemaVersion: 1,
  instanceId: 'fixture-instance',
  apiBase: '/api/v1',
  authSchemes: ['cookie', 'bearer'],
};
const feature = { supported: true, permission: 'allowed', availability: 'available' };
const capabilities = {
  schemaVersion: 1,
  instanceId: 'fixture-instance',
  revision: 'fixture-revision',
  features: { 'music.browse': feature },
};
describe('private capability contract', () => {
  const contexts: Awaited<ReturnType<typeof createTestContext>>[] = [];
  async function makeSUT() {
    const ctx = await createTestContext();
    contexts.push(ctx);
    return ctx;
  }
  afterEach(async () => {
    for (const ctx of contexts.splice(0)) await ctx.cleanup();
  });
  /** Public discovery contains only instance/schema/base/auth metadata. */
  it('should expose a secret-free manifest and require authentication for capabilities', async () => {
    const ctx = await makeSUT();
    const response = await ctx.app.inject('/.well-known/musiclatte-server');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ...manifest, instanceId: ctx.storage.instances.get().id });
    expect(ctx.requests).toHaveLength(0);
    expect((await ctx.app.inject('/api/v1/capabilities')).statusCode).toBe(401);
    const parsed = (await decoder()).decodeDiscovery(response.json());
    expect(parsed).toEqual(response.json());
  });
  /** P1 standard capabilities remain distinct from unimplemented private mutations. */
  it('should publish authenticated support permission availability and identity-scoped revisions', async () => {
    const ctx = await makeSUT();
    const login = await ctx.login();
    const response = await ctx.app.inject({
      url: '/api/v1/capabilities',
      headers: { cookie: cookieOf(login) },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    const decoded = (await decoder()).decodeCapabilities(body);
    for (const key of ['music.browse', 'music.stream', 'library.randomSongs'])
      expect(decoded.features[key]).toEqual(feature);
    expect(decoded.features['playlists.read']).toEqual(feature);
    expect(decoded.features['playlists.write']).toEqual(feature);
    expect(decoded.features['favorites.songs']).toEqual(feature);
    for (const key of [
      'imports.youtube',
      'library.recentDownloads',
      'engine.manage',
      'metadata.write',
      'metadata.lyrics.write',
      'metadata.curation',
      'automation.tokens',
    ])
      expect(decoded.features[key]?.supported).toBe(false);
    expect(decoded.features['library.scan']?.permission).toBe('denied');
    expect(body).not.toHaveProperty('folder');
    const other = await ctx.login();
    const next = await ctx.app.inject({
      url: '/api/v1/capabilities',
      headers: { cookie: cookieOf(other) },
    });
    expect(next.json().revision).not.toBe(body.revision);
    expect(next.json().instanceId).toBe(body.instanceId);
    ctx.state.adminRole = true;
    const roleChanged = await ctx.app.inject({
      url: '/api/v1/capabilities',
      headers: { cookie: cookieOf(other) },
    });
    expect(roleChanged.json().revision).not.toBe(next.json().revision);
    ctx.storage.instances.bumpPolicyRevision();
    expect(
      (await ctx.app.inject({ url: '/api/v1/capabilities', headers: { cookie: cookieOf(other) } }))
        .statusCode,
    ).toBe(401);
  });
  /** Probe failures are not permanent unsupported flags or account ACLs. */
  it.each([404, 401, 403, 503])(
    'should distinguish random probe HTTP %s from unsupported',
    async (status) => {
      const ctx = await makeSUT();
      const login = await ctx.login();
      const cookie = cookieOf(login);
      ctx.state.randomStatus = status;
      const response = await ctx.app.inject({ url: '/api/v1/capabilities', headers: { cookie } });
      if (status === 401) {
        expect(response.statusCode).toBe(401);
        ctx.state.randomStatus = 200;
        expect(
          (await ctx.app.inject({ url: '/api/v1/session', headers: { cookie } })).statusCode,
        ).toBe(401);
        return;
      }
      expect(response.statusCode).toBe(200);
      const value = response.json().features['library.randomSongs'];
      expect(value.supported).not.toBe(false);
      expect(value.permission).toBe(status === 403 ? 'denied' : 'allowed');
      expect(value.availability).toBe(status === 403 ? 'available' : 'temporarily_unavailable');
      ctx.state.randomStatus = 200;
      expect(
        (await ctx.app.inject({ url: '/api/v1/capabilities', headers: { cookie } })).json()
          .features['library.randomSongs'],
      ).toEqual(feature);
      expect(
        ctx.requests
          .filter((u) => u.pathname === '/rest/getRandomSongs')
          .every((u) => u.searchParams.get('size') === '1'),
      ).toBe(true);
    },
  );
  /** Temporary identity service failures produce retryable errors without fabricated capabilities. */
  it('should return retryable unavailable on upstream timeout and recover the same session', async () => {
    const ctx = await makeSUT();
    const login = await ctx.login();
    ctx.state.stall = true;
    const headers = { cookie: cookieOf(login) };
    const response = await ctx.app.inject({ url: '/api/v1/capabilities', headers });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      schemaVersion: 1,
      error: { code: 'upstream_unavailable', retryable: true },
    });
    ctx.state.stall = false;
    expect((await ctx.app.inject({ url: '/api/v1/session', headers })).statusCode).toBe(200);
  });
  /** Discovery failure never disables standard stock gonic or Airsonic behavior. */
  it.each([
    ['gonic', 404],
    ['Airsonic', 410],
    ['timeout', 0],
    ['auth', 401],
    ['denied', 403],
    ['unavailable', 503],
  ])('should preserve standard fallback for %s', async (_server, status) => {
    expect((await decoder()).discoveryOutcome(Number(status), null)).toEqual({
      extension: status === 404 || status === 410 ? 'absent' : 'unknown',
      standard: 'preserve',
    });
  });
  /** Unknown response fields are ignored and partial/all support remains per feature. */
  it('should accept known schema with unknown fields and feature keys', async () => {
    const d = await decoder();
    expect(d.decodeDiscovery({ ...manifest, future: true })).toEqual(manifest);
    const value = d.decodeCapabilities({
      ...capabilities,
      future: true,
      features: {
        'music.browse': { ...feature, future: true },
        'metadata.write': { ...feature, permission: 'denied' },
        'imports.youtube': { ...feature, supported: false },
        'future.feature': 'unknown-shape',
      },
    });
    expect(value.features).toEqual({
      'music.browse': feature,
      'metadata.write': { ...feature, permission: 'denied' },
      'imports.youtube': { ...feature, supported: false },
    });
  });
  /** Malformed/version-incompatible discovery disables extensions without redirecting credentials. */
  it.each([
    { ...manifest, schemaVersion: 2 },
    { ...manifest, instanceId: '' },
    { ...manifest, apiBase: '//evil.test/api' },
    { ...manifest, apiBase: 'https://evil.test/api' },
    { ...manifest, apiBase: '/api/../other' },
    { ...manifest, authSchemes: [] },
    '<html>login</html>',
  ])('should reject unsafe discovery %#', async (body) => {
    const d = await decoder();
    expect(() => d.decodeDiscovery(body)).toThrow();
    expect(d.discoveryOutcome(200, body)).toEqual({ extension: 'unknown', standard: 'preserve' });
  });
  /** Required capability schema is validated without coercion. */
  it.each([
    { ...capabilities, schemaVersion: '1' },
    { ...capabilities, revision: '' },
    { ...capabilities, features: {} },
    { ...capabilities, features: { 'music.browse': { ...feature, supported: 'true' } } },
    { ...capabilities, features: { 'music.browse': { supported: true } } },
  ])('should reject malformed capabilities %#', async (body) => {
    const d = await decoder();
    expect(() => d.decodeCapabilities(body)).toThrow();
  });
  /** Previously observed support survives a temporary probe outage within the same session. */
  it('should retain known random support while marking temporary unavailability', async () => {
    const ctx = await makeSUT();
    const login = await ctx.login();
    const headers = { cookie: cookieOf(login) };
    expect(
      (await ctx.app.inject({ url: '/api/v1/capabilities', headers })).json().features[
        'library.randomSongs'
      ].supported,
    ).toBe(true);
    ctx.state.randomStatus = 503;
    expect(
      (await ctx.app.inject({ url: '/api/v1/capabilities', headers })).json().features[
        'library.randomSongs'
      ],
    ).toEqual({ supported: true, permission: 'allowed', availability: 'temporarily_unavailable' });
    const fresh = await ctx.login();
    expect(
      (
        await ctx.app.inject({ url: '/api/v1/capabilities', headers: { cookie: cookieOf(fresh) } })
      ).json().features['library.randomSongs'].supported,
    ).toBeNull();
  });
});
