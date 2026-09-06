import {
  apiErrorCodes,
  type ApiErrorCode,
  type FavoriteSongResponse,
  type FavoriteSongsResponse,
  type MusicEntry,
} from '@musiclatte/contracts';
import { ApiError } from '../auth/client';

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function entry(value: unknown): value is MusicEntry {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    Boolean(value.id) &&
    typeof value.title === 'string' &&
    Boolean(value.title) &&
    value.isDir === false &&
    ['artist', 'artistId', 'album', 'albumId', 'parent', 'coverArt', 'starred'].every(
      (key) => value[key] === undefined || typeof value[key] === 'string',
    ) &&
    (value.duration === undefined ||
      (typeof value.duration === 'number' &&
        Number.isFinite(value.duration) &&
        value.duration >= 0))
  );
}

function decodeList(value: unknown): FavoriteSongsResponse {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.songs) ||
    !value.songs.every(entry)
  )
    throw new ApiError('internal_error');
  return { schemaVersion: 1, songs: value.songs };
}

function decodeSet(value: unknown, id: string): FavoriteSongResponse {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    value.id !== id ||
    typeof value.starred !== 'boolean'
  )
    throw new ApiError('internal_error');
  if (value.starred === true && entry(value.song))
    return { schemaVersion: 1, id, starred: true, song: value.song };
  if (value.starred === false && !('song' in value))
    return { schemaVersion: 1, id, starred: false };
  throw new ApiError('internal_error');
}

function responseCode(response: Response, value: unknown): ApiErrorCode {
  if (
    record(value) &&
    record(value.error) &&
    apiErrorCodes.includes(value.error.code as ApiErrorCode)
  )
    return value.error.code as ApiErrorCode;
  if (response.status === 401) return 'unauthenticated';
  if (response.status === 403) return 'forbidden';
  if (response.status === 404) return 'not_found';
  if (response.status === 409) return 'outcome_unknown';
  return 'upstream_unavailable';
}

export function createFavoritesClient({
  fetcher = fetch,
  apiOrigin = '',
}: { fetcher?: typeof fetch; apiOrigin?: string } = {}) {
  async function request(
    path: string,
    signal: AbortSignal,
    mutation?: { csrfToken: string; starred: boolean },
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(`${apiOrigin}${path}`, {
        credentials: 'include',
        cache: 'no-store',
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          ...(mutation
            ? {
                'Content-Type': 'application/json',
                'X-Musiclatte-Client': 'web',
                'X-CSRF-Token': mutation.csrfToken,
              }
            : {}),
        },
        ...(mutation ? { method: 'PUT', body: JSON.stringify({ starred: mutation.starred }) } : {}),
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      });
    } catch {
      throw new ApiError('upstream_unavailable');
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new ApiError(response.ok ? 'internal_error' : 'upstream_unavailable');
    }
    if (!response.ok) throw new ApiError(responseCode(response, value));
    return value;
  }

  return {
    async read(signal: AbortSignal): Promise<FavoriteSongsResponse> {
      return decodeList(await request('/api/v1/favorites/songs', signal));
    },
    async set(
      id: string,
      starred: boolean,
      { csrfToken, signal }: { csrfToken: string; signal: AbortSignal },
    ): Promise<FavoriteSongResponse> {
      return decodeSet(
        await request(`/api/v1/favorites/songs/${encodeURIComponent(id)}`, signal, {
          csrfToken,
          starred,
        }),
        id,
      );
    },
  };
}

export type FavoritesClient = ReturnType<typeof createFavoritesClient>;
