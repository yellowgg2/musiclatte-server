import { afterEach, describe, expect, it } from 'vitest';
import {
  createTestContext,
  failed,
  loadProtocol,
  ok,
  type Scenario,
} from '../support/subsonic-harness.js';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});
async function makeSUT(scenario: Scenario = {}) {
  const ctx = await createTestContext(scenario);
  cleanups.push(() => ctx.upstream.close());
  return ctx;
}

async function makeCollectionSUT(scenario: Scenario = {}) {
  return makeSUT({ ...scenario, collections: true });
}
describe('gonic v0.22.0 source-derived parity (synthetic, not live)', () => {
  /** The adapter understands each S01 consumer payload independently of routes and players. */
  it('should decode folders indexes directory search artist album and random payloads', async () => {
    const { client, upstream } = await makeSUT();
    await expect(client.folders()).resolves.toEqual([{ id: '0', name: 'Synthetic Music' }]);
    await expect(client.indexes('0')).resolves.toMatchObject({
      index: [{ name: 'S', artist: [{ id: 'ar-1', name: 'Synthetic Artist' }] }],
    });
    await expect(client.directory('al-1')).resolves.toMatchObject({
      id: 'al-1',
      child: [
        { id: 'al-2', isDir: true },
        { id: 'tr-1', isDir: false, title: '가을 & Café + 100%' },
      ],
    });
    await expect(client.search('Café')).resolves.toMatchObject({
      artist: [{ id: 'ar-1' }],
      album: [{ id: 'al-1' }],
      song: [{ id: 'tr-1' }],
    });
    await expect(client.artist('ar-1')).resolves.toMatchObject({
      id: 'ar-1',
      album: [{ id: 'al-1' }],
    });
    await expect(client.album('al-1')).resolves.toMatchObject({
      id: 'al-1',
      song: [{ id: 'tr-1' }],
    });
    await expect(client.random({ size: 1, musicFolderId: '0' })).resolves.toMatchObject([
      { id: 'tr-1' },
    ]);
    expect(upstream.requests.map((url) => url.pathname)).toEqual([
      '/rest/getMusicFolders',
      '/rest/getIndexes',
      '/rest/getMusicDirectory',
      '/rest/search3',
      '/rest/getArtist',
      '/rest/getAlbum',
      '/rest/getRandomSongs',
    ]);
    expect(upstream.requests[1]!.searchParams.get('musicFolderId')).toBe('0');
    expect(upstream.requests[6]!.searchParams.get('size')).toBe('1');
    expect(upstream.requests[6]!.searchParams.get('musicFolderId')).toBe('0');
  });
  /** Omitted and nil Go slices are empty collections, but their enclosing payload is required. */
  it('should normalize source-shaped empty collections', async () => {
    const { client } = await makeSUT({ empty: true });
    await expect(client.folders()).resolves.toEqual([]);
    await expect(client.indexes()).resolves.toMatchObject({ index: [] });
    await expect(client.directory('al-1')).resolves.toMatchObject({ child: [] });
    await expect(client.search('none')).resolves.toEqual({ artist: [], album: [], song: [] });
    await expect(client.artist('ar-1')).resolves.toMatchObject({ album: [] });
    await expect(client.album('al-1')).resolves.toMatchObject({ song: [] });
    await expect(client.random()).resolves.toEqual([]);
  });
  /** Standard errors remain distinct and error 41 never triggers BFF password fallback. */
  it.each([
    [0, 'upstream_error'],
    [10, 'invalid_request'],
    [20, 'protocol_incompatible'],
    [30, 'protocol_incompatible'],
    [40, 'authentication'],
    [41, 'token_auth_unsupported'],
    [50, 'forbidden'],
    [70, 'not_found'],
    [999, 'upstream_error'],
  ] as const)('should preserve standard code %i as %s', async (code, kind) => {
    const { client, upstream } = await makeSUT({ body: failed(code) });
    await expect(client.ping()).rejects.toMatchObject({ kind, code });
    expect(upstream.requests).toHaveLength(1);
    expect(upstream.requests[0]!.searchParams.has('p')).toBe(false);
  });
  /** Endpoint absence and resource absence share code 70 in stock gonic, so capability stays unknown. */
  it.each(['view not found', "couldn't find a track with that id"])(
    'should not infer unsupported capability from %s',
    async (message) => {
      const { client } = await makeSUT({ body: failed(70, message) });
      await expect(client.random()).rejects.toMatchObject({
        kind: 'not_found',
        code: 70,
        capability: 'unknown',
      });
    },
  );
  /** Transport status takes precedence and is not confused with an authenticated standard error. */
  it.each([401, 403, 404, 500, 503])(
    'should retain HTTP %i without inventing a standard error',
    async (status) => {
      const { client } = await makeSUT({ status, body: failed(70) });
      await expect(client.ping()).rejects.toMatchObject({
        kind: 'http_error',
        httpStatus: status,
        capability: 'unknown',
      });
    },
  );
  /** Invalid wrappers, versions, JSON and payload shapes never become empty success. */
  it.each([
    {},
    [],
    { 'subsonic-response': { status: 'ok' } },
    { 'subsonic-response': { status: 'unknown', version: '1.15.0' } },
    { 'subsonic-response': { status: 'failed', version: '1.15.0' } },
    ok({ error: { code: 40 } }),
    ok(),
    ok({ searchResult3: { song: {} } }),
    ok({ searchResult3: { song: [{ id: 12, title: 'x', isDir: false }] } }),
    '<html>login</html>',
  ])('should reject malformed search response %#', async (body) => {
    const { client } = await makeSUT({ body });
    await expect(client.search('q')).rejects.toMatchObject({ kind: 'invalid_response' });
  });
  /** Opaque entity IDs are preserved exactly while numeric music-folder IDs become strings. */
  it('should preserve string IDs without decoding or integer coercion', async () => {
    const id = '001/한글+%2F?x=1';
    const { client } = await makeSUT({
      body: ok({
        directory: { id, name: 'Fixture', child: [{ id, title: 'Mixed tag', isDir: false }] },
      }),
    });
    await expect(client.directory(id)).resolves.toMatchObject({ id, child: [{ id }] });
  });
  /** Repeated native playlist parameters retain both ordering and duplicates at the encoding boundary. */
  it('should encode repeated parameters and special characters losslessly', async () => {
    const { encodeParameters } = await loadProtocol();
    const pairs: Array<[string, string]> = [
      ['songId', 'tr-1'],
      ['songId', 'tr-1'],
      ['songId', '한글+&%?'],
      ['songIdToAdd', 'tr-2'],
      ['songIndexToRemove', '0'],
      ['songIndexToRemove', '2'],
    ];
    const encoded = encodeParameters(pairs);
    expect(Array.from(new URLSearchParams(encoded.toString()))).toEqual(pairs);
  });
  /** The fake rejects mutation endpoints even when callers bypass the typed adapter. */
  it('should keep the fixture server read-only', async () => {
    const { upstream } = await makeSUT();
    const response = await fetch(`${upstream.url}/rest/startScan`);
    expect(response.status).toBe(405);
    const playlistWrite = await fetch(`${upstream.url}/rest/createPlaylist?name=blocked`);
    expect(playlistWrite.status).toBe(405);
    const starWrite = await fetch(`${upstream.url}/rest/star?id=blocked`);
    expect(starWrite.status).toBe(405);
    const post = await fetch(`${upstream.url}/rest/ping`, { method: 'POST' });
    expect(post.status).toBe(405);
  });

  /** Playlist summaries and details preserve source order and discard unknown extension fields. */
  it('should decode strict playlist summaries and duplicate ordered entries', async () => {
    const summary = {
      id: 'pl-1',
      name: 'Synthetic List',
      owner: 'fixture-listener',
      songCount: 3,
      created: '2026-09-05T01:02:03.123456789Z',
      changed: '2026-09-05T02:03:04Z',
      duration: 360,
      extension: 'discard me',
    };
    const songA = { id: 'tr-A', title: 'A', isDir: false, privatePath: '/not/projected' };
    const songB = { id: 'tr-B', title: 'B', isDir: false };
    const listContext = await makeCollectionSUT({
      body: ok({ playlists: { playlist: [summary] } }),
    });
    const detailContext = await makeCollectionSUT({
      body: ok({ playlist: { ...summary, public: true, entry: [songA, songB, songA] } }),
    });

    await expect(listContext.client.getPlaylists()).resolves.toEqual([
      {
        id: 'pl-1',
        name: 'Synthetic List',
        owner: 'fixture-listener',
        songCount: 3,
        created: '2026-09-05T01:02:03.123456789Z',
        changed: '2026-09-05T02:03:04Z',
        duration: 360,
        public: false,
      },
    ]);
    await expect(detailContext.client.getPlaylist('pl-1')).resolves.toEqual({
      id: 'pl-1',
      name: 'Synthetic List',
      owner: 'fixture-listener',
      songCount: 3,
      created: '2026-09-05T01:02:03.123456789Z',
      changed: '2026-09-05T02:03:04Z',
      duration: 360,
      public: true,
      entry: [
        { id: 'tr-A', title: 'A', isDir: false },
        { id: 'tr-B', title: 'B', isDir: false },
        { id: 'tr-A', title: 'A', isDir: false },
      ],
    });
    expect(listContext.upstream.requests[0]!.pathname).toBe('/rest/getPlaylists');
    expect(listContext.upstream.requests[0]!.searchParams.has('id')).toBe(false);
    expect(detailContext.upstream.requests[0]!.pathname).toBe('/rest/getPlaylist');
    expect(detailContext.upstream.requests[0]!.searchParams.getAll('id')).toEqual(['pl-1']);
  });

  /** Omitted and null collection slices remain successful empty domain collections. */
  it('should normalize empty playlist entry and starred song slices', async () => {
    const base = {
      id: 'pl-empty',
      name: 'Empty',
      owner: 'fixture-listener',
      songCount: 0,
      created: '2026-09-05T01:02:03Z',
      changed: '2026-09-05T01:02:03Z',
      duration: 0,
    };
    const omittedLists = await makeCollectionSUT({ body: ok({ playlists: {} }) });
    const nullEntries = await makeCollectionSUT({
      body: ok({ playlist: { ...base, entry: null } }),
    });
    const nullStars = await makeCollectionSUT({ body: ok({ starred2: { song: null } }) });

    await expect(omittedLists.client.getPlaylists()).resolves.toEqual([]);
    await expect(nullEntries.client.getPlaylist('pl-empty')).resolves.toMatchObject({
      entry: [],
      public: false,
    });
    await expect(nullStars.client.getStarred2()).resolves.toEqual([]);
  });

  /** Required playlist identity metadata and entry shapes never degrade into partial success. */
  it.each([
    {
      playlist: {
        id: 'pl',
        name: 'x',
        songCount: 0,
        created: '2026-09-05T00:00:00Z',
        changed: '2026-09-05T00:00:00Z',
        duration: 0,
      },
    },
    {
      playlist: {
        id: 'pl',
        name: 'x',
        owner: '',
        songCount: 0,
        created: '2026-09-05T00:00:00Z',
        changed: '2026-09-05T00:00:00Z',
        duration: 0,
      },
    },
    {
      playlist: {
        id: 'pl',
        name: 'x',
        owner: 'owner',
        songCount: -1,
        created: '2026-09-05T00:00:00Z',
        changed: '2026-09-05T00:00:00Z',
        duration: 0,
      },
    },
    {
      playlist: {
        id: 'pl',
        name: 'x',
        owner: 'owner',
        songCount: 0,
        created: 'not-a-date',
        changed: '2026-09-05T00:00:00Z',
        duration: 0,
      },
    },
    {
      playlist: {
        id: 'pl',
        name: 'x',
        owner: 'owner',
        songCount: 1,
        created: '2026-09-05T00:00:00Z',
        changed: '2026-09-05T00:00:00Z',
        duration: 1,
        entry: [{ id: 'tr', title: 'x' }],
      },
    },
  ])('should reject malformed collection payload %#', async (payload) => {
    const { client } = await makeCollectionSUT({ body: ok(payload) });
    await expect(client.getPlaylist('pl')).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  /** Collection methods retain the established standard error taxonomy without raw messages. */
  it.each([
    [10, 'invalid_request'],
    [40, 'authentication'],
    [41, 'token_auth_unsupported'],
    [50, 'forbidden'],
    [70, 'not_found'],
  ] as const)('should map collection error %i to %s', async (code, kind) => {
    const { client } = await makeCollectionSUT({
      body: failed(code, 'private collection message'),
    });
    await expect(client.getPlaylist('pl')).rejects.toMatchObject({
      kind,
      code,
      capability: 'unknown',
    });
  });
});
