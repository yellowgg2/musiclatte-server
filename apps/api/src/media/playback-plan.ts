import { mediaRoutes, type PlaybackPlan, type PlaybackQuality } from '@musiclatte/contracts';
import { ApiError } from '../auth/session-service.js';
import type { SubsonicClient } from '../subsonic/client.js';
export interface StreamQuery {
  quality?: PlaybackQuality;
  offset?: string;
}
export function parseStreamQuery(value: unknown, required = false): StreamQuery {
  const q = value as Record<string, unknown>;
  if (
    !q ||
    Object.keys(q).some((k) => !['quality', 'offset'].includes(k)) ||
    (q.quality !== undefined && q.quality !== 'original' && q.quality !== 'economy') ||
    (required && q.quality === undefined) ||
    (required && q.offset !== undefined) ||
    (q.offset !== undefined &&
      (q.quality !== 'economy' ||
        typeof q.offset !== 'string' ||
        !/^(0|[1-9]\d*)$/.test(q.offset) ||
        !Number.isSafeInteger(Number(q.offset))))
  )
    throw new ApiError(400, 'invalid_request');
  return q as StreamQuery;
}
export async function playbackPlan(
  upstream: SubsonicClient,
  id: string,
  quality: PlaybackQuality,
  signal: AbortSignal,
): Promise<PlaybackPlan> {
  const metadata = await upstream.streamMetadata(id, { signal });
  if (metadata.id !== id) throw new ApiError(503, 'upstream_unavailable');
  const duration =
    metadata.duration !== undefined && Number.isFinite(metadata.duration) && metadata.duration > 0
      ? metadata.duration
      : undefined;
  const base: PlaybackPlan = {
    schemaVersion: 1,
    requestedQuality: quality,
    effectiveQuality: 'original',
    seekMode: 'native',
    ...(duration === undefined ? {} : { durationSeconds: duration }),
    streamPath: mediaRoutes.songStream(id, 'original'),
  };
  if (quality === 'original') return base;
  if (metadata.bitRate !== undefined && metadata.bitRate > 0 && metadata.bitRate <= 128)
    return { ...base, reason: 'already_small' };
  if (
    metadata.bitRate === undefined ||
    !Number.isFinite(metadata.bitRate) ||
    metadata.bitRate <= 128 ||
    duration === undefined
  )
    return { ...base, reason: 'metadata_unknown' };
  const extensions = await upstream.extensions({ signal });
  if (!extensions.some((e) => e.name === 'transcodeOffset' && e.versions.includes(1)))
    return { ...base, reason: 'offset_unsupported' };
  return {
    ...base,
    effectiveQuality: 'economy',
    seekMode: 'offset',
    streamPath: mediaRoutes.songStream(id, 'economy'),
  };
}
