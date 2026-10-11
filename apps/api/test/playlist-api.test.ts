import { afterEach, describe, expect, it } from 'vitest';
import {
  browserHeaders,
  cookieOf,
  createTestContext,
} from '../../../tests/support/auth-harness.js';

describe('authenticated playlist read API', () => {
  const contexts: Awaited<ReturnType<typeof createTestContext>>[] = [];

  async function makeSUT(timeoutMs = 300) {
    const ctx = await createTestContext({ timeoutMs });
    contexts.push(ctx);
    const login = await ctx.login();
    const headers = { cookie: cookieOf(login) };
    return { ...ctx, headers, csrfToken: login.json().csrfToken as string };
  }

  afterEach(async () => {
    for (const ctx of contexts.splice(0)) await ctx.cleanup();
  });

  /** Artwork finds the first covered playable occurrence without changing the mutation snapshot. */
  it('should discover a later cover and preserve detail revision and occurrence order', async () => {
    const ctx = await makeSUT();
    const read = async () =>
      (await ctx.app.inject({ url: '/api/v1/playlists/pl-1', headers: ctx.headers })).json()
        .playlist;
    const before = await read();
    ctx.state.playlistCoverArt = '';
    ctx.state.playlistEntryCoverArt = { 1: 'cover-B', 2: 'cover-C' };
    const after = await read();
    expect(after.coverArt).toBe('cover-B');
    expect(after.revision).toBe(before.revision);
    expect(after.entries.map((entry: { song: { id: string } }) => entry.song.id)).toEqual([
      'tr-A',
      'tr-B',
      'tr-A',
    ]);
    const count = ctx.requests.length;
    const response = await ctx.app.inject({
      url: '/api/v1/playlists/pl-1/artwork',
      headers: ctx.headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      schemaVersion: 1,
      playlistId: 'pl-1',
      coverState: 'available',
      coverArt: 'cover-B',
    });
    expect(
      ctx.requests
        .slice(count)
        .filter((url) => url.pathname !== '/rest/getUser')
        .map((url) => url.pathname),
    ).toEqual(['/rest/getPlaylist']);
  });

  /** Empty, missing and directory-only covers stay fallback without probing image bytes. */
  it.each(['empty', 'missing', 'directory', 'whitespace'])(
    'should use fallback for %s artwork',
    async (mode) => {
      const ctx = await makeSUT();
      ctx.state.playlistCoverArt =
        mode === 'directory' ? 'folder-cover' : mode === 'whitespace' ? '   ' : '';
      if (mode === 'empty') ctx.state.playlistEntryIds = [];
      if (mode === 'directory') ctx.state.playlistDirectoryPositions = [0];
      const response = await ctx.app.inject({
        url: '/api/v1/playlists/pl-1/artwork',
        headers: ctx.headers,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        schemaVersion: 1,
        playlistId: 'pl-1',
        coverState: 'fallback',
      });
    },
  );

  /** Descriptor reads authenticate, reject query input and fail closed on a mismatched upstream playlist. */
  it('should enforce the exact authenticated artwork binding', async () => {
    const ctx = await makeSUT();
    const url = '/api/v1/playlists/pl-1/artwork';
    expect((await ctx.app.inject(url)).statusCode).toBe(401);
    expect(
      (await ctx.app.inject({ url: url + '?id=other', headers: ctx.headers })).statusCode,
    ).toBe(400);
    ctx.state.playlistId = 'other';
    expect((await ctx.app.inject({ url, headers: ctx.headers })).statusCode).toBe(503);
  });

  /** List reads require a session, reject every query and never fan out to playlist detail. */
  it('should return ordered summaries without detail fan-out', async () => {
    const ctx = await makeSUT();
    expect((await ctx.app.inject('/api/v1/playlists')).statusCode).toBe(401);
    expect(
      (await ctx.app.inject({ url: '/api/v1/playlists?detail=true', headers: ctx.headers }))
        .statusCode,
    ).toBe(400);

    const response = await ctx.app.inject({ url: '/api/v1/playlists', headers: ctx.headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      schemaVersion: 1,
      playlists: [
        expect.objectContaining({
          id: 'pl-1',
          name: 'Synthetic List',
          owner: 'fixture-listener',
          songCount: 3,
          editable: true,
          coverState: 'fallback',
          revision: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        }),
      ],
    });
    expect(ctx.requests.filter((url) => url.pathname === '/rest/getPlaylists')).toHaveLength(1);
    expect(ctx.requests.some((url) => url.pathname === '/rest/getPlaylist')).toBe(false);
  });

  /** Public playlists owned by another account remain readable but never become editable. */
  it('should project resource editability from the current identity and owner', async () => {
    const ctx = await makeSUT();
    ctx.state.playlistOwner = 'other-listener';
    ctx.state.playlistPublic = true;
    const response = await ctx.app.inject({ url: '/api/v1/playlists', headers: ctx.headers });
    expect(response.statusCode).toBe(200);
    expect(response.json().playlists[0]).toMatchObject({
      owner: 'other-listener',
      public: true,
      editable: false,
    });
  });

  /** Detail keeps duplicate song IDs as distinct zero-based occurrences and derives cover from the first entry. */
  it('should return an ordered duplicate-safe detail snapshot', async () => {
    const ctx = await makeSUT();
    const response = await ctx.app.inject({ url: '/api/v1/playlists/pl-1', headers: ctx.headers });
    expect(response.statusCode).toBe(200);
    const playlist = response.json().playlist;
    expect(playlist.coverState).toBe('available');
    expect(playlist.coverArt).toBe('cover-A');
    expect(
      playlist.entries.map((entry: { position: number; song: { id: string } }) => [
        entry.position,
        entry.song.id,
      ]),
    ).toEqual([
      [0, 'tr-A'],
      [1, 'tr-B'],
      [2, 'tr-A'],
    ]);
    expect(playlist.revision).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.body).not.toContain('musiclatte-auth');
  });

  /** Detail revision is stable for one exact snapshot and changes when ordered entry IDs change. */
  it('should sign the exact ordered detail snapshot', async () => {
    const ctx = await makeSUT();
    const read = async () =>
      (await ctx.app.inject({ url: '/api/v1/playlists/pl-1', headers: ctx.headers })).json()
        .playlist.revision as string;
    const first = await read();
    expect(await read()).toBe(first);
    ctx.state.playlistEntryIds = ['tr-A', 'tr-A', 'tr-B'];
    expect(await read()).not.toBe(first);
  });

  /** Empty list and detail are successful snapshots with no invented cover. */
  it('should preserve empty collection semantics', async () => {
    const ctx = await makeSUT();
    ctx.state.emptyCollections = true;
    expect(
      (await ctx.app.inject({ url: '/api/v1/playlists', headers: ctx.headers })).json().playlists,
    ).toEqual([]);
    const detail = await ctx.app.inject({ url: '/api/v1/playlists/pl-1', headers: ctx.headers });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().playlist).toMatchObject({
      songCount: 0,
      duration: 0,
      entries: [],
      coverState: 'fallback',
    });
    expect(detail.json().playlist).not.toHaveProperty('coverArt');
  });

  /** Standard collection failures and malformed success payloads use the shared secret-free error mapping. */
  it.each([
    [40, 401, 'unauthenticated', ''],
    [40, 401, 'unauthenticated', '/artwork'],
    [50, 403, 'forbidden', ''],
    [50, 403, 'forbidden', '/artwork'],
    [70, 404, 'not_found', ''],
    [70, 404, 'not_found', '/artwork'],
    [0, 503, 'upstream_unavailable', ''],
    [0, 503, 'upstream_unavailable', '/artwork'],
  ])('should map collection failure %s safely', async (code, status, expected, suffix) => {
    const ctx = await makeSUT();
    ctx.state.collectionError = Number(code);
    if (code === 0) ctx.state.malformedCollections = true;
    const response = await ctx.app.inject({
      url: '/api/v1/playlists/pl-1' + suffix,
      headers: ctx.headers,
    });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({
      schemaVersion: 1,
      error: { code: expected, retryable: status === 503 },
    });
    expect(response.body).not.toContain('synthetic-secret');
  });

  /** Session revocation during a delayed collection read prevents a late success response. */
  it.each(['', '/artwork'])(
    'should recheck the session after upstream detail returns: %s',
    async (suffix) => {
      const ctx = await makeSUT();
      let releaseCollectionResponse = () => {};
      ctx.state.collectionResponseGate = new Promise<void>((resolve) => {
        releaseCollectionResponse = resolve;
      });
      const pending = ctx.app.inject({
        url: '/api/v1/playlists/pl-1' + suffix,
        headers: ctx.headers,
      });
      await expect
        .poll(() => ctx.requests.some((url) => url.pathname === '/rest/getPlaylist'))
        .toBe(true);
      const logout = await ctx.app.inject({
        method: 'DELETE',
        url: '/api/v1/session',
        headers: {
          ...browserHeaders,
          ...ctx.headers,
          'x-csrf-token': ctx.csrfToken,
        },
        payload: {},
      });
      expect(logout.statusCode).toBe(204);
      releaseCollectionResponse();
      expect((await pending).statusCode).toBe(401);
    },
  );

  /** Closing a real client request aborts the pending playlist read without revoking the session. */
  it.each(['', '/artwork'])(
    'should propagate disconnect cancellation for collection reads: %s',
    async (suffix) => {
      const ctx = await makeSUT(5000);
      const address = await ctx.app.listen({ port: 0, host: '127.0.0.1' });
      ctx.state.collectionStall = true;
      const controller = new AbortController();
      const pending = fetch(address + '/api/v1/playlists/pl-1' + suffix, {
        headers: ctx.headers,
        signal: controller.signal,
      }).catch(() => undefined);
      await expect
        .poll(() => ctx.requests.some((url) => url.pathname === '/rest/getPlaylist'))
        .toBe(true);
      controller.abort();
      await pending;
      await expect.poll(() => ctx.state.closedCollectionRequests).toBe(1);
      ctx.state.collectionStall = false;
      expect(
        (await ctx.app.inject({ url: '/api/v1/session', headers: ctx.headers })).statusCode,
      ).toBe(200);
    },
  );
});
