import { afterEach, describe, expect, it } from 'vitest';
import { clientFeatures } from '../../apps/web/src/capabilities/client-features.js';
import { cookieOf, createTestContext, origin } from '../support/auth-harness.js';

describe('favorite web producer-consumer contract', () => {
  const contexts: Awaited<ReturnType<typeof createTestContext>>[] = [];

  afterEach(async () => {
    for (const context of contexts.splice(0)) await context.cleanup();
  });

  /** The enabled web client decodes authoritative order and reconciled set-state responses. */
  it('should consume the strict favorite producer through the typed browser client', async () => {
    expect(clientFeatures['favorites.songs']).toBe(true);
    const modulePath = '../../apps/web/src/favorites/client.js';
    const module = await import(modulePath).catch(() => null);
    expect(module, 'favorite browser client should exist').not.toBeNull();

    const context = await createTestContext();
    contexts.push(context);
    context.state.favoriteSongIdsByUsername.set('fixture-listener', ['tr-B', 'tr-A']);
    const login = await context.login();
    const session = login.json<{ csrfToken: string }>();
    const headers = { cookie: cookieOf(login) };
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const response = await context.app.inject({
        method: (init?.method ?? 'GET') as 'GET' | 'PUT',
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
    const client = module!.createFavoritesClient({
      fetcher,
      apiOrigin: 'https://api.example.test',
    });
    const list = await client.read(new AbortController().signal);
    expect(list.songs.map((song: { id: string }) => song.id)).toEqual(['tr-B', 'tr-A']);
    const unset = await client.set('tr-B', false, {
      csrfToken: session.csrfToken,
      signal: new AbortController().signal,
    });
    expect(unset).toEqual({ schemaVersion: 1, id: 'tr-B', starred: false });
  });
});
