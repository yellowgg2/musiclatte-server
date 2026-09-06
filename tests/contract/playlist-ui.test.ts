import { afterEach, describe, expect, it } from 'vitest';
import { clientFeatures } from '../../apps/web/src/capabilities/client-features.js';
import { createPlaylistClient } from '../../apps/web/src/playlists/client.js';
import { cookieOf, createTestContext, origin } from '../support/auth-harness.js';

describe('playlist web producer-consumer contract', () => {
  const contexts: Awaited<ReturnType<typeof createTestContext>>[] = [];

  afterEach(async () => {
    for (const context of contexts.splice(0)) await context.cleanup();
  });

  /** The web consumer exposes lifecycle writes only with the versioned read and mutation producers. */
  it('should enable the playlist consumer for strict read and write responses', async () => {
    const context = await createTestContext();
    contexts.push(context);
    const login = await context.login();
    const session = login.json<{ csrfToken: string }>();
    const headers = { cookie: cookieOf(login) };
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
    expect(clientFeatures['playlists.write']).toBe(true);

    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const response = await context.app.inject({
        method: (init?.method ?? 'GET') as 'GET' | 'POST' | 'PATCH' | 'DELETE',
        url: url.pathname + url.search,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers).entries()),
          ...headers,
          origin,
        },
        ...(init?.body ? { payload: String(init.body) } : {}),
      });
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

    const created = await client.create('Contract & playlist', {
      csrfToken: session.csrfToken,
      operationId: 'A'.repeat(22),
      signal: new AbortController().signal,
    });
    expect(created).toMatchObject({
      schemaVersion: 1,
      outcome: 'applied',
      playlist: { name: 'Contract & playlist', editable: true },
    });
    const renamed = await client.rename(created.playlist.id, created.playlist.revision, 'Renamed', {
      csrfToken: session.csrfToken,
      operationId: 'B'.repeat(22),
      signal: new AbortController().signal,
    });
    expect(renamed.playlist.name).toBe('Renamed');
    const appended = await client.append(
      renamed.playlist.id,
      renamed.playlist.revision,
      ['tr-A', 'tr-B'],
      {
        csrfToken: session.csrfToken,
        operationId: 'D'.repeat(22),
        signal: new AbortController().signal,
      },
    );
    expect(appended.playlist.entries.map((entry) => entry.song.id)).toEqual(['tr-A', 'tr-B']);
    const deleted = await client.delete(appended.playlist.id, appended.playlist.revision, {
      csrfToken: session.csrfToken,
      operationId: 'C'.repeat(22),
      signal: new AbortController().signal,
    });
    expect(deleted).toMatchObject({ outcome: 'applied', deleted: true });
  });
});
