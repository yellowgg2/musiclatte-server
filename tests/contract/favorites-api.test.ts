import { afterEach, describe, expect, it } from 'vitest';
import { browserHeaders, cookieOf, createTestContext, password } from '../support/auth-harness.js';

describe('song favorites producer contract', () => {
  const contexts: Awaited<ReturnType<typeof createTestContext>>[] = [];

  afterEach(async () => {
    for (const ctx of contexts.splice(0)) await ctx.cleanup();
  });

  /** GET and PUT expose only strict schema-versioned song favorite wire shapes. */
  it('should publish strict list and reconciled set-state responses', async () => {
    const ctx = await createTestContext();
    contexts.push(ctx);
    const login = await ctx.login();
    const cookie = cookieOf(login);
    const writeHeaders = {
      ...browserHeaders,
      cookie,
      'x-csrf-token': login.json().csrfToken as string,
    };
    ctx.state.favoriteSongIdsByUsername.set(password.username, ['tr-B', 'tr-A']);
    const list = await ctx.app.inject({ url: '/api/v1/favorites/songs', headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(Object.keys(list.json()).sort()).toEqual(['schemaVersion', 'songs']);
    expect(list.json().songs.map((song: { id: string }) => song.id)).toEqual(['tr-B', 'tr-A']);

    const id = '곡 / + % &?id=other';
    const set = await ctx.app.inject({
      method: 'PUT',
      url: '/api/v1/favorites/songs/' + encodeURIComponent(id),
      headers: writeHeaders,
      payload: { starred: true },
    });
    expect(set.statusCode).toBe(200);
    expect(Object.keys(set.json()).sort()).toEqual(['id', 'schemaVersion', 'song', 'starred']);
    expect(set.json()).toMatchObject({ id, starred: true, song: { id } });
    expect(ctx.requests.at(-2)?.pathname).toBe('/rest/star');
    expect(ctx.requests.at(-2)?.searchParams.getAll('id')).toEqual([id]);
    expect(ctx.requests.at(-1)?.pathname).toBe('/rest/getStarred2');
  });
});
