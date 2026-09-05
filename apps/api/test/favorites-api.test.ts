import { afterEach, describe, expect, it } from 'vitest';
import {
  browserHeaders,
  cookieOf,
  createTestContext,
  password,
} from '../../../tests/support/auth-harness.js';

describe('authenticated song favorites API', () => {
  const contexts: Awaited<ReturnType<typeof createTestContext>>[] = [];

  async function makeSUT(timeoutMs = 300) {
    const ctx = await createTestContext({ timeoutMs });
    contexts.push(ctx);
    const login = await ctx.login();
    const cookie = cookieOf(login);
    return {
      ...ctx,
      readHeaders: { cookie },
      writeHeaders: {
        ...browserHeaders,
        cookie,
        'x-csrf-token': login.json().csrfToken as string,
      },
    };
  }

  afterEach(async () => {
    for (const ctx of contexts.splice(0)) await ctx.cleanup();
  });

  /** GET preserves the current account's upstream order and treats omitted songs as empty success. */
  it('should return ordered current-account songs and preserve empty success', async () => {
    const ctx = await makeSUT();
    ctx.state.favoriteSongIdsByUsername.set(password.username, ['tr-B', 'tr-A']);

    expect((await ctx.app.inject('/api/v1/favorites/songs')).statusCode).toBe(401);
    expect(
      (
        await ctx.app.inject({
          url: '/api/v1/favorites/songs?scope=all',
          headers: ctx.readHeaders,
        })
      ).statusCode,
    ).toBe(400);
    const response = await ctx.app.inject({
      url: '/api/v1/favorites/songs',
      headers: ctx.readHeaders,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().songs.map((song: { id: string }) => song.id)).toEqual(['tr-B', 'tr-A']);

    ctx.state.favoriteSongIdsByUsername.set(password.username, []);
    expect(
      (await ctx.app.inject({ url: '/api/v1/favorites/songs', headers: ctx.readHeaders })).json(),
    ).toEqual({ schemaVersion: 1, songs: [] });
  });

  /** PUT is an idempotent set-state operation reconciled from an authoritative post-write read. */
  it('should reconcile star, repeated star, and unstar without duplicate state', async () => {
    const ctx = await makeSUT();
    const set = (starred: boolean) =>
      ctx.app.inject({
        method: 'PUT',
        url: '/api/v1/favorites/songs/tr-A',
        headers: ctx.writeHeaders,
        payload: { starred },
      });

    const starred = await set(true);
    expect(starred.statusCode).toBe(200);
    expect(starred.json()).toEqual({
      schemaVersion: 1,
      id: 'tr-A',
      starred: true,
      song: expect.objectContaining({ id: 'tr-A', isDir: false }),
    });
    expect((await set(true)).statusCode).toBe(200);
    expect(ctx.state.favoriteSongIdsByUsername.get(password.username)).toEqual(['tr-A']);

    const unstarred = await set(false);
    expect(unstarred.statusCode).toBe(200);
    expect(unstarred.json()).toEqual({ schemaVersion: 1, id: 'tr-A', starred: false });
    expect(ctx.requests.filter((url) => url.pathname === '/rest/star')).toHaveLength(2);
    expect(ctx.requests.filter((url) => url.pathname === '/rest/unstar')).toHaveLength(1);
  });

  /** Cookie writes require JSON and CSRF, while schemas reject unknown query, body and oversized IDs. */
  it('should reject invalid mutation boundaries before any upstream favorite write', async () => {
    const ctx = await makeSUT();
    const cases = [
      ctx.app.inject({
        method: 'PUT',
        url: '/api/v1/favorites/songs/tr-A',
        headers: { ...ctx.readHeaders, 'content-type': 'application/json' },
        payload: { starred: true },
      }),
      ctx.app.inject({
        method: 'PUT',
        url: '/api/v1/favorites/songs/tr-A?extra=true',
        headers: ctx.writeHeaders,
        payload: { starred: true },
      }),
      ctx.app.inject({
        method: 'PUT',
        url: '/api/v1/favorites/songs/tr-A',
        headers: ctx.writeHeaders,
        payload: { starred: 'true' },
      }),
      ctx.app.inject({
        method: 'PUT',
        url: '/api/v1/favorites/songs/tr-A',
        headers: ctx.writeHeaders,
        payload: { starred: true, operationId: 'not-allowed' },
      }),
      ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/favorites/songs/${'x'.repeat(2049)}`,
        headers: ctx.writeHeaders,
        payload: { starred: true },
      }),
    ];
    expect((await Promise.all(cases)).map((response) => response.statusCode)).toEqual([
      403, 400, 400, 400, 414,
    ]);
    expect(ctx.requests.some((url) => ['/rest/star', '/rest/unstar'].includes(url.pathname))).toBe(
      false,
    );
  });

  /** A silent star no-op is not_found, while an unstar that remains present is outcome_unknown. */
  it('should reject post-write presence mismatches instead of reporting optimistic success', async () => {
    const ctx = await makeSUT();
    ctx.state.favoriteSilentNoop = true;
    const set = (starred: boolean) =>
      ctx.app.inject({
        method: 'PUT',
        url: '/api/v1/favorites/songs/tr-A',
        headers: ctx.writeHeaders,
        payload: { starred },
      });

    const missing = await set(true);
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('not_found');

    ctx.state.favoriteSongIdsByUsername.set(password.username, ['tr-A']);
    const uncertain = await set(false);
    expect(uncertain.statusCode).toBe(409);
    expect(uncertain.json()).toEqual({
      schemaVersion: 1,
      error: { code: 'outcome_unknown', retryable: false },
    });
  });

  /** Read, write and post-write failures preserve stable status codes and redact upstream messages. */
  it('should map favorite upstream failures without exposing raw details', async () => {
    const ctx = await makeSUT();
    ctx.state.favoriteWriteError = 50;
    const denied = await ctx.app.inject({
      method: 'PUT',
      url: '/api/v1/favorites/songs/tr-A',
      headers: ctx.writeHeaders,
      payload: { starred: true },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.body).not.toContain('synthetic-secret');

    ctx.state.favoriteWriteError = 0;
    ctx.state.favoritePostwriteError = 0;
    ctx.state.favoriteReadError = 0;
    ctx.state.favoriteSongIdsByUsername.set(password.username, []);
    ctx.state.favoritePostwriteError = 60;
    const failedRead = await ctx.app.inject({
      method: 'PUT',
      url: '/api/v1/favorites/songs/tr-A',
      headers: ctx.writeHeaders,
      payload: { starred: true },
    });
    expect(failedRead.statusCode).toBe(503);
    expect(failedRead.json().error).toEqual({ code: 'upstream_unavailable', retryable: true });
    expect(failedRead.body).not.toContain('synthetic-secret');

    ctx.state.favoritePostwriteError = 0;
    ctx.state.username = 'changed-identity';
    const expired = await ctx.app.inject({
      url: '/api/v1/favorites/songs',
      headers: ctx.readHeaders,
    });
    expect(expired.statusCode).toBe(401);
    expect(expired.json().error.code).toBe('unauthenticated');
  });

  /** Favorite state is keyed by verified account identity and never leaks across sessions. */
  it('should isolate starred songs between two authenticated accounts', async () => {
    const ctx = await makeSUT();
    ctx.state.accountIdentityFromProof = true;
    const otherLogin = await ctx.login(browserHeaders, { ...password, username: 'other-listener' });
    const otherHeaders = { cookie: cookieOf(otherLogin) };

    expect(
      (
        await ctx.app.inject({
          method: 'PUT',
          url: '/api/v1/favorites/songs/tr-A',
          headers: ctx.writeHeaders,
          payload: { starred: true },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await ctx.app.inject({ url: '/api/v1/favorites/songs', headers: otherHeaders })).json()
        .songs,
    ).toEqual([]);
    const otherEntry = await ctx.app.inject({
      url: '/api/v1/music/albums/al-1',
      headers: otherHeaders,
    });
    expect(otherEntry.statusCode).toBe(200);
    expect(otherEntry.json().album.song[0]).not.toHaveProperty('starred');
    expect(ctx.state.favoriteSongIdsByUsername.get('other-listener')).toBeUndefined();
  });

  /** Upstream timeout and client disconnect terminate favorite reads without leaking the session. */
  it('should handle timeout and propagate client disconnect cancellation', async () => {
    const timeout = await makeSUT(20);
    timeout.state.favoriteReadStall = true;
    const unavailable = await timeout.app.inject({
      url: '/api/v1/favorites/songs',
      headers: timeout.readHeaders,
    });
    expect(unavailable.statusCode).toBe(503);

    const disconnected = await makeSUT(5000);
    const address = await disconnected.app.listen({ port: 0, host: '127.0.0.1' });
    disconnected.state.favoriteReadStall = true;
    const controller = new AbortController();
    const pending = fetch(address + '/api/v1/favorites/songs', {
      headers: disconnected.readHeaders,
      signal: controller.signal,
    }).catch(() => undefined);
    await expect
      .poll(() => disconnected.requests.some((url) => url.pathname === '/rest/getStarred2'))
      .toBe(true);
    controller.abort();
    await pending;
    await expect.poll(() => disconnected.state.closedFavoriteRequests).toBe(1);
  });
});
