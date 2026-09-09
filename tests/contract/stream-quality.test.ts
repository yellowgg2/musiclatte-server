import { afterEach, expect, it } from 'vitest';
import { mediaRoutes } from '../../packages/contracts/src/index.js';
import { cookieOf, createTestContext } from '../support/auth-harness.js';
const contexts: Awaited<ReturnType<typeof createTestContext>>[] = [];
afterEach(async () => {
  for (const c of contexts.splice(0)) await c.cleanup();
});
async function setup() {
  const c = await createTestContext({ streamQuality: true });
  contexts.push(c);
  c.state.songIdFromRequest = true;
  c.state.songBitRateOverride = 256;
  return { ...c, headers: { cookie: cookieOf(await c.login()) } };
}
it('retains warm range and conditional statuses with representation-bound validators', async () => {
  const c = await setup();
  const url = mediaRoutes.songStream('tr-1', 'economy');
  const first = await c.app.inject({ url, headers: c.headers });
  expect(first.statusCode).toBe(200);
  const etag = String(first.headers.etag);
  expect(etag).toContain('p7-economy-0-');
  expect(
    (await c.app.inject({ url, headers: { ...c.headers, 'if-none-match': etag } })).statusCode,
  ).toBe(304);
  expect(
    (await c.app.inject({ url, headers: { ...c.headers, range: 'bytes=0-10', 'if-range': etag } }))
      .statusCode,
  ).toBe(206);
  expect(
    (await c.app.inject({ url, headers: { ...c.headers, range: 'bytes=999999999-' } })).statusCode,
  ).toBe(416);
  const head = await c.app.inject({ method: 'HEAD', url, headers: c.headers });
  expect(head.statusCode).toBe(200);
  expect(head.rawPayload.length).toBe(0);
  await c.app.inject({
    url: mediaRoutes.songStream('tr-1', 'original'),
    headers: { ...c.headers, range: 'bytes=0-10', 'if-range': etag },
  });
  expect(c.mediaRequests.at(-1)?.range).toBeUndefined();
  await c.app.inject({
    url: url + '&offset=10',
    headers: { ...c.headers, range: 'bytes=0-10', 'if-range': etag },
  });
  expect(c.mediaRequests.at(-1)?.range).toBeUndefined();
  expect(c.mediaRequests.at(-1)?.ifRange).toBeUndefined();
});
it('returns an explicit unknown-metadata reason and never dispatches an economy stream', async () => {
  const c = await setup();
  c.state.songUnknownDuration = true;
  const p = await c.app.inject({
    url: mediaRoutes.playback('tr-1', 'economy'),
    headers: c.headers,
  });
  expect(p.json()).toMatchObject({
    effectiveQuality: 'original',
    reason: 'metadata_unknown',
    seekMode: 'native',
  });
  expect(p.json()).not.toHaveProperty('durationSeconds');
  const r = await c.app.inject({
    url: mediaRoutes.songStream('tr-1', 'economy'),
    headers: c.headers,
  });
  expect(r.statusCode).toBe(409);
  expect(c.mediaRequests).toHaveLength(0);
});
it('encodes identifiers and refuses arbitrary profiles at both public routes', async () => {
  const c = await setup();
  expect(mediaRoutes.playback('a/?u=x', 'original')).toBe(
    '/api/v1/media/songs/a%2F%3Fu%3Dx/playback?quality=original',
  );
  for (const suffix of [
    'playback?quality=economy&format=opus',
    'playback?quality=original&offset=1',
    'stream?quality=economy&maxBitRate=64',
  ])
    expect(
      (await c.app.inject({ url: '/api/v1/media/songs/tr-1/' + suffix, headers: c.headers }))
        .statusCode,
    ).toBe(400);
  expect(c.mediaRequests).toHaveLength(0);
});
