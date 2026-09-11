import { expect, it } from 'vitest';
import { createAccessTokenTestContext } from '../support/access-token-harness.js';
import { createAccessTokenClient } from '../../apps/web/src/automation/client.js';
import { decodeAccessTokenOptions } from '@musiclatte/contracts';
it('roundtrips the settings client through session-authenticated token options, create, list and revoke', async () => {
  const c = await createAccessTokenTestContext();
  const base = await c.app.listen({ host: '127.0.0.1', port: 0 });
  const fetcher: typeof fetch = (input, init) =>
    fetch(input, {
      ...init,
      headers: { ...c.headers, ...Object.fromEntries(new Headers(init?.headers)) },
    });
  const client = createAccessTokenClient({ apiOrigin: base, fetcher });
  const signal = new AbortController().signal;
  try {
    const options = await client.options(signal);
    expect(options.libraryIds).toEqual(['library-1']);
    expect(options.scopes).toContain('media:organize');
    expect(options.scopes).toContain('collections:read');
    const issued = await client.create(
      {
        ...c.payload,
        scopes: ['metadata:read'],
        expiresAt: options.now + Math.min(60000, options.maxTokenAgeMs),
      },
      c.headers['x-csrf-token']!,
      signal,
    );
    expect((await client.list(signal)).accessTokens[0]?.id).toBe(issued.accessToken.id);
    await client.revoke(issued.accessToken.id, c.headers['x-csrf-token']!, signal);
    expect(
      (
        await c.app.inject({
          url: '/api/v1/metadata-policy',
          headers: { authorization: 'Bearer ' + issued.token },
        })
      ).statusCode,
    ).toBe(401);
    expect(JSON.stringify(await client.list(signal))).not.toContain(issued.token);
    expect(() => decodeAccessTokenOptions({ ...options, path: '/private' })).toThrow();
  } finally {
    await c.cleanup();
  }
});
it('treats malformed or lost creation responses as uncertain and keeps API origin separate', async () => {
  let path = '';
  let attempts = 0;
  const client = createAccessTokenClient({
    apiOrigin: 'https://api.example.test',
    fetcher: async (input) => {
      path = String(input);
      attempts++;
      return Response.json({ schemaVersion: 1 }, { status: 201 });
    },
  });
  await expect(
    client.create(
      {
        name: 'test',
        scopes: ['metadata:read'],
        libraryIds: ['music'],
        expiresAt: Date.now() + 60000,
      },
      'csrf',
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: 'outcome_unknown' });
  expect(path).toBe('https://api.example.test/api/v1/access-tokens');
  expect(attempts).toBe(1);
});
it('uses real session-scoped curation policy/list/detail with frozen pagination and expiry errors', async () => {
  const { createCurationQueryContext } = await import('../support/curation-query-harness.js');
  const { createCurationClient } = await import('../../apps/web/src/curation/client.js');
  const c = await createCurationQueryContext();
  const base = await c.app.listen({ host: '127.0.0.1', port: 0 });
  const client = createCurationClient({
    apiOrigin: base,
    fetcher: (input, init) => fetch(input, { ...init, headers: c.headers }),
  });
  const signal = new AbortController().signal;
  try {
    expect((await client.policy(signal)).requiredFields).toEqual(['title', 'artist']);
    const page = await client.list(
      new URLSearchParams('curationStatus=completed&field=lyrics&fieldStatus=missing&limit=1'),
      signal,
    );
    expect(page.total).toBe(1);
    const detail = await client.detail(page.tracks[0]!.trackId, signal);
    expect(detail.track.curationStatus).toBe('completed');
    expect(detail.track.lyricsState).toBe('missing');
    const first = await client.list(new URLSearchParams('limit=1'), signal);
    c.setNow(1600);
    await expect(
      client.list(new URLSearchParams({ limit: '1', cursor: first.nextCursor! }), signal),
    ).rejects.toMatchObject({ code: 'snapshot_expired' });
  } finally {
    await c.cleanup();
  }
});
