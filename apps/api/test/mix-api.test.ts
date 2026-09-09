import { browserHeaders, password } from '../../../tests/support/auth-harness.js';
import { afterEach, expect, it } from 'vitest';
import { createMixContext } from '../../../tests/support/mix-harness.js';
const contexts: Awaited<ReturnType<typeof createMixContext>>[] = [];
afterEach(async () => {
  for (const c of contexts.splice(0)) await c.cleanup();
});
async function makeSUT(enabled = true) {
  const c = await createMixContext(enabled);
  contexts.push(c);
  return c;
}
const payload = {
  operationId: 'a'.repeat(22),
  name: 'Mix',
  conditions: { musicFolderId: '0', genre: 'Jazz', size: 3 },
};
/** Save, replay and playback use the durable conditions without refilling random results. */
it('should create replay and execute a saved mix with one random read', async () => {
  const c = await makeSUT();
  const response = await c.app.inject({
    method: 'POST',
    url: '/api/v1/mixes',
    headers: c.headers,
    payload,
  });
  expect(response.statusCode).toBe(201);
  const first = response.json();
  const again = await c.app.inject({
    method: 'POST',
    url: '/api/v1/mixes',
    headers: c.headers,
    payload,
  });
  expect(again.json()).toEqual(first);
  const before = c.requests.filter((url) => url.pathname === '/rest/getRandomSongs').length;
  const songs = await c.app.inject({
    url: `/api/v1/mixes/${first.mix.id}/songs`,
    headers: c.headers,
  });
  expect(songs.statusCode).toBe(200);
  expect(songs.json()).toMatchObject({
    schemaVersion: 1,
    mixId: first.mix.id,
    revision: 1,
    conditions: payload.conditions,
  });
  expect(c.requests.filter((url) => url.pathname === '/rest/getRandomSongs')).toHaveLength(
    before + 1,
  );
  const random = c.requests.findLast((url) => url.pathname === '/rest/getRandomSongs')!;
  expect(Object.fromEntries(random.searchParams)).toMatchObject({
    musicFolderId: '0',
    genre: 'Jazz',
    size: '3',
  });
});
/** Conditions replace fully, revisions conflict, and delete replay survives the tombstone. */
it('should patch delete and replay without resurrecting a mix', async () => {
  const c = await makeSUT();
  const saved = await c.app.inject({
    method: 'POST',
    url: '/api/v1/mixes',
    headers: c.headers,
    payload,
  });
  expect(saved.statusCode).toBe(201);
  const url = `/api/v1/mixes/${saved.json().mix.id}`;
  const update = { operationId: 'b'.repeat(22), expectedRevision: 1, conditions: { size: 5 } };
  const patch = await c.app.inject({ method: 'PATCH', url, headers: c.headers, payload: update });
  expect(patch.statusCode).toBe(200);
  expect(patch.json().mix).toMatchObject({ name: 'Mix', revision: 2, conditions: { size: 5 } });
  expect(
    (
      await c.app.inject({
        method: 'PATCH',
        url,
        headers: c.headers,
        payload: { ...update, operationId: 'c'.repeat(22) },
      })
    ).statusCode,
  ).toBe(409);
  const deletion = {
    method: 'DELETE' as const,
    url,
    headers: c.headers,
    payload: { operationId: 'd'.repeat(22), expectedRevision: 2 },
  };
  const removed = await c.app.inject(deletion);
  expect(removed.statusCode).toBe(200);
  expect((await c.app.inject(deletion)).json()).toEqual(removed.json());
  expect((await c.app.inject({ url, headers: c.headers })).statusCode).toBe(404);
});
/** Removed roots never broaden a saved filter to the entire library. */
it('should refuse unavailable roots and keep feature off by default', async () => {
  const c = await makeSUT();
  const response = await c.app.inject({
    method: 'POST',
    url: '/api/v1/mixes',
    headers: c.headers,
    payload: { ...payload, conditions: { musicFolderId: 'missing' } },
  });
  expect(response.statusCode).toBe(409);
  expect(response.json().error.reason).toBe('mix_scope_unavailable');
  const off = await makeSUT(false);
  expect((await off.app.inject({ url: '/api/v1/mixes', headers: off.headers })).statusCode).toBe(
    404,
  );
});
/** Account and page-size bound cursors cannot be reused across scopes or forged. */
it('should isolate account ownership and signed pagination', async () => {
  const c = await makeSUT();
  for (const operationId of ['a'.repeat(22), 'b'.repeat(22)])
    expect(
      (
        await c.app.inject({
          method: 'POST',
          url: '/api/v1/mixes',
          headers: c.headers,
          payload: { ...payload, operationId },
        })
      ).statusCode,
    ).toBe(201);
  const first = await c.app.inject({ url: '/api/v1/mixes?limit=1', headers: c.headers });
  expect(first.statusCode).toBe(200);
  expect(first.json().mixes).toHaveLength(1);
  const cursor = first.json().nextCursor;
  expect(cursor).toBeTypeOf('string');
  const next = await c.app.inject({
    url: `/api/v1/mixes?limit=1&cursor=${cursor}`,
    headers: c.headers,
  });
  expect(next.json().mixes).toHaveLength(1);
  expect(next.json().mixes[0].id).not.toBe(first.json().mixes[0].id);
  expect(
    (await c.app.inject({ url: `/api/v1/mixes?limit=2&cursor=${cursor}`, headers: c.headers }))
      .statusCode,
  ).toBe(400);
  expect(
    (await c.app.inject({ url: `/api/v1/mixes?limit=1&cursor=${cursor}x`, headers: c.headers }))
      .statusCode,
  ).toBe(400);
  c.state.username = 'different-account';
  const login = await c.login(browserHeaders, { ...password, username: 'different-account' });
  expect(login.statusCode).toBe(201);
  const cookie = String(login.headers['set-cookie']).split(';')[0]!;
  expect(
    (await c.app.inject({ url: `/api/v1/mixes/${first.json().mixes[0].id}`, headers: { cookie } }))
      .statusCode,
  ).toBe(404);
  expect(
    (await c.app.inject({ url: `/api/v1/mixes?limit=1&cursor=${cursor}`, headers: { cookie } }))
      .statusCode,
  ).toBe(400);
});
/** Missing selected roots reject execution while unmatched conditions return an empty success once. */
it('should distinguish removed scope from empty random results', async () => {
  const c = await makeSUT();
  const created = await c.app.inject({
    method: 'POST',
    url: '/api/v1/mixes',
    headers: c.headers,
    payload,
  });
  expect(created.statusCode).toBe(201);
  c.state.emptyLibrary = true;
  expect(
    (
      await c.app.inject({
        url: `/api/v1/mixes/${created.json().mix.id}/songs`,
        headers: c.headers,
      })
    ).statusCode,
  ).toBe(409);
  const unscoped = await c.app.inject({
    method: 'POST',
    url: '/api/v1/mixes',
    headers: c.headers,
    payload: { ...payload, operationId: 'z'.repeat(22), conditions: {} },
  });
  const empty = await c.app.inject({
    url: `/api/v1/mixes/${unscoped.json().mix.id}/songs`,
    headers: c.headers,
  });
  expect(empty.statusCode).toBe(200);
  expect(empty.json().songs).toEqual([]);
  c.state.randomStatus = 503;
  expect(
    (
      await c.app.inject({
        url: `/api/v1/mixes/${unscoped.json().mix.id}/songs`,
        headers: c.headers,
      })
    ).statusCode,
  ).toBe(503);
});
/** Producer support follows actual random observation; it never probes mutation endpoints. */
it('should expose opt-in capability and genre projection', async () => {
  const c = await makeSUT();
  const caps = await c.app.inject({ url: '/api/v1/capabilities', headers: c.headers });
  expect(caps.json().features['mixes.saved']).toEqual({
    supported: true,
    permission: 'allowed',
    availability: 'available',
  });
  const genres = await c.app.inject({ url: '/api/v1/music/genres', headers: c.headers });
  expect(genres.statusCode).toBe(200);
  expect(genres.json().genres).toEqual([{ value: 'Jazz', songCount: 2, albumCount: 1 }]);
  expect(c.requests.map((url) => url.pathname)).not.toContain('/rest/scrobble');
});
