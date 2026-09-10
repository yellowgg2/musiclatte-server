import {
  apiErrorCodes,
  recentInstantSchema,
  type MusicEntry,
  type RecentDownloadItem,
  type RecentDownloadQuery,
  type RecentDownloadResponse,
} from '@musiclatte/contracts';
import { ApiError } from '../auth/client';
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  return (
    required.every((key) => key in value) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  );
}
function text(value: unknown, max = Infinity): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}
function instant(value: unknown): value is string {
  return (
    text(value) &&
    new RegExp(recentInstantSchema.pattern).test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 19) === value.slice(0, 19)
  );
}
function song(value: unknown): value is MusicEntry {
  const strings = [
    'parent',
    'albumId',
    'artistId',
    'coverArt',
    'album',
    'artist',
    'genre',
    'contentType',
    'suffix',
    'starred',
  ];
  const numbers = ['duration', 'bitRate', 'size', 'track', 'year'];
  return (
    record(value) &&
    keys(value, ['id', 'title', 'isDir'], [...strings, ...numbers]) &&
    text(value.id, 2048) &&
    typeof value.title === 'string' &&
    value.isDir === false &&
    strings.every((key) => !(key in value) || typeof value[key] === 'string') &&
    numbers.every(
      (key) =>
        !(key in value) ||
        (typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0),
    )
  );
}
function item(value: unknown): value is RecentDownloadItem {
  if (
    !record(value) ||
    !text(value.eventId, 1024) ||
    !instant(value.downloadCompletedAt) ||
    ('registeredAt' in value && !instant(value.registeredAt))
  )
    return false;
  if (value.state === 'ready')
    return (
      keys(value, ['eventId', 'downloadCompletedAt', 'registeredAt', 'state', 'song']) &&
      instant(value.registeredAt) &&
      song(value.song)
    );
  return (
    (value.state === 'registering' || value.state === 'missing') &&
    keys(value, ['eventId', 'downloadCompletedAt', 'state'], ['registeredAt'])
  );
}
export function decodeRecent(value: unknown): RecentDownloadResponse {
  if (
    !record(value) ||
    !keys(value, ['schemaVersion', 'filter', 'asOf', 'items', 'nextCursor']) ||
    value.schemaVersion !== 1 ||
    !record(value.filter) ||
    !keys(value.filter, ['from', 'to']) ||
    !instant(value.filter.from) ||
    !instant(value.filter.to) ||
    Date.parse(value.filter.from) >= Date.parse(value.filter.to) ||
    !instant(value.asOf) ||
    !Array.isArray(value.items) ||
    value.items.length > 100 ||
    !value.items.every(item) ||
    new Set(value.items.map((i) => i.eventId)).size !== value.items.length ||
    !(value.nextCursor === null || text(value.nextCursor, 4096))
  )
    throw new ApiError('internal_error');
  return {
    schemaVersion: 1,
    filter: { from: value.filter.from, to: value.filter.to },
    asOf: value.asOf,
    items: value.items,
    nextCursor: value.nextCursor,
  };
}
export function createRecentClient({
  fetcher = fetch,
  apiOrigin = '',
}: { fetcher?: typeof fetch; apiOrigin?: string } = {}) {
  return {
    async list(
      signal: AbortSignal,
      query: RecentDownloadQuery = {},
    ): Promise<RecentDownloadResponse> {
      const params = new URLSearchParams();
      for (const key of ['from', 'to', 'cursor', 'limit'] as const)
        if (query[key] !== undefined) params.set(key, query[key]);
      let response: Response;
      try {
        response = await fetcher(
          `${apiOrigin}/api/v1/recent-downloads${params.size ? `?${params}` : ''}`,
          {
            credentials: 'include',
            cache: 'no-store',
            redirect: 'error',
            headers: { Accept: 'application/json' },
            signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
          },
        );
      } catch {
        throw new ApiError('upstream_unavailable');
      }
      if (response.status === 401) throw new ApiError('unauthenticated');
      if (response.status === 403) throw new ApiError('forbidden');
      let value: unknown;
      try {
        value = await response.json();
      } catch {
        throw new ApiError(response.ok ? 'internal_error' : 'upstream_unavailable');
      }
      if (!response.ok) {
        const candidate = record(value) && record(value.error) ? value.error.code : undefined;
        const code = apiErrorCodes.find((code) => code === candidate);
        throw new ApiError(code ?? 'upstream_unavailable');
      }
      return decodeRecent(value);
    },
  };
}
