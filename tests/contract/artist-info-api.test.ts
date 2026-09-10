import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { cookieOf, createTestContext } from '../support/auth-harness.js';
import { artistInfoResponseSchema } from '../../packages/contracts/src/artist-info.js';
import { readArtistInfoEnabled } from '../../apps/api/src/config/runtime.js';

describe('artist information wire contract', () => {
  const contexts: Awaited<ReturnType<typeof createTestContext>>[] = [];
  afterEach(async () => {
    for (const ctx of contexts.splice(0)) await ctx.cleanup();
  });

  it('uses a closed response schema and a strict opt-in flag', async () => {
    expect(readArtistInfoEnabled({})).toBe(false);
    expect(readArtistInfoEnabled({ ARTIST_INFO_ENABLED: 'true' })).toBe(true);
    expect(() => readArtistInfoEnabled({ ARTIST_INFO_ENABLED: '1' })).toThrow();
    const app = Fastify();
    app.get('/info', { schema: { response: { 200: artistInfoResponseSchema } } }, async () => ({
      schemaVersion: 1,
      artistId: 'ar-1',
      state: 'empty',
      similarArtists: [],
      upstreamImageUrl: 'https://example.invalid',
    }));
    const response = await app.inject('/info');
    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty('upstreamImageUrl');
    await app.close();
  });

  it('advertises support only when configured and preserves the basic artist route', async () => {
    const ctx = await createTestContext({ artistInfo: true });
    contexts.push(ctx);
    const headers = { cookie: cookieOf(await ctx.login()) };
    const capability = await ctx.app.inject({ url: '/api/v1/capabilities', headers });
    expect(capability.json().features['music.artistInfo']).toEqual({
      supported: true,
      permission: 'allowed',
      availability: 'available',
    });
    expect(
      (await ctx.app.inject({ url: '/api/v1/music/artists/ar-1', headers })).json().artist.id,
    ).toBe('ar-1');
  });
});
