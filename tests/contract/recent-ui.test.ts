import { describe, expect, it } from 'vitest';
import { recentFixtures } from '../../packages/test-support/src/recent-fixtures.js';
import { createRecentContext } from '../support/recent-harness.js';
import { safeReturnPath } from '../../apps/web/src/auth/guards.js';
import {
  availableEntries,
  clientFeatures,
} from '../../apps/web/src/capabilities/client-features.js';
async function makeSUT() {
  const path = '../../apps/web/src/recent/client.js';
  const module = await import(path).catch(() => null);
  expect(module, 'strict recent decoder exists').not.toBeNull();
  return module!;
}
describe('recent UI producer consumer', () => {
  /** Only query-free canonical paths and available capabilities open the consumer. */
  it('should restore recent deep links and gate the music entry', () => {
    expect(clientFeatures['library.recentDownloads']).toBe(true);
    for (const supported of [true, false])
      for (const permission of ['allowed', 'denied'] as const)
        for (const availability of ['available', 'temporarily_unavailable'] as const) {
          expect(
            availableEntries({
              schemaVersion: 1,
              instanceId: 'test',
              revision: '1',
              features: { 'library.recentDownloads': { supported, permission, availability } },
            }).includes('library.recentDownloads'),
          ).toBe(supported && permission === 'allowed' && availability === 'available');
        }
    expect(safeReturnPath('/music/recent')).toBe('/music/recent');
    expect(safeReturnPath('/app/music/recent', '/app/')).toBe('/app/music/recent');
    for (const suffix of ['?cursor=secret', '?', '#private', '/extra'])
      expect(safeReturnPath('/music/recent' + suffix)).toBe('/music');
  });
  /** Strict decoding rejects unavailable songs, leaked fields and impossible timestamps. */
  it('should decode all public states and reject malformed responses', async () => {
    const { decodeRecent } = await makeSUT();
    for (const fixture of Object.values(recentFixtures))
      expect(decodeRecent(fixture)).toEqual(fixture);
    const ready = recentFixtures.ready;
    for (const bad of [
      { ...ready, privatePath: '/private' },
      { ...ready, asOf: '2026-02-30T12:00:00.000Z' },
      { ...ready, items: [{ ...ready.items[0], state: 'missing' }] },
      { ...ready, items: [{ ...ready.items[0], registeredAt: undefined }] },
      {
        ...ready,
        items: [{ ...ready.items[0], song: { ...ready.items[0]!.song, path: '/private' } }],
      },
      { ...ready, items: [{ ...ready.items[0], song: { ...ready.items[0]!.song, isDir: true } }] },
      { ...ready, filter: { from: ready.filter.to, to: ready.filter.from } },
    ])
      expect(() => decodeRecent(bad)).toThrow();
  });
  /** Ready items retain every optional public song field allowed by the shared contract. */
  it('should accept all optional public metadata for ready songs', async () => {
    const { decodeRecent } = await makeSUT();
    const ready = recentFixtures.ready;
    const response = {
      ...ready,
      items: ready.items.map((entry) => ({
        ...entry,
        song: {
          ...entry.song,
          parent: 'parent',
          albumId: 'album-id',
          artistId: 'artist-id',
          coverArt: 'cover-art',
          album: 'Album',
          artist: 'Artist',
          genre: 'Genre',
          contentType: 'audio/mpeg',
          suffix: 'mp3',
          starred: '2026-09-11T00:00:00.000Z',
          duration: 180,
          bitRate: 320,
          size: 7_200_000,
          track: 1,
          year: 2026,
        },
      })),
    };
    expect(decodeRecent(response)).toEqual(response);
  });
  /** Real authenticated producer serialization, snapshot and no-scan contracts reach the web client. */
  it('should consume real API cursor pages without scanning the library', async () => {
    const { createRecentClient } = await makeSUT();
    const context = await createRecentContext();
    context.seed();
    context.seed({ state: 'registering' });
    const paths: string[] = [];
    try {
      const fetcher: typeof fetch = async (input) => {
        const url = new URL(String(input));
        paths.push(url.pathname);
        const result = await context.app.inject({
          method: 'GET',
          url: url.pathname + url.search,
          headers: context.headers,
        });
        return new Response(result.body, {
          status: result.statusCode,
          headers: { 'Content-Type': 'application/json' },
        });
      };
      const client = createRecentClient({ fetcher, apiOrigin: 'https://api.example.test' });
      const first = await client.list(new AbortController().signal, { limit: '1' });
      context.seed();
      const second = await client.list(new AbortController().signal, { cursor: first.nextCursor });
      expect(second.asOf).toBe(first.asOf);
      expect(
        new Set([...first.items, ...second.items].map((i: { eventId: string }) => i.eventId)).size,
      ).toBe(2);
      expect(paths).toEqual(['/api/v1/recent-downloads', '/api/v1/recent-downloads']);
    } finally {
      await context.cleanup();
    }
  });
});
