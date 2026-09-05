import {
  apiErrorCodes,
  type ApiErrorCode,
  type MusicEntry,
  type PlaylistDetail,
  type PlaylistOccurrence,
  type PlaylistSummary,
} from '@musiclatte/contracts';
import { ApiError } from '../auth/client';
import type { PlaylistRoute } from './routes';

export type PlaylistData =
  { kind: 'list'; playlists: PlaylistSummary[] } | { kind: 'detail'; playlist: PlaylistDetail };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function apiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && apiErrorCodes.some((code) => code === value);
}

function musicEntry(value: unknown): value is MusicEntry {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.isDir === 'boolean' &&
    ['artist', 'artistId', 'album', 'albumId', 'parent', 'coverArt'].every(
      (key) => value[key] === undefined || typeof value[key] === 'string',
    ) &&
    (value.duration === undefined || finiteNonnegative(value.duration))
  );
}

function playlistSummary(value: unknown): value is PlaylistSummary {
  return (
    record(value) &&
    ['id', 'name', 'owner', 'created', 'changed', 'revision'].every(
      (key) => typeof value[key] === 'string',
    ) &&
    finiteNonnegative(value.songCount) &&
    Number.isSafeInteger(value.songCount) &&
    finiteNonnegative(value.duration) &&
    typeof value.public === 'boolean' &&
    typeof value.editable === 'boolean' &&
    value.coverState === 'fallback'
  );
}

function occurrence(value: unknown): value is PlaylistOccurrence {
  return (
    record(value) &&
    Number.isSafeInteger(value.position) &&
    Number(value.position) >= 0 &&
    musicEntry(value.song)
  );
}

function playlistDetail(value: unknown): value is PlaylistDetail {
  if (!record(value)) return false;
  const summary = { ...value, coverState: 'fallback' };
  return (
    playlistSummary(summary) &&
    (value.coverState === 'fallback' || value.coverState === 'available') &&
    (value.coverArt === undefined || typeof value.coverArt === 'string') &&
    Array.isArray(value.entries) &&
    value.entries.every(occurrence) &&
    value.entries.every((entry, index) => entry.position === index)
  );
}

export function decodePlaylistResponse(value: unknown, route: PlaylistRoute): PlaylistData {
  if (!record(value) || value.schemaVersion !== 1) throw new ApiError('internal_error');
  if (
    route.kind === 'list' &&
    Array.isArray(value.playlists) &&
    value.playlists.every(playlistSummary)
  )
    return { kind: 'list', playlists: value.playlists };
  if (route.kind === 'detail' && playlistDetail(value.playlist))
    return { kind: 'detail', playlist: value.playlist };
  throw new ApiError('internal_error');
}

export function createPlaylistClient({
  fetcher = fetch,
  apiOrigin = '',
}: { fetcher?: typeof fetch; apiOrigin?: string } = {}) {
  return {
    async read(route: PlaylistRoute, signal: AbortSignal): Promise<PlaylistData> {
      const path =
        route.kind === 'list'
          ? '/api/v1/playlists'
          : `/api/v1/playlists/${encodeURIComponent(route.id)}`;
      let response: Response;
      try {
        response = await fetcher(`${apiOrigin}${path}`, {
          credentials: 'include',
          cache: 'no-store',
          redirect: 'error',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        });
      } catch {
        throw new ApiError('upstream_unavailable');
      }
      if (!response.ok) {
        let code: ApiErrorCode =
          response.status === 401
            ? 'unauthenticated'
            : response.status === 403
              ? 'forbidden'
              : response.status === 404
                ? 'not_found'
                : 'upstream_unavailable';
        try {
          const value: unknown = await response.json();
          if (record(value) && record(value.error) && apiErrorCode(value.error.code))
            code = value.error.code;
        } catch {
          /* Raw upstream responses never become UI copy. */
        }
        throw new ApiError(code);
      }
      return decodePlaylistResponse(await response.json(), route);
    },
  };
}
