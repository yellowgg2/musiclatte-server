import { apiErrorCodes, type MusicEntry } from '@musiclatte/contracts';
import { ApiError } from '../auth/client';
export interface ListeningRow {
  key: string;
  songId: string;
  time: string;
  count?: number;
  song: MusicEntry | null;
}
export interface ListeningPage {
  rows: ListeningRow[];
  nextCursor: string | null;
  asOf: string;
}
export function listeningRange(preset: 'all' | '7' | '30', now = Date.now()) {
  return preset === 'all'
    ? {}
    : {
        from: new Date(now - Number(preset) * 86400000).toISOString(),
        to: new Date(now).toISOString(),
      };
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ApiError('internal_error');
  return value as Record<string, unknown>;
}
export function createListeningReader(fetcher: typeof fetch, apiOrigin: string) {
  return {
    async page(
      kind: 'history' | 'top',
      range: { from?: string; to?: string },
      signal: AbortSignal,
      cursor?: string,
    ): Promise<ListeningPage> {
      const query = new URLSearchParams({ ...range, ...(cursor ? { cursor } : {}) });
      let response;
      try {
        response = await fetcher(
          `${apiOrigin}/api/v1/listening/${kind === 'history' ? 'history' : 'top-songs'}?${query}`,
          {
            credentials: 'include',
            cache: 'no-store',
            redirect: 'error',
            signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
            headers: { Accept: 'application/json' },
          },
        );
      } catch {
        throw new ApiError('upstream_unavailable');
      }
      const data = record(await response.json());
      if (!response.ok) {
        const code = record(data.error).code;
        throw new ApiError(apiErrorCodes.find((item) => item === code) ?? 'upstream_unavailable');
      }
      if (
        data.schemaVersion !== 1 ||
        data.source !== 'web' ||
        !Array.isArray(data.items) ||
        typeof data.asOf !== 'string' ||
        !Number.isFinite(Date.parse(data.asOf)) ||
        !(data.nextCursor === null || typeof data.nextCursor === 'string')
      )
        throw new ApiError('internal_error');
      const rows = data.items.map((value) => {
        const item = record(value);
        const time = kind === 'history' ? item.qualifiedAt : item.lastQualifiedAt;
        const key = kind === 'history' ? item.id : item.songId;
        if (
          typeof key !== 'string' ||
          !key ||
          typeof item.songId !== 'string' ||
          !item.songId ||
          typeof time !== 'string' ||
          !Number.isFinite(Date.parse(time)) ||
          (kind === 'top' && (!Number.isSafeInteger(item.count) || Number(item.count) < 1))
        )
          throw new ApiError('internal_error');
        let song: MusicEntry | null = null;
        if (item.song !== null) {
          const s = record(item.song);
          if (
            s.id !== item.songId ||
            typeof s.title !== 'string' ||
            s.isDir !== false ||
            ['artist', 'album', 'artistId', 'albumId', 'coverArt'].some(
              (field) => s[field] !== undefined && typeof s[field] !== 'string',
            ) ||
            (s.duration !== undefined &&
              (typeof s.duration !== 'number' || !Number.isFinite(s.duration) || s.duration < 0))
          )
            throw new ApiError('internal_error');
          song = s as unknown as MusicEntry;
        }
        return {
          key,
          songId: item.songId,
          time,
          ...(kind === 'top' ? { count: Number(item.count) } : {}),
          song,
        };
      });
      if (new Set(rows.map((row) => row.key)).size !== rows.length)
        throw new ApiError('internal_error');
      return { rows, nextCursor: data.nextCursor, asOf: data.asOf };
    },
  };
}
