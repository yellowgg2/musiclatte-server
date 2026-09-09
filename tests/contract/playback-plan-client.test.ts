import { expect, it } from 'vitest';
import { decodePlaybackPlan, fetchPlaybackPlan } from '../../apps/web/src/player/playback-plan';
const plan = {
  schemaVersion: 1,
  requestedQuality: 'economy',
  effectiveQuality: 'economy',
  seekMode: 'offset',
  durationSeconds: 180,
  streamPath: '/api/v1/media/songs/one/stream?quality=economy',
};
it.each([
  { streamPath: 'https://evil.test/audio' },
  { streamPath: '/api/v1/media/songs/one/stream?quality=economy&t=secret' },
  { streamPath: '/api/v1/media/songs/two/stream?quality=economy' },
  { durationSeconds: 0 },
  { seekMode: 'native' },
  { reason: 'already_small' },
  { secret: 'bad' },
  { requestedQuality: 'original' },
])('rejects an incoherent or untrusted plan %j', (change) => {
  expect(() => decodePlaybackPlan({ ...plan, ...change }, 'one', 'economy')).toThrow();
});
it('retains explicit unsupported reasons without inventing economy duration', () => {
  expect(
    decodePlaybackPlan(
      {
        ...plan,
        effectiveQuality: 'original',
        seekMode: 'native',
        reason: 'metadata_unknown',
        durationSeconds: undefined,
        streamPath: '/api/v1/media/songs/one/stream?quality=original',
      },
      'one',
      'economy',
    ).reason,
  ).toBe('metadata_unknown');
});
it('uses private same-origin reads and forwards401 as an auth failure', async () => {
  let options: RequestInit | undefined;
  const fetcher: typeof fetch = async (_input, init) => {
    options = init;
    return Response.json({}, { status: 401 });
  };
  await expect(
    fetchPlaybackPlan(fetcher, '', 'one', 'economy', new AbortController().signal),
  ).rejects.toMatchObject({ code: 'unauthenticated' });
  expect(options).toMatchObject({ credentials: 'include', cache: 'no-store', redirect: 'error' });
  expect(options?.signal).toBeInstanceOf(AbortSignal);
});
