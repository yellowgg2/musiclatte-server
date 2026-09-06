import {
  apiErrorCodes,
  type ApiErrorCode,
  type MusicEntry,
  type PlaylistDeleteResponse,
  type PlaylistDetail,
  type PlaylistMutationOutcome,
  type PlaylistMutationResponse,
  type PlaylistOccurrence,
  type PlaylistSummary,
} from '@musiclatte/contracts';
import { ApiError } from '../auth/client';
import type { PlaylistRoute } from './routes';

export type PlaylistData =
  { kind: 'list'; playlists: PlaylistSummary[] } | { kind: 'detail'; playlist: PlaylistDetail };

export class PlaylistMutationError extends ApiError {
  constructor(
    code: ApiErrorCode,
    public readonly current?: PlaylistDetail,
  ) {
    super(code);
  }
}

export type PlaylistMutationOptions = {
  csrfToken: string;
  operationId: string;
  signal: AbortSignal;
};

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

function mutationOutcome(value: unknown): value is PlaylistMutationOutcome {
  return value === 'applied' || value === 'already_applied';
}

function decodeMutationResponse(value: unknown): PlaylistMutationResponse {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    !mutationOutcome(value.outcome) ||
    !playlistDetail(value.playlist)
  )
    throw new ApiError('internal_error');
  return value as unknown as PlaylistMutationResponse;
}

function decodeDeleteResponse(value: unknown): PlaylistDeleteResponse {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    !mutationOutcome(value.outcome) ||
    typeof value.playlistId !== 'string' ||
    !value.playlistId ||
    value.deleted !== true
  )
    throw new ApiError('internal_error');
  return value as unknown as PlaylistDeleteResponse;
}

export function createPlaylistClient({
  fetcher = fetch,
  apiOrigin = '',
}: { fetcher?: typeof fetch; apiOrigin?: string } = {}) {
  async function request(
    path: string,
    signal: AbortSignal,
    mutation?: { method: 'POST' | 'PATCH' | 'DELETE'; csrfToken: string; body: object },
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
        ...(mutation ? { method: mutation.method, body: JSON.stringify(mutation.body) } : {}),
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

    if (!response.ok) {
      if (
        response.status === 409 &&
        record(value) &&
        value.schemaVersion === 1 &&
        record(value.error) &&
        (value.error.code === 'conflict' || value.error.code === 'outcome_unknown') &&
        value.error.retryable === false &&
        (value.current === undefined || playlistDetail(value.current))
      )
        throw new PlaylistMutationError(value.error.code, value.current);

      let code: ApiErrorCode =
        response.status === 401
          ? 'unauthenticated'
          : response.status === 403
            ? 'forbidden'
            : response.status === 404
              ? 'not_found'
              : response.status === 422
                ? 'invalid_request'
                : 'upstream_unavailable';
      if (record(value) && record(value.error) && apiErrorCode(value.error.code))
        code = value.error.code;
      throw new ApiError(code);
    }
    return value;
  }

  return {
    async read(route: PlaylistRoute, signal: AbortSignal): Promise<PlaylistData> {
      const path =
        route.kind === 'list'
          ? '/api/v1/playlists'
          : `/api/v1/playlists/${encodeURIComponent(route.id)}`;
      return decodePlaylistResponse(await request(path, signal), route);
    },
    async create(
      name: string,
      { csrfToken, operationId, signal }: PlaylistMutationOptions,
    ): Promise<PlaylistMutationResponse> {
      return decodeMutationResponse(
        await request('/api/v1/playlists', signal, {
          method: 'POST',
          csrfToken,
          body: { operationId, name },
        }),
      );
    },
    async rename(
      id: string,
      expectedRevision: string,
      name: string,
      { csrfToken, operationId, signal }: PlaylistMutationOptions,
    ): Promise<PlaylistMutationResponse> {
      return decodeMutationResponse(
        await request(`/api/v1/playlists/${encodeURIComponent(id)}`, signal, {
          method: 'PATCH',
          csrfToken,
          body: { operationId, expectedRevision, action: 'rename', name },
        }),
      );
    },
    async delete(
      id: string,
      expectedRevision: string,
      { csrfToken, operationId, signal }: PlaylistMutationOptions,
    ): Promise<PlaylistDeleteResponse> {
      return decodeDeleteResponse(
        await request(`/api/v1/playlists/${encodeURIComponent(id)}`, signal, {
          method: 'DELETE',
          csrfToken,
          body: { operationId, expectedRevision },
        }),
      );
    },
  };
}
