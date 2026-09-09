export type MediaTransportKind = 'audio' | 'cover';

export const mediaRequestHeaderNames = [
  'range',
  'if-range',
  'if-none-match',
  'if-modified-since',
] as const;

export const mediaResponseHeaderNames = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified',
  'cache-control',
  'expires',
] as const;

function opaqueId(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048)
    throw new TypeError('Invalid media ID');
  return encodeURIComponent(value);
}

/** Fixed, same-origin browser URLs; upstream credentials never enter this contract. */
export const mediaRoutes = Object.freeze({
  songStream: (id: string, quality?: PlaybackQuality, offset?: number) => {
    if (quality !== undefined && quality !== 'original' && quality !== 'economy')
      throw new TypeError('Invalid quality');
    if (
      offset !== undefined &&
      (quality !== 'economy' || !Number.isSafeInteger(offset) || offset < 0)
    )
      throw new TypeError('Invalid offset');
    return `/api/v1/media/songs/${opaqueId(id)}/stream${quality ? `?quality=${quality}${offset === undefined ? '' : `&offset=${offset}`}` : ''}`;
  },
  playback: (id: string, quality: PlaybackQuality) => {
    if (quality !== 'original' && quality !== 'economy') throw new TypeError('Invalid quality');
    return `/api/v1/media/songs/${opaqueId(id)}/playback?quality=${quality}`;
  },
  cover: (id: string) => `/api/v1/media/cover/${opaqueId(id)}`,
});

export type PlaybackQuality = 'original' | 'economy';
export interface PlaybackPlan {
  schemaVersion: 1;
  requestedQuality: PlaybackQuality;
  effectiveQuality: PlaybackQuality;
  seekMode: 'native' | 'offset';
  durationSeconds?: number;
  reason?: 'already_small' | 'metadata_unknown' | 'offset_unsupported';
  streamPath: string;
}
