import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, ok, type Scenario } from '../../../tests/support/subsonic-harness.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});
async function makeSUT(scenario: Scenario = {}, timeoutMs = 1000) {
  const ctx = await createTestContext(scenario, { timeoutMs });
  cleanups.push(() => ctx.upstream.close());
  return ctx;
}
describe('listening adapter', () => {
  /** Every wrapper is available before downstream consumers are introduced. */
  it('should expose all five extension operations', async () => {
    const { client } = await makeSUT();
    for (const method of ['genres', 'artistInfo', 'streamMetadata', 'extensions', 'scrobble'])
      expect(Reflect.get(client, method)).toBeTypeOf('function');
  });
  /** Missing and null Go slices mean empty success, while malformed records fail strictly. */
  it.each(
    [undefined, null, [], [{ value: 'Jazz', songCount: 2, albumCount: 1 }]].map((genre) => ({
      genre,
    })),
  )('should decode genre slice $genre', async ({ genre }) => {
    const { client } = await makeSUT({ body: ok({ genres: { genre } }) });
    expect(client.genres).toBeTypeOf('function');
    await expect(client.genres()).resolves.toEqual(genre ?? []);
  });
  /** Wrong field types cannot silently disappear from the condition picker. */
  it.each([
    { value: 2, songCount: 1, albumCount: 1 },
    { value: 'Jazz', songCount: '2', albumCount: 1 },
    { value: 'Jazz', songCount: 1, albumCount: -1 },
  ])('should reject invalid genre %j', async (genre) => {
    const { client } = await makeSUT({ body: ok({ genres: { genre: [genre] } }) });
    expect(client.genres).toBeTypeOf('function');
    await expect(client.genres()).rejects.toMatchObject({ kind: 'invalid_response' });
  });
  /** Artist enrichment projects only safe fields and requests local tag artists. */
  it('should constrain artist lookup and discard upstream image URLs', async () => {
    const { client, upstream } = await makeSUT({
      body: ok({
        artistInfo2: {
          biography: 'Synthetic biography',
          musicBrainzId: 'synthetic-mbid',
          smallImageUrl: 'https://example.invalid/image',
          similarArtist: [{ id: 'ar-2', name: 'Synthetic artist', coverArt: 'discard' }],
        },
      }),
    });
    expect(client.artistInfo).toBeTypeOf('function');
    await expect(client.artistInfo('ar-1')).resolves.toEqual({
      biography: 'Synthetic biography',
      musicBrainzId: 'synthetic-mbid',
      similarArtist: [{ id: 'ar-2', name: 'Synthetic artist' }],
    });
    expect(Object.fromEntries(upstream.requests[0]!.searchParams)).toMatchObject({
      id: 'ar-1',
      count: '20',
      includeNotPresent: 'false',
    });
    expect(upstream.requests[0]!.pathname).toBe('/rest/getArtistInfo2');
  });
  /** Stream metadata remains separate from the existing song DTO. */
  it('should preserve unknown bitrate and duration without inventing values', async () => {
    const { client } = await makeSUT({
      body: ok({ song: { id: 'tr-1', suffix: 'mp3', title: 'Discard' } }),
    });
    expect(client.streamMetadata).toBeTypeOf('function');
    await expect(client.streamMetadata('tr-1')).resolves.toEqual({ id: 'tr-1', suffix: 'mp3' });
  });
  /** Extension observation records versions without inferring unrelated capabilities. */
  it('should decode extension names and versions', async () => {
    const { client } = await makeSUT({
      body: ok({ openSubsonicExtensions: [{ name: 'transcodeOffset', versions: [1] }] }),
    });
    expect(client.extensions).toBeTypeOf('function');
    await expect(client.extensions()).resolves.toEqual([
      { name: 'transcodeOffset', versions: [1] },
    ]);
  });
});

/** A qualified event is submitted once even if the response is lost. */
it.each(['success', 'disconnect', 'headers', 'body'] as const)(
  'should never retry scrobble after %s',
  async (mode) => {
    const scenario: Scenario = {
      listening: true,
      body: ok(),
      ...(mode === 'disconnect'
        ? { disconnect: true }
        : mode === 'headers' || mode === 'body'
          ? { stall: mode }
          : {}),
    };
    const { client, upstream } = await makeSUT(scenario, 80);
    expect(client.scrobble).toBeTypeOf('function');
    const result = client.scrobble('tr-1', 1788888888000);
    if (mode === 'success') await expect(result).resolves.toBeUndefined();
    else
      await expect(result).rejects.toMatchObject({
        kind: mode === 'disconnect' ? 'network' : 'timeout',
      });
    expect(upstream.requests).toHaveLength(1);
    expect(Object.fromEntries(upstream.requests[0]!.searchParams)).toMatchObject({
      id: 'tr-1',
      time: '1788888888000',
      submission: 'true',
    });
    expect(upstream.requests[0]!.searchParams.getAll('id')).toEqual(['tr-1']);
  },
);

/** Present metadata fields are strict even though absent optional fields stay unknown. */
it.each([
  { song: { id: 'tr-1', bitRate: '128' } },
  { song: { id: 'tr-1', duration: -1 } },
  { song: { id: 'tr-1', suffix: null } },
  { song: { id: '' } },
])('should reject malformed stream metadata %j', async (body) => {
  const { client } = await makeSUT({ body: ok(body) });
  await expect(client.streamMetadata('tr-1')).rejects.toMatchObject({ kind: 'invalid_response' });
});
/** Empty artist info is distinct from malformed enrichment and transport failures. */
it('should retain empty artist success and reject wrong field types', async () => {
  const empty = await makeSUT({ body: ok({ artistInfo2: {} }) });
  await expect(empty.client.artistInfo('ar-1')).resolves.toEqual({ similarArtist: [] });
  const invalid = await makeSUT({ body: ok({ artistInfo2: { biography: 4 } }) });
  await expect(invalid.client.artistInfo('ar-1')).rejects.toMatchObject({
    kind: 'invalid_response',
  });
});
/** Invalid scrobble values never contact the server. */
it('should reject invalid event identity and time before dispatch', async () => {
  const { client, upstream } = await makeSUT();
  await expect(client.scrobble('', 1)).rejects.toMatchObject({ kind: 'invalid_request' });
  await expect(client.scrobble('tr-1', -1)).rejects.toMatchObject({ kind: 'invalid_request' });
  await expect(client.scrobble('tr-1', NaN)).rejects.toMatchObject({ kind: 'invalid_request' });
  expect(upstream.requests).toHaveLength(0);
});
