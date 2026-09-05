import { afterEach, describe, expect, it } from 'vitest';
import { cookieOf, createTestContext } from '../support/auth-harness.js';

describe('playlist read producer contract', () => {
  const contexts: Awaited<ReturnType<typeof createTestContext>>[] = [];

  afterEach(async () => {
    for (const ctx of contexts.splice(0)) await ctx.cleanup();
  });

  /** Summary and detail expose only the strict versioned BFF projection. */
  it('should publish strict summary and occurrence wire shapes', async () => {
    const ctx = await createTestContext();
    contexts.push(ctx);
    const headers = { cookie: cookieOf(await ctx.login()) };
    const list = await ctx.app.inject({ url: '/api/v1/playlists', headers });
    const detail = await ctx.app.inject({ url: '/api/v1/playlists/pl-1', headers });
    expect(list.statusCode).toBe(200);
    expect(Object.keys(list.json().playlists[0]).sort()).toEqual([
      'changed',
      'coverState',
      'created',
      'duration',
      'editable',
      'id',
      'name',
      'owner',
      'public',
      'revision',
      'songCount',
    ]);
    expect(Object.keys(detail.json().playlist).sort()).toEqual([
      'changed',
      'coverArt',
      'coverState',
      'created',
      'duration',
      'editable',
      'entries',
      'id',
      'name',
      'owner',
      'public',
      'revision',
      'songCount',
    ]);
    expect(detail.json().playlist.entries[0]).toEqual({
      position: 0,
      song: expect.objectContaining({ id: 'tr-A', title: 'Synthetic A', isDir: false }),
    });
    expect(list.body + detail.body).not.toContain('subsonic-response');
  });

  /** Opaque IDs are encoded exactly once and unknown query keys never reach gonic. */
  it('should preserve opaque detail IDs and reject query input', async () => {
    const ctx = await createTestContext();
    contexts.push(ctx);
    const headers = { cookie: cookieOf(await ctx.login()) };
    const id = '목록 / + % &?id=other';
    const response = await ctx.app.inject({
      url: '/api/v1/playlists/' + encodeURIComponent(id),
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(ctx.requests.at(-1)?.searchParams.getAll('id')).toEqual([id]);
    const before = ctx.requests.length;
    expect((await ctx.app.inject({ url: '/api/v1/playlists/pl-1?x=y', headers })).statusCode).toBe(
      400,
    );
    expect(ctx.requests).toHaveLength(before);
  });

  /** Mutation producers publish stable applied, replay, conflict, and unknown wire outcomes. */
  it('should publish strict playlist mutation wire shapes', async () => {
    const ctx = await createTestContext();
    contexts.push(ctx);
    const login = await ctx.login();
    const headers = {
      origin: 'https://music.example.test',
      'x-musiclatte-client': 'web',
      'content-type': 'application/json',
      'x-csrf-token': login.json().csrfToken as string,
      cookie: cookieOf(login),
    };
    ctx.state.playlistExists = false;
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/playlists',
      headers,
      payload: { operationId: `${'A'.repeat(21)}p`, name: ' Contract list ' },
    });
    expect(response.statusCode).toBe(201);
    expect(Object.keys(response.json()).sort()).toEqual(['outcome', 'playlist', 'schemaVersion']);
    expect(response.json()).toMatchObject({
      outcome: 'applied',
      playlist: { name: 'Contract list', entries: [] },
    });
  });
});
