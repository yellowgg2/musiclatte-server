import { afterEach, expect, it } from 'vitest';
import { cookieOf, createTestContext } from '../../../tests/support/auth-harness.js';
const contexts: Awaited<ReturnType<typeof createTestContext>>[] = [];
afterEach(async () => {
  for (const c of contexts.splice(0)) await c.cleanup();
});
async function setup(enabled = true) {
  const c = await createTestContext({ streamQuality: enabled });
  contexts.push(c);
  c.state.songIdFromRequest = true;
  c.state.songBitRateOverride = 256;
  const headers = { cookie: cookieOf(await c.login()) };
  return { ...c, headers };
}
it('preserves legacy URLs but fixes explicit original and economy parameters', async () => {
  const c = await setup();
  for (const query of ['', '?quality=original', '?quality=economy&offset=12']) {
    const r = await c.app.inject({
      url: '/api/v1/media/songs/song-1/stream' + query,
      headers: c.headers,
    });
    expect(r.statusCode).toBe(200);
  }
  const qs = c.mediaRequests.map((r) => r.url.searchParams);
  expect(qs[0]!.has('format')).toBe(false);
  expect(qs[1]!.get('format')).toBe('raw');
  expect(qs[2]!.get('format')).toBe('mp3');
  expect(qs[2]!.get('maxBitRate')).toBe('128');
  expect(qs[2]!.get('timeOffset')).toBe('12');
});
it('resolves offset plan and refuses low bitrate metadata changes before streaming', async () => {
  const c = await setup();
  const plan = await c.app.inject({
    url: '/api/v1/media/songs/song-1/playback?quality=economy',
    headers: c.headers,
  });
  expect(plan.statusCode).toBe(200);
  expect(plan.json()).toMatchObject({
    schemaVersion: 1,
    requestedQuality: 'economy',
    effectiveQuality: 'economy',
    seekMode: 'offset',
    streamPath: '/api/v1/media/songs/song-1/stream?quality=economy',
  });
  c.state.songBitRateOverride = 64;
  const changed = await c.app.inject({
    url: plan.json().streamPath + '&offset=10',
    headers: c.headers,
  });
  expect(changed.statusCode).toBe(409);
  expect(changed.json().error.code).toBe('playback_plan_changed');
  expect(c.mediaRequests).toHaveLength(0);
  const small = await c.app.inject({
    url: '/api/v1/media/songs/song-1/playback?quality=economy',
    headers: c.headers,
  });
  expect(small.json()).toMatchObject({
    effectiveQuality: 'original',
    seekMode: 'native',
    reason: 'already_small',
  });
});
it.each([
  'quality=bad',
  'quality=original&offset=0',
  'quality=economy&offset=-1',
  'quality=economy&offset=1.5',
  'quality=economy&offset=210',
  'offset=0',
  'quality=economy&format=flac',
  'quality=economy&quality=original',
])('rejects invalid input %s', async (query) => {
  const c = await setup();
  const r = await c.app.inject({
    url: '/api/v1/media/songs/song-1/stream?' + query,
    headers: c.headers,
  });
  expect(r.statusCode).toBe(400);
  expect(c.mediaRequests).toHaveLength(0);
});
it('keeps feature off and authentication authoritative', async () => {
  const c = await setup(false);
  expect(
    (await c.app.inject({ url: '/api/v1/media/songs/song-1/playback?quality=original' }))
      .statusCode,
  ).toBe(401);
  expect(
    (
      await c.app.inject({
        url: '/api/v1/media/songs/song-1/playback?quality=original',
        headers: c.headers,
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (await c.app.inject({ url: '/api/v1/media/songs/song-1/stream', headers: c.headers }))
      .statusCode,
  ).toBe(200);
});

it('uses strict opt-in configuration', async () => {
  const { readStreamQualityEnabled } = await import('../src/config/runtime.js');
  expect(readStreamQualityEnabled({})).toBe(false);
  expect(readStreamQualityEnabled({ STREAM_QUALITY_ENABLED: 'true' })).toBe(true);
  expect(() => readStreamQualityEnabled({ STREAM_QUALITY_ENABLED: '1' })).toThrow();
});
