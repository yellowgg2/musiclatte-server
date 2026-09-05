import { afterEach, describe, expect, it } from 'vitest';
import { cookieOf, createTestContext } from '../../../tests/support/auth-harness.js';

const routes = [
  '/folders',
  '/folders?musicFolderId=0',
  '/folders/al-1',
  '/search?q=test',
  '/artists/ar-1',
  '/albums/al-1',
  '/random',
];
describe('authenticated library API', () => {
  const contexts: Awaited<ReturnType<typeof createTestContext>>[] = [];
  async function makeSUT(timeoutMs = 300) {
    const ctx = await createTestContext({ timeoutMs });
    contexts.push(ctx);
    const headers = { cookie: cookieOf(await ctx.login()) };
    return { ...ctx, headers };
  }
  afterEach(async () => {
    for (const ctx of contexts.splice(0)) await ctx.cleanup();
  });
  /** Every explicit library route requires a session and never uses getUser.folder as an ACL. */
  it.each(routes)('should authenticate and return shared library data for %s', async (route) => {
    const ctx = await makeSUT();
    expect((await ctx.app.inject('/api/v1/music' + route)).statusCode).toBe(401);
    const result = await ctx.app.inject({ url: '/api/v1/music' + route, headers: ctx.headers });
    expect(result.statusCode).toBe(200);
    expect(result.json().schemaVersion).toBe(1);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(ctx.requests.some((u) => /Scan|stream|Playlist/.test(u.pathname))).toBe(false);
  });
  /** Opaque IDs and query text survive one decode/encode boundary without parameter injection. */
  it('should preserve encoding and forward independent search pagination only once', async () => {
    const ctx = await makeSUT();
    const id = '한글 / + % &?id=other';
    const result = await ctx.app.inject({
      url: '/api/v1/music/folders/' + encodeURIComponent(id),
      headers: ctx.headers,
    });
    expect(result.statusCode).toBe(200);
    expect(ctx.requests.at(-1)?.searchParams.getAll('id')).toEqual([id]);
    const q = '가을 & Café + 100%';
    const params = new URLSearchParams({
      q,
      musicFolderId: '0',
      songCount: '2',
      songOffset: '4',
      artistCount: '0',
      albumCount: '1',
      albumOffset: '3',
    });
    const response = await ctx.app.inject({
      url: '/api/v1/music/search?' + params,
      headers: ctx.headers,
    });
    expect(response.statusCode).toBe(200);
    expect(ctx.requests.at(-1)?.searchParams.get('query')).toBe(q);
    expect(ctx.requests.at(-1)?.searchParams.get('songOffset')).toBe('4');
    expect(ctx.requests.at(-1)?.searchParams.get('artistCount')).toBe('0');
    expect(ctx.requests.filter((u) => u.pathname === '/rest/search3')).toHaveLength(1);
    expect(response.json().result.song[0].title).toBe(q);
  });
  /** Unknown, duplicate and out-of-range inputs are rejected before any upstream I/O. */
  it.each([
    '/search',
    '/search?q=',
    '/search?q=++',
    '/search?q=x&q=y',
    '/search?q=x&songCount=-1',
    '/search?q=x&songCount=501',
    '/search?q=x&songOffset=1.5',
    '/search?q=x&songOffset=9007199254740992',
    '/folders?upstream=https://evil.test',
    '/folders/a?x=y',
    '/random?size=0',
    '/random?size=501',
    '/random?fromYear=2025&toYear=2020',
    '/random?size=1&size=2',
  ])('should reject invalid input %s', async (route) => {
    const ctx = await makeSUT();
    const before = ctx.requests.length;
    expect(
      (await ctx.app.inject({ url: '/api/v1/music' + route, headers: ctx.headers })).statusCode,
    ).toBe(400);
    expect(ctx.requests).toHaveLength(before);
  });
  /** Upstream empty collections remain successful and optional fields stay absent. */
  it.each(routes)('should preserve empty payload semantics for %s', async (route) => {
    const ctx = await makeSUT();
    ctx.state.emptyLibrary = true;
    const result = await ctx.app.inject({ url: '/api/v1/music' + route, headers: ctx.headers });
    expect(result.statusCode).toBe(200);
    const body = result.json();
    const list =
      body.folders ??
      body.indexes?.index ??
      body.directory?.child ??
      body.result?.song ??
      body.artist?.album ??
      body.album?.song ??
      body.songs;
    expect(list).toEqual([]);
    expect(result.body).not.toContain('synthetic-secret');
  });
  /** Standard errors stay distinct from successful empty data and revoke only rejected credentials. */
  it.each([
    [40, 401, 'unauthenticated'],
    [41, 422, 'token_auth_unsupported'],
    [50, 403, 'forbidden'],
    [70, 404, 'not_found'],
    [20, 422, 'upstream_incompatible'],
    [0, 503, 'upstream_unavailable'],
  ])('should map upstream code %s safely', async (code, status, expected) => {
    const ctx = await makeSUT();
    ctx.state.libraryError = Number(code);
    if (code === 0) ctx.state.randomStatus = 503;
    const response = await ctx.app.inject({ url: '/api/v1/music/random', headers: ctx.headers });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({
      schemaVersion: 1,
      error: { code: expected, retryable: status === 503 },
    });
    expect(response.body).not.toContain('synthetic-secret');
    ctx.state.libraryError = 0;
    expect(
      (await ctx.app.inject({ url: '/api/v1/session', headers: ctx.headers })).statusCode,
    ).toBe(status === 401 ? 401 : 200);
  });
  /** Closing a real browser HTTP request aborts the pending gonic read. */
  it('should propagate disconnect cancellation and keep the session valid', async () => {
    const ctx = await makeSUT(5000);
    expect(
      (await ctx.app.inject({ url: '/api/v1/music/search?q=test', headers: ctx.headers }))
        .statusCode,
    ).toBe(200);
    ctx.requests.length = 0;
    const address = await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    ctx.state.libraryStall = true;
    const controller = new AbortController();
    const pending = fetch(address + '/api/v1/music/search?q=test', {
      headers: ctx.headers,
      signal: controller.signal,
    }).catch(() => undefined);
    await expect.poll(() => ctx.requests.some((u) => u.pathname === '/rest/search3')).toBe(true);
    controller.abort();
    await pending;
    await expect.poll(() => ctx.state.closedLibraryRequests).toBe(1);
    ctx.state.libraryStall = false;
    expect(
      (await ctx.app.inject({ url: '/api/v1/session', headers: ctx.headers })).statusCode,
    ).toBe(200);
  });
});
