import { expect, it } from 'vitest';
import { createCurationQueryContext } from '../../../tests/support/curation-query-harness.js';

it('serves strict scoped policy/list/detail with independent field filters and no file fan-out', async () => {
  const c = await createCurationQueryContext();
  try {
    const headers = await c.token();
    const policy = await c.app.inject({ url: '/api/v1/metadata-policy', headers });
    expect(policy.statusCode).toBe(200);
    expect(policy.json().policy.requiredFields).toEqual(['title', 'artist']);
    const before = c.requests.length;
    const list = await c.app.inject({
      url: '/api/v1/tracks?curationStatus=completed&missingField=lyrics',
      headers,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({
      total: 1,
      tracks: [{ trackId: 'a', curationStatus: 'completed', lyricsState: 'missing' }],
    });
    expect(
      c.requests
        .slice(before)
        .some((url) => /getSong|getIndexes|getMusicDirectory/.test(url.pathname)),
    ).toBe(false);
    const alias = await c.app.inject({
      url: '/api/v1/tracks?curationStatus=completed&field=lyrics&fieldStatus=missing',
      headers,
    });
    expect(alias.json().tracks).toEqual(list.json().tracks);
    for (const query of [
      'field=lyrics',
      'missingField=lyrics&field=lyrics&fieldStatus=missing',
      'unknown=1',
      'limit=0',
      'curationStatus=all',
    ])
      expect((await c.app.inject({ url: '/api/v1/tracks?' + query, headers })).statusCode).toBe(
        400,
      );
    const detail = await c.app.inject({ url: '/api/v1/tracks/a/curation?limit=1', headers });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().history).toHaveLength(1);
    expect(detail.json().nextCursor).toBeTruthy();
    expect(JSON.stringify(detail.json())).not.toMatch(
      /file_identity|encrypted|proof|absolute|audioIdentity|requiredFingerprint/,
    );
    expect(
      (await c.app.inject({ url: '/api/v1/tracks/a/curation', headers: c.headers })).statusCode,
    ).toBe(200);
    expect((await c.app.inject({ url: '/api/v1/tracks' })).statusCode).toBe(401);
  } finally {
    await c.cleanup();
  }
});

it('keeps a frozen count across edits and rejects another credential, filter, expiry or forged cursor', async () => {
  const c = await createCurationQueryContext();
  try {
    const headers = await c.token();
    c.repository.discover({ libraryId: 'unpermitted', trackId: 'private-track', format: 'mp3' });
    expect(
      (await c.app.inject({ url: '/api/v1/tracks/private-track/curation', headers })).statusCode,
    ).toBe(404);
    const first = await c.app.inject({ url: '/api/v1/tracks?limit=1', headers });
    expect(first.statusCode).toBe(200);
    const cursor = first.json().nextCursor as string;
    c.repository.transition(c.ids[0]!, { type: 'reopened' });
    c.repository.discover({ libraryId: 'library-1', trackId: 'c', format: 'mp3' });
    const url = '/api/v1/tracks?limit=1&cursor=' + encodeURIComponent(cursor);
    expect((await c.app.inject({ url, headers })).json()).toMatchObject({
      total: 2,
      tracks: [{ trackId: 'b' }],
    });
    expect((await c.app.inject({ url, headers: await c.token() })).json().error.code).toBe(
      'snapshot_scope_changed',
    );
    expect((await c.app.inject({ url: url + '&format=mp3', headers })).statusCode).toBe(409);
    expect((await c.app.inject({ url: url + 'x', headers })).statusCode).toBe(400);
    c.setNow(1500);
    expect((await c.app.inject({ url, headers })).json().error.code).toBe('snapshot_expired');
  } finally {
    await c.cleanup();
  }
});
