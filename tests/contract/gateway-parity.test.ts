import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext } from '../support/gateway-harness.js';
describe('real gateway protocol boundary', () => {
  const contexts: Awaited<ReturnType<typeof createTestContext>>[] = [];
  async function makeSUT(enabled = true) {
    expect(existsSync('deploy/gateway.conf'), 'gateway config must exist').toBe(true);
    const ctx = await createTestContext(readFileSync('deploy/gateway.conf', 'utf8'), enabled);
    contexts.push(ctx);
    return ctx;
  }
  afterEach(async () => {
    for (const ctx of contexts.splice(0)) await ctx.cleanup();
  });
  /** Native URL, query, method and bytes survive proxying along with range/cache headers. */
  it('should preserve native requests and partial media responses without exposing auth in logs', async () => {
    const ctx = await makeSUT();
    const path =
      '/rest/stream.view?id=opaque%2Fid&t=synthetic-token&s=synthetic-salt&p=synthetic-password';
    const response = await fetch(ctx.origin + path, {
      headers: {
        range: 'bytes=2-5',
        authorization: 'Bearer synthetic-header',
        cookie: 'synthetic-cookie=value',
      },
    });
    expect(response.status).toBe(206);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([2, 3, 4, 5]);
    for (const [key, value] of Object.entries({
      'content-range': 'bytes 2-5/8',
      'accept-ranges': 'bytes',
      etag: '"synthetic"',
      'cache-control': 'private',
    }))
      expect(response.headers.get(key)).toBe(value);
    expect(ctx.requests.at(-1)).toMatchObject({ url: path, range: 'bytes=2-5', method: 'GET' });
    const post = await fetch(ctx.origin + '/rest/ping.view', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'u=fixture&p=synthetic-password',
    });
    expect(post.status).toBe(200);
    expect(ctx.requests.at(-1)?.body).toBe('u=fixture&p=synthetic-password');
    const logs = ctx.logs();
    for (const secret of [
      'synthetic-token',
      'synthetic-salt',
      'synthetic-password',
      'synthetic-header',
      'synthetic-cookie',
      'opaque',
    ])
      expect(logs).not.toContain(secret);
  }, 20_000);
  /** Native protocol errors and JSON API 404 never turn into a SPA document. */
  it('should preserve error status and separate API discovery SPA and development paths', async () => {
    const ctx = await makeSUT();
    const native = await fetch(ctx.origin + '/rest/error.view');
    expect(native.status).toBe(403);
    expect(native.headers.get('content-type')).toContain('xml');
    expect(await native.text()).toContain('code="50"');
    for (const path of ['/api', '/api/v1/missing', '/.well-known/musiclatte-server']) {
      const response = await fetch(ctx.origin + path);
      expect(response.status).toBe(path.startsWith('/.well-known') ? 200 : 404);
      expect(response.headers.get('content-type')).toContain('json');
      expect(response.headers.get('set-cookie')).toContain('Secure');
      expect(await response.text()).not.toContain('<html>');
    }
    expect(await (await fetch(ctx.origin + '/folders/opaque')).text()).toContain('id="root"');
    for (const path of [
      '/__gallery',
      '/__gallery/fixture',
      '/@vite/client',
      '/src/main.tsx',
      '/.env',
      '/assets/missing.js',
    ])
      expect((await fetch(ctx.origin + path)).status).toBe(404);
    ctx.state.unavailable = true;
    const failed = await fetch(ctx.origin + '/api/v1/missing?t=synthetic-error-secret');
    expect(failed.status).toBe(502);
    expect(failed.headers.get('content-type')).toContain('json');
    expect(await failed.text()).not.toContain('<html>');
    expect(ctx.logs()).not.toContain('synthetic-error-secret');
  }, 20_000);
  /** The unapproved product UI is available only through explicit test opt-in. */
  it('should keep the unfinished SPA disabled by default', async () => {
    const ctx = await makeSUT(false);
    expect((await fetch(ctx.origin + '/')).status).toBe(404);
    expect((await fetch(ctx.origin + '/folders/a')).status).toBe(404);
    expect((await fetch(ctx.origin + '/rest/ping.view')).status).toBe(200);
  }, 20_000);
});
