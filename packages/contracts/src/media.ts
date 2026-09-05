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
  songStream: (id: string) => `/api/v1/media/songs/${opaqueId(id)}/stream`,
  cover: (id: string) => `/api/v1/media/cover/${opaqueId(id)}`,
});
