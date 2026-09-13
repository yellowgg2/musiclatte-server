import { afterEach, describe, expect, it } from 'vitest';
import {
  browserHeaders,
  cookieOf,
  createTestContext,
  password,
} from '../../../tests/support/auth-harness.js';

describe('current-account summary API', () => {
  const contexts: Awaited<ReturnType<typeof createTestContext>>[] = [];

  async function makeSUT(timeoutMs = 300) {
    const ctx = await createTestContext({ timeoutMs });
    contexts.push(ctx);
    const login = await ctx.login();
    return { ...ctx, headers: { cookie: cookieOf(login) } };
  }

  afterEach(async () => {
    for (const ctx of contexts.splice(0)) await ctx.cleanup();
  });

  /** The summary exposes exact current-account collection counts without identity details. */
  it('should return exact favorite and playlist counts for the authenticated account', async () => {
    const ctx = await makeSUT();
    ctx.state.favoriteSongIdsByUsername.set(password.username, ['tr-A', 'tr-B']);
    ctx.state.playlistIds = ['pl-1', 'pl-2', 'pl-3'];

    const response = await ctx.app.inject({
      url: '/api/v1/account/summary',
      headers: ctx.headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      schemaVersion: 1,
      favoriteSongCount: 2,
      playlistCount: 3,
    });
    expect(ctx.requests.filter(({ pathname }) => pathname === '/rest/getStarred2')).toHaveLength(1);
    expect(ctx.requests.filter(({ pathname }) => pathname === '/rest/getPlaylists')).toHaveLength(
      1,
    );
    expect(response.body).not.toContain(password.username);
  });

  /** Missing collections remain a successful zero-count snapshot. */
  it('should preserve zero-count collection semantics', async () => {
    const ctx = await makeSUT();
    ctx.state.emptyCollections = true;

    expect(
      (await ctx.app.inject({ url: '/api/v1/account/summary', headers: ctx.headers })).json(),
    ).toEqual({ schemaVersion: 1, favoriteSongCount: 0, playlistCount: 0 });
  });

  /** The route requires a live session and rejects target-account query input before upstream work. */
  it('should reject unauthenticated, expired, and target-account requests', async () => {
    const ctx = await makeSUT();
    expect((await ctx.app.inject('/api/v1/account/summary')).statusCode).toBe(401);

    const beforeQuery = ctx.requests.length;
    expect(
      (
        await ctx.app.inject({
          url: '/api/v1/account/summary?username=other-listener',
          headers: ctx.headers,
        })
      ).statusCode,
    ).toBe(400);
    expect(ctx.requests).toHaveLength(beforeQuery);

    ctx.state.username = 'changed-identity';
    expect(
      (await ctx.app.inject({ url: '/api/v1/account/summary', headers: ctx.headers })).statusCode,
    ).toBe(401);
  });

  /** Verified proof identity selects favorites even when another account has more entries. */
  it('should never select another account through an authenticated request', async () => {
    const ctx = await makeSUT();
    ctx.state.accountIdentityFromProof = true;
    ctx.state.favoriteSongIdsByUsername.set(password.username, ['tr-A', 'tr-B']);
    ctx.state.favoriteSongIdsByUsername.set('other-listener', ['tr-A']);
    const otherLogin = await ctx.login(browserHeaders, { ...password, username: 'other-listener' });

    const response = await ctx.app.inject({
      url: '/api/v1/account/summary',
      headers: { cookie: cookieOf(otherLogin) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().favoriteSongCount).toBe(1);
    expect(response.body).not.toContain(password.username);
  });

  /** Upstream authorization and malformed payload failures keep shared sanitized API semantics. */
  it.each([
    ['favorite unauthorized', { favoriteReadError: 40 }, 401, 'unauthenticated'],
    ['playlist forbidden', { collectionError: 50 }, 403, 'forbidden'],
    ['malformed collections', { malformedCollections: true }, 503, 'upstream_unavailable'],
  ])('should map %s safely', async (_name, state, status, code) => {
    const ctx = await makeSUT();
    Object.assign(ctx.state, state);

    const response = await ctx.app.inject({
      url: '/api/v1/account/summary',
      headers: ctx.headers,
    });

    expect(response.statusCode).toBe(status);
    expect(response.json().error).toEqual({ code, retryable: status >= 500 });
    expect(response.body).not.toContain('synthetic-secret');
  });

  /** A terminal failure cancels the still-pending sibling read instead of leaving background work. */
  it('should abort the sibling collection read after one upstream failure', async () => {
    const ctx = await makeSUT(5000);
    ctx.state.favoriteReadError = 50;
    ctx.state.collectionStall = true;

    const response = await ctx.app.inject({
      url: '/api/v1/account/summary',
      headers: ctx.headers,
    });

    expect(response.statusCode).toBe(403);
    await expect.poll(() => ctx.state.closedCollectionRequests).toBe(1);
  });

  /** Timeout and client disconnect abort both concurrent upstream collection reads. */
  it('should time out safely and abort both reads after client disconnect', async () => {
    const timeout = await makeSUT(20);
    timeout.state.favoriteReadStall = true;
    expect(
      (
        await timeout.app.inject({
          url: '/api/v1/account/summary',
          headers: timeout.headers,
        })
      ).statusCode,
    ).toBe(503);

    const disconnected = await makeSUT(5000);
    const address = await disconnected.app.listen({ port: 0, host: '127.0.0.1' });
    disconnected.state.collectionStall = true;
    disconnected.state.favoriteReadStall = true;
    const controller = new AbortController();
    const pending = fetch(address + '/api/v1/account/summary', {
      headers: disconnected.headers,
      signal: controller.signal,
    }).catch(() => undefined);
    await expect
      .poll(
        () =>
          disconnected.requests.some(({ pathname }) => pathname === '/rest/getStarred2') &&
          disconnected.requests.some(({ pathname }) => pathname === '/rest/getPlaylists'),
      )
      .toBe(true);
    controller.abort();
    await pending;
    await expect.poll(() => disconnected.state.closedFavoriteRequests).toBe(1);
    await expect.poll(() => disconnected.state.closedCollectionRequests).toBe(1);
  });
});
