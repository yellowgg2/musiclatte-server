import { mediaRoutes, type PlaybackPlan, type PlaybackQuality } from '@musiclatte/contracts';
import { ApiError } from '../auth/client';
export function decodePlaybackPlan(
  value: unknown,
  id: string,
  quality: PlaybackQuality,
): PlaybackPlan {
  if (!value || typeof value !== 'object') throw new ApiError('internal_error');
  const p = value as PlaybackPlan;
  if (
    Object.keys(p).some(
      (k) =>
        ![
          'schemaVersion',
          'requestedQuality',
          'effectiveQuality',
          'seekMode',
          'durationSeconds',
          'reason',
          'streamPath',
        ].includes(k),
    ) ||
    p.schemaVersion !== 1 ||
    p.requestedQuality !== quality ||
    !['original', 'economy'].includes(p.effectiveQuality) ||
    p.streamPath !== mediaRoutes.songStream(id, p.effectiveQuality) ||
    (p.durationSeconds !== undefined &&
      (!Number.isFinite(p.durationSeconds) || p.durationSeconds <= 0)) ||
    (p.effectiveQuality === 'economy' &&
      (quality !== 'economy' ||
        p.seekMode !== 'offset' ||
        p.durationSeconds === undefined ||
        p.reason !== undefined)) ||
    (p.effectiveQuality === 'original' && p.seekMode !== 'native') ||
    (quality === 'original' && (p.effectiveQuality !== 'original' || p.reason !== undefined)) ||
    (quality === 'economy' &&
      p.effectiveQuality === 'original' &&
      !['already_small', 'metadata_unknown', 'offset_unsupported'].includes(p.reason!))
  )
    throw new ApiError('internal_error');
  return { ...p };
}
export async function fetchPlaybackPlan(
  fetcher: typeof fetch,
  apiOrigin: string,
  id: string,
  quality: PlaybackQuality,
  signal: AbortSignal,
): Promise<PlaybackPlan> {
  const r = await fetcher(apiOrigin + mediaRoutes.playback(id, quality), {
    credentials: 'include',
    cache: 'no-store',
    redirect: 'error',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  if (!r.ok)
    throw new ApiError(
      r.status === 401
        ? 'unauthenticated'
        : r.status === 409
          ? 'playback_plan_changed'
          : 'upstream_unavailable',
    );
  return decodePlaybackPlan(await r.json(), id, quality);
}
