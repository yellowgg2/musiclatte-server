import { afterEach, describe, expect, it } from 'vitest';
import { clientFeatures } from '../../apps/web/src/capabilities/client-features.js';
import { createPlaylistClient } from '../../apps/web/src/playlists/client.js';
import { cookieOf, createTestContext } from '../support/auth-harness.js';

describe('playlist web producer-consumer contract', () => {
  const contexts: Awaited<ReturnType<typeof createTestContext>>[] = [];

  afterEach(async () => {
    for (const context of contexts.splice(0)) await context.cleanup();
  });

  /** The web consumer opens only after the versioned list and ordered detail producers are available. */
  it('should enable the playlist consumer for strict list and detail responses', async () => {
    const context = await createTestContext();
    contexts.push(context);
    const headers = { cookie: cookieOf(await context.login()) };
    const list = await context.app.inject({ url: '/api/v1/playlists', headers });
    const detail = await context.app.inject({ url: '/api/v1/playlists/pl-1', headers });

    expect(list.statusCode).toBe(200);
    expect(detail.statusCode).toBe(200);
    expect(list.json()).toMatchObject({ schemaVersion: 1, playlists: expect.any(Array) });
    expect(detail.json().schemaVersion).toBe(1);
    expect(detail.json().playlist.entries[0]).toMatchObject({
      position: 0,
      song: { id: 'tr-A' },
    });
    expect(clientFeatures['playlists.read']).toBe(true);

    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const response = await context.app.inject({ url: url.pathname + url.search, headers });
      return new Response(response.body, {
        status: response.statusCode,
        headers: { 'content-type': 'application/json' },
      });
    };
    const client = createPlaylistClient({ fetcher, apiOrigin: 'https://api.example.test' });
    const listData = await client.read({ kind: 'list' }, new AbortController().signal);
    const detailData = await client.read(
      { kind: 'detail', id: 'pl-1' },
      new AbortController().signal,
    );
    expect(listData.kind === 'list' && listData.playlists[0]?.id).toBe('pl-1');
    expect(
      detailData.kind === 'detail' &&
        detailData.playlist.entries.map((entry) => [entry.position, entry.song.id]),
    ).toEqual([
      [0, 'tr-A'],
      [1, 'tr-B'],
      [2, 'tr-A'],
    ]);
  });
});
