import { afterEach, describe, expect, it } from 'vitest';
import { cookieOf, createTestContext } from '../../../tests/support/auth-harness.js';

describe('artist information API', () => {
  const contexts: Awaited<ReturnType<typeof createTestContext>>[] = [];
  async function makeSUT(timeoutMs = 300) {
    const ctx = await createTestContext({ artistInfo: true, timeoutMs });
    contexts.push(ctx);
    return { ...ctx, headers: { cookie: cookieOf(await ctx.login()) } };
  }
  afterEach(async () => {
    for (const ctx of contexts.splice(0)) await ctx.cleanup();
  });

  it('projects safe local artist information and filters unusable similar artists', async () => {
    const ctx = await makeSUT();
    ctx.state.artistCoverArt = 'cover-ar-1';
    ctx.state.artistInfoBody = {
      biography:
        '<img src="https://listener:secret@example.invalid/a" onerror="steal()">Server <b>bio</b>',
      musicBrainzId: 'mbid-1',
      smallImageUrl: 'https://listener:secret@example.invalid/cover',
      similarArtist: [
        null,
        { id: '', name: 'Invalid' },
        { id: 'ar-1', name: 'Self' },
        { id: 'ar-2', name: 'Related', coverArt: 'discard' },
        { id: 'ar-2', name: 'Duplicate' },
        { id: 'ar-3', name: '' },
      ],
    };
    const response = await ctx.app.inject({
      url: '/api/v1/music/artists/ar-1/info',
      headers: ctx.headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      schemaVersion: 1,
      artistId: 'ar-1',
      state: 'available',
      biography: 'Server bio',
      musicBrainzId: 'mbid-1',
      coverArtId: 'cover-ar-1',
      similarArtists: [{ id: 'ar-2', name: 'Related' }],
    });
    expect(response.body).not.toContain('example.invalid');
    expect(response.body).not.toContain('<b>');
    expect(ctx.requests.filter((url) => url.pathname === '/rest/getArtist')).toHaveLength(1);
    const lookup = ctx.requests.find((url) => url.pathname === '/rest/getArtistInfo2')!;
    expect(Object.fromEntries(lookup.searchParams)).toMatchObject({
      id: 'ar-1',
      count: '20',
      includeNotPresent: 'false',
    });
  });

  it('keeps an empty provider result successful without provider guesses', async () => {
    const ctx = await makeSUT();
    ctx.state.artistInfoBody = { similarArtist: [] };
    const response = await ctx.app.inject({
      url: '/api/v1/music/artists/ar-1/info',
      headers: ctx.headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      schemaVersion: 1,
      artistId: 'ar-1',
      state: 'empty',
      similarArtists: [],
    });
    expect(response.body).not.toContain('provider');
  });

  it('keeps the feature opt-in and maps artist/enrichment failures separately', async () => {
    const off = await createTestContext();
    contexts.push(off);
    const offHeaders = { cookie: cookieOf(await off.login()) };
    expect(
      (await off.app.inject({ url: '/api/v1/music/artists/ar-1/info', headers: offHeaders }))
        .statusCode,
    ).toBe(404);

    const missing = await makeSUT();
    missing.state.libraryError = 70;
    expect(
      (
        await missing.app.inject({
          url: '/api/v1/music/artists/ar-1/info',
          headers: missing.headers,
        })
      ).statusCode,
    ).toBe(404);

    const failed = await makeSUT();
    failed.state.artistInfoError = 0;
    failed.state.artistInfoStall = true;
    const response = await failed.app.inject({
      url: '/api/v1/music/artists/ar-1/info',
      headers: failed.headers,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      schemaVersion: 1,
      error: { code: 'upstream_unavailable', retryable: true },
    });
  });
});
