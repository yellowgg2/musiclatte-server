import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import {
  browserHeaders,
  cookieOf,
  createTestContext,
  native,
  password,
} from '../../../tests/support/auth-harness.js';

const operationId = (suffix: string) => `${'A'.repeat(21)}${suffix}`;

describe('authenticated playlist mutation API', () => {
  const contexts: Awaited<ReturnType<typeof createTestContext>>[] = [];

  async function makeSUT() {
    const ctx = await createTestContext();
    contexts.push(ctx);
    const login = await ctx.login();
    const cookie = cookieOf(login);
    const headers = {
      ...browserHeaders,
      cookie,
      'x-csrf-token': login.json().csrfToken as string,
    };
    const detail = async () => {
      const response = await ctx.app.inject({
        url: `/api/v1/playlists/${ctx.state.playlistId}`,
        headers,
      });
      expect(response.statusCode).toBe(200);
      return response.json().playlist as {
        id: string;
        name: string;
        revision: string;
        entries: { position: number; song: { id: string } }[];
      };
    };
    return { ...ctx, cookie, headers, detail };
  }

  afterEach(async () => {
    for (const ctx of contexts.splice(0)) await ctx.cleanup();
  });

  /** Mutation routes require strict JSON, browser CSRF proof, no query, and normalized valid names. */
  it('should reject unauthenticated, unsafe, and malformed mutation requests before upstream write', async () => {
    const ctx = await makeSUT();
    const before = ctx.requests.length;
    expect(
      (await ctx.app.inject({ method: 'POST', url: '/api/v1/playlists', payload: {} })).statusCode,
    ).toBe(401);
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/v1/playlists',
          headers: { cookie: ctx.cookie, 'content-type': 'text/plain' },
          payload: JSON.stringify({ operationId: operationId('1'), name: 'List' }),
        })
      ).statusCode,
    ).toBe(415);
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/v1/playlists?retry=true',
          headers: ctx.headers,
          payload: { operationId: operationId('2'), name: 'List' },
        })
      ).statusCode,
    ).toBe(400);
    const invalidPayloads: { payload: object; status: number }[] = [
      { payload: { operationId: operationId('3'), name: '   ' }, status: 422 },
      { payload: { operationId: operationId('4'), name: 'x'.repeat(256) }, status: 422 },
      { payload: { operationId: 'not base64url!', name: 'List' }, status: 400 },
      { payload: { operationId: operationId('5'), name: 'List', unknown: true }, status: 400 },
    ];
    for (const { payload, status } of invalidPayloads) {
      expect(
        (
          await ctx.app.inject({
            method: 'POST',
            url: '/api/v1/playlists',
            headers: ctx.headers,
            payload,
          })
        ).statusCode,
      ).toBe(status);
    }
    const revision = (await ctx.detail()).revision;
    for (const name of ['   ', '한'.repeat(256)]) {
      expect(
        (
          await ctx.app.inject({
            method: 'PATCH',
            url: '/api/v1/playlists/pl-1',
            headers: ctx.headers,
            payload: {
              operationId: operationId('6'),
              expectedRevision: revision,
              action: 'rename',
              name,
            },
          })
        ).statusCode,
      ).toBe(422);
    }
    expect(
      ctx.requests
        .slice(before)
        .filter((url) =>
          ['createPlaylist', 'updatePlaylist', 'deletePlaylist'].some((name) =>
            url.pathname.endsWith(name),
          ),
        ),
    ).toEqual([]);
  });

  /** Native bearer mutations stay separate from browser Origin and CSRF requirements. */
  it('should accept authenticated bearer mutation without browser CSRF headers', async () => {
    const ctx = await makeSUT();
    ctx.state.playlistExists = false;
    const login = await ctx.login(
      { 'content-type': 'application/json', 'x-musiclatte-client': 'native' },
      native,
    );
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/playlists',
      headers: {
        authorization: `Bearer ${login.json().accessToken}`,
        'content-type': 'application/json',
      },
      payload: { operationId: operationId('v'), name: 'Native list' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      outcome: 'applied',
      playlist: { name: 'Native list' },
    });
  });

  /** Golden mutations trim names, preserve duplicate occurrences, replace by order, and reconcile every write. */
  it('should create rename append remove reorder and delete through exact reconciled snapshots', async () => {
    const ctx = await makeSUT();
    ctx.state.playlistExists = false;
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/playlists',
      headers: ctx.headers,
      payload: { operationId: operationId('a'), name: '  오후 & 밤  ' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      schemaVersion: 1,
      outcome: 'applied',
      playlist: { id: 'pl-created', name: '오후 & 밤', entries: [] },
    });
    const createReplay = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/playlists',
      headers: ctx.headers,
      payload: { operationId: operationId('a'), name: '  오후 & 밤  ' },
    });
    expect(createReplay.statusCode).toBe(201);
    expect(createReplay.json().outcome).toBe('already_applied');

    const rename = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/playlists/pl-created',
      headers: ctx.headers,
      payload: {
        operationId: operationId('b'),
        expectedRevision: created.json().playlist.revision,
        action: 'rename',
        name: 'Renamed',
      },
    });
    expect(rename.statusCode).toBe(200);
    expect(rename.json().playlist.name).toBe('Renamed');

    const appended = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/playlists/pl-created',
      headers: ctx.headers,
      payload: {
        operationId: operationId('c'),
        expectedRevision: rename.json().playlist.revision,
        action: 'append',
        songIds: ['tr-A', 'tr-B', 'tr-A'],
      },
    });
    expect(
      appended.json().playlist.entries.map((entry: { song: { id: string } }) => entry.song.id),
    ).toEqual(['tr-A', 'tr-B', 'tr-A']);

    const removed = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/playlists/pl-created',
      headers: ctx.headers,
      payload: {
        operationId: operationId('d'),
        expectedRevision: appended.json().playlist.revision,
        action: 'remove',
        occurrence: { position: 2, songId: 'tr-A' },
      },
    });
    expect(
      removed.json().playlist.entries.map((entry: { song: { id: string } }) => entry.song.id),
    ).toEqual(['tr-A', 'tr-B']);
    const removeReplay = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/playlists/pl-created',
      headers: ctx.headers,
      payload: {
        operationId: operationId('d'),
        expectedRevision: appended.json().playlist.revision,
        action: 'remove',
        occurrence: { position: 2, songId: 'tr-A' },
      },
    });
    expect(removeReplay.statusCode).toBe(200);
    expect(removeReplay.json().outcome).toBe('already_applied');

    const reordered = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/playlists/pl-created',
      headers: ctx.headers,
      payload: {
        operationId: operationId('e'),
        expectedRevision: removed.json().playlist.revision,
        action: 'reorder',
        order: [1, 0],
      },
    });
    expect(
      reordered.json().playlist.entries.map((entry: { song: { id: string } }) => entry.song.id),
    ).toEqual(['tr-B', 'tr-A']);

    const deleted = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/v1/playlists/pl-created',
      headers: ctx.headers,
      payload: {
        operationId: operationId('f'),
        expectedRevision: reordered.json().playlist.revision,
      },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({
      schemaVersion: 1,
      outcome: 'applied',
      playlistId: 'pl-created',
      deleted: true,
    });
    const deleteReplay = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/v1/playlists/pl-created',
      headers: ctx.headers,
      payload: {
        operationId: operationId('f'),
        expectedRevision: reordered.json().playlist.revision,
      },
    });
    expect(deleteReplay.statusCode).toBe(200);
    expect(deleteReplay.json().outcome).toBe('already_applied');

    const writes = ctx.requests.filter((url) =>
      ['createPlaylist', 'updatePlaylist', 'deletePlaylist'].some((name) =>
        url.pathname.endsWith(name),
      ),
    );
    expect(writes.map((url) => url.pathname)).toEqual([
      '/rest/createPlaylist',
      '/rest/updatePlaylist',
      '/rest/updatePlaylist',
      '/rest/createPlaylist',
      '/rest/createPlaylist',
      '/rest/deletePlaylist',
    ]);
    expect(writes[3]?.searchParams.getAll('songId')).toEqual(['tr-A', 'tr-B']);
    expect(writes[4]?.searchParams.getAll('songId')).toEqual(['tr-B', 'tr-A']);
    expect(writes.some((url) => url.searchParams.has('songIndexToRemove'))).toBe(false);
  });

  /** Stale revisions, wrong duplicate positions, and non-owners return current state without writing. */
  it('should reject stale occurrence and resource authorization conflicts before mutation', async () => {
    const ctx = await makeSUT();
    const snapshot = await ctx.detail();
    ctx.state.playlistChanged = '2026-09-05T02:03:30Z';
    const stale = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/playlists/pl-1',
      headers: ctx.headers,
      payload: {
        operationId: operationId('g'),
        expectedRevision: snapshot.revision,
        action: 'remove',
        occurrence: { position: 2, songId: 'tr-A' },
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: 'conflict' }, current: { id: 'pl-1' } });

    const current = await ctx.detail();
    const wrong = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/playlists/pl-1',
      headers: ctx.headers,
      payload: {
        operationId: operationId('h'),
        expectedRevision: current.revision,
        action: 'remove',
        occurrence: { position: 1, songId: 'tr-A' },
      },
    });
    expect(wrong.statusCode).toBe(409);
    expect(wrong.json().error.code).toBe('conflict');

    ctx.state.playlistOwner = 'other-listener';
    const readOnly = await ctx.detail();
    const forbidden = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/playlists/pl-1',
      headers: ctx.headers,
      payload: {
        operationId: operationId('i'),
        expectedRevision: readOnly.revision,
        action: 'rename',
        name: 'Forbidden',
      },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(
      ctx.requests.filter((url) =>
        ['createPlaylist', 'updatePlaylist', 'deletePlaylist'].some((name) =>
          url.pathname.endsWith(name),
        ),
      ),
    ).toEqual([]);
  });

  /** The account-and-playlist queue lets only one same-revision operation write. */
  it('should serialize simultaneous writes and conflict the stale waiter', async () => {
    const ctx = await makeSUT();
    const revision = (await ctx.detail()).revision;
    ctx.state.mutationDelayMs = 40;
    const request = (suffix: string, name: string) =>
      ctx.app.inject({
        method: 'PATCH',
        url: '/api/v1/playlists/pl-1',
        headers: ctx.headers,
        payload: {
          operationId: operationId(suffix),
          expectedRevision: revision,
          action: 'rename',
          name,
        },
      });
    const responses = await Promise.all([request('j', 'First'), request('k', 'Second')]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect(ctx.requests.filter((url) => url.pathname === '/rest/updatePlaylist')).toHaveLength(1);
  });

  /** A waiter whose session is revoked while queued never reaches playlist preflight or write. */
  it('should recheck the current session after waiting for the mutation lock', async () => {
    const ctx = await makeSUT();
    const revision = (await ctx.detail()).revision;
    ctx.state.mutationDelayMs = 300;
    const request = (suffix: string, name: string) =>
      ctx.app.inject({
        method: 'PATCH',
        url: '/api/v1/playlists/pl-1',
        headers: ctx.headers,
        payload: {
          operationId: operationId(suffix),
          expectedRevision: revision,
          action: 'rename',
          name,
        },
      });
    const first = request('t', 'First queued');
    await expect
      .poll(() => ctx.requests.filter((url) => url.pathname === '/rest/updatePlaylist').length)
      .toBe(1);
    const waiter = request('u', 'Revoked waiter');
    await expect
      .poll(() => ctx.requests.filter((url) => url.pathname === '/rest/getUser').length)
      .toBeGreaterThanOrEqual(4);
    const logout = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/v1/session',
      headers: ctx.headers,
      payload: {},
    });
    expect(logout.statusCode).toBe(204);
    await first;
    expect((await waiter).statusCode).toBe(401);
    expect(ctx.requests.filter((url) => url.pathname === '/rest/updatePlaylist')).toHaveLength(1);
  });

  /** Lost upstream responses reconcile to applied and durable replay never repeats the write. */
  it('should reconcile response loss and preserve no-write replay across a new app instance', async () => {
    const ctx = await makeSUT();
    const revision = (await ctx.detail()).revision;
    ctx.state.mutationResponseLoss = true;
    const payload = {
      operationId: operationId('l'),
      expectedRevision: revision,
      action: 'append',
      songIds: ['tr-A'],
    };
    const first = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/playlists/pl-1',
      headers: ctx.headers,
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().outcome).toBe('applied');

    const restarted = createApp(ctx.options);
    const replay = await restarted.inject({
      method: 'PATCH',
      url: '/api/v1/playlists/pl-1',
      headers: ctx.headers,
      payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().outcome).toBe('already_applied');
    expect(ctx.requests.filter((url) => url.pathname === '/rest/updatePlaylist')).toHaveLength(1);
    await restarted.close();
  });

  /** A persisted pending receipt survives process recreation and blocks an unprovable append replay. */
  it('should never execute a pending operation after process restart', async () => {
    const ctx = await makeSUT();
    const revision = (await ctx.detail()).revision;
    const id = operationId('r');
    const payload = {
      operationId: id,
      expectedRevision: revision,
      action: 'append' as const,
      songIds: ['tr-B'],
    };
    const sign = (purpose: string, value: string) =>
      createHmac('sha256', new Uint8Array(32).fill(7))
        .update(JSON.stringify(['musiclatte-auth', 1, purpose, value]))
        .digest('hex');
    ctx.storage.playlistOperations.claim({
      identityKey: sign(
        'playlist-operation-identity',
        JSON.stringify([ctx.storage.instances.get().id, password.username]),
      ),
      operationIdHash: sign('playlist-operation-id', id),
      requestHash: sign(
        'playlist-operation-request',
        JSON.stringify([
          'append',
          'pl-1',
          { expectedRevision: revision, action: 'append', songIds: ['tr-B'] },
        ]),
      ),
      kind: 'append',
    });
    const restarted = createApp(ctx.options);
    const replay = await restarted.inject({
      method: 'PATCH',
      url: '/api/v1/playlists/pl-1',
      headers: ctx.headers,
      payload,
    });
    expect(replay.statusCode).toBe(409);
    expect(replay.json()).toMatchObject({
      error: { code: 'outcome_unknown', retryable: false },
      current: { id: 'pl-1' },
    });
    expect(ctx.requests.filter((url) => url.pathname === '/rest/updatePlaylist')).toHaveLength(0);
    await restarted.close();
  });

  /** Disconnecting during a write records an uncertain no-retry outcome for the same intent. */
  it('should abort a disconnected write and never automatically replay it', async () => {
    const ctx = await makeSUT();
    const revision = (await ctx.detail()).revision;
    const address = await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    ctx.state.mutationMismatch = true;
    ctx.state.mutationDelayMs = 500;
    const payload = {
      operationId: operationId('s'),
      expectedRevision: revision,
      action: 'rename',
      name: 'Disconnected',
    };
    const controller = new AbortController();
    const pending = fetch(`${address}/api/v1/playlists/pl-1`, {
      method: 'PATCH',
      headers: ctx.headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    }).catch(() => undefined);
    await expect
      .poll(() => ctx.requests.some((url) => url.pathname === '/rest/updatePlaylist'))
      .toBe(true);
    controller.abort();
    await pending;
    ctx.state.mutationDelayMs = 0;
    const replay = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/playlists/pl-1',
      headers: ctx.headers,
      payload,
    });
    expect(replay.statusCode).toBe(409);
    expect(replay.json().error.code).toBe('outcome_unknown');
    expect(ctx.requests.filter((url) => url.pathname === '/rest/updatePlaylist')).toHaveLength(1);
  });

  /** Reused operation IDs and unprovable post-write states stop without automatic mutation retry. */
  it('should return conflict or outcome_unknown for receipt reuse and ambiguous results', async () => {
    const ctx = await makeSUT();
    const revision = (await ctx.detail()).revision;
    const first = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/playlists/pl-1',
      headers: ctx.headers,
      payload: {
        operationId: operationId('m'),
        expectedRevision: revision,
        action: 'rename',
        name: 'Applied name',
      },
    });
    expect(first.statusCode).toBe(200);
    const reuse = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/playlists/pl-1',
      headers: ctx.headers,
      payload: {
        operationId: operationId('m'),
        expectedRevision: first.json().playlist.revision,
        action: 'rename',
        name: 'Different request',
      },
    });
    expect(reuse.statusCode).toBe(409);
    expect(reuse.json().error.code).toBe('conflict');

    ctx.state.mutationMismatch = true;
    const mismatch = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/playlists/pl-1',
      headers: ctx.headers,
      payload: {
        operationId: operationId('n'),
        expectedRevision: first.json().playlist.revision,
        action: 'append',
        songIds: ['tr-B'],
      },
    });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json()).toMatchObject({
      error: { code: 'outcome_unknown', retryable: false },
      current: { id: 'pl-1' },
    });
    const beforeReplay = ctx.requests.filter(
      (url) => url.pathname === '/rest/updatePlaylist',
    ).length;
    const replay = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/playlists/pl-1',
      headers: ctx.headers,
      payload: {
        operationId: operationId('n'),
        expectedRevision: first.json().playlist.revision,
        action: 'append',
        songIds: ['tr-B'],
      },
    });
    expect(replay.statusCode).toBe(409);
    expect(replay.json().error.code).toBe('outcome_unknown');
    expect(ctx.requests.filter((url) => url.pathname === '/rest/updatePlaylist')).toHaveLength(
      beforeReplay,
    );
  });

  /** Deterministic upstream failures remain distinct while timeout ambiguity is reconciled safely. */
  it.each([
    [10, 400, 'invalid_request'],
    [50, 403, 'forbidden'],
    [70, 404, 'not_found'],
  ])(
    'should map mutation error %s without exposing the upstream message',
    async (code, status, errorCode) => {
      const ctx = await makeSUT();
      const revision = (await ctx.detail()).revision;
      ctx.state.mutationError = Number(code);
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: '/api/v1/playlists/pl-1',
        headers: ctx.headers,
        payload: {
          operationId: operationId(String(code).slice(-1)),
          expectedRevision: revision,
          action: 'rename',
          name: 'Rejected',
        },
      });
      expect(response.statusCode).toBe(status);
      expect(response.json().error.code).toBe(errorCode);
      expect(response.body).not.toContain('synthetic-secret');
      expect(ctx.requests.filter((url) => url.pathname === '/rest/updatePlaylist')).toHaveLength(1);
    },
  );

  /** A failed delete receipt never becomes applied merely because the target later disappears. */
  it('should keep failed delete replay terminal and never issue a second delete', async () => {
    const ctx = await makeSUT();
    const revision = (await ctx.detail()).revision;
    const payload = {
      operationId: operationId('q'),
      expectedRevision: revision,
    };
    ctx.state.mutationError = 70;
    expect(
      (
        await ctx.app.inject({
          method: 'DELETE',
          url: '/api/v1/playlists/pl-1',
          headers: ctx.headers,
          payload,
        })
      ).statusCode,
    ).toBe(404);
    ctx.state.mutationError = 0;
    ctx.state.playlistExists = false;
    const replay = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/v1/playlists/pl-1',
      headers: ctx.headers,
      payload,
    });
    expect(replay.statusCode).toBe(409);
    expect(replay.json().error.code).toBe('outcome_unknown');
    expect(ctx.requests.filter((url) => url.pathname === '/rest/deletePlaylist')).toHaveLength(1);
  });

  /** A timed-out write that cannot be proven applied becomes a terminal unknown outcome. */
  it('should return outcome_unknown after an unprovable write timeout', async () => {
    const ctx = await makeSUT();
    const revision = (await ctx.detail()).revision;
    ctx.state.mutationMismatch = true;
    ctx.state.mutationDelayMs = 500;
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/playlists/pl-1',
      headers: ctx.headers,
      payload: {
        operationId: operationId('o'),
        expectedRevision: revision,
        action: 'rename',
        name: 'Timed out',
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('outcome_unknown');
  });
});
