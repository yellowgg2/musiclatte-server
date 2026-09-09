import {
  apiErrorCodes,
  decodeMixInput,
  type SavedMix,
  type MusicEntry,
} from '@musiclatte/contracts';
import { ApiError } from '../auth/client';
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ApiError('internal_error');
  return value as Record<string, unknown>;
}
function mix(value: unknown): SavedMix {
  const source = record(value);
  let input;
  try {
    input = decodeMixInput({ name: source.name, conditions: source.conditions });
  } catch {
    throw new ApiError('internal_error');
  }
  if (
    typeof source.id !== 'string' ||
    !source.id ||
    typeof source.revision !== 'number' ||
    !Number.isSafeInteger(source.revision) ||
    source.revision < 1 ||
    typeof source.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(source.createdAt)) ||
    typeof source.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(source.updatedAt))
  )
    throw new ApiError('internal_error');
  return {
    ...input,
    id: source.id,
    revision: source.revision,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}
export function createMixClient(fetcher: typeof fetch, apiOrigin: string, csrfToken: string) {
  async function request(path: string, signal: AbortSignal, method = 'GET', body?: object) {
    let response;
    try {
      response = await fetcher(`${apiOrigin}/api/v1${path}`, {
        method,
        credentials: 'include',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        headers: {
          Accept: 'application/json',
          ...(body
            ? {
                'Content-Type': 'application/json',
                'X-Musiclatte-Client': 'web',
                'X-CSRF-Token': csrfToken,
              }
            : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new ApiError('upstream_unavailable');
    }
    const value = record(await response.json());
    if (!response.ok) {
      const code = record(value.error).code;
      throw new ApiError(apiErrorCodes.find((item) => item === code) ?? 'upstream_unavailable');
    }
    if (value.schemaVersion !== 1) throw new ApiError('internal_error');
    return value;
  }
  const path = (id: string) => `/mixes/${encodeURIComponent(id)}`;
  return {
    async list(signal: AbortSignal, cursor?: string) {
      const value = await request(
        `/mixes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
        signal,
      );
      if (
        !Array.isArray(value.mixes) ||
        !(value.nextCursor === null || typeof value.nextCursor === 'string')
      )
        throw new ApiError('internal_error');
      return { mixes: value.mixes.map(mix), nextCursor: value.nextCursor };
    },
    async get(id: string, signal: AbortSignal) {
      return mix((await request(path(id), signal)).mix);
    },
    async save(id: string | undefined, body: object, signal: AbortSignal) {
      return mix(
        (await request(id ? path(id) : '/mixes', signal, id ? 'PATCH' : 'POST', body)).mix,
      );
    },
    async remove(id: string, body: object, signal: AbortSignal) {
      const value = await request(path(id), signal, 'DELETE', body);
      if (value.deleted !== true || value.id !== id) throw new ApiError('internal_error');
    },
    async songs(id: string, signal: AbortSignal): Promise<MusicEntry[]> {
      const value = await request(`${path(id)}/songs`, signal);
      if (value.mixId !== id || !Array.isArray(value.songs)) throw new ApiError('internal_error');
      const ids = new Set<string>();
      const songs: MusicEntry[] = [];
      for (const item of value.songs) {
        const song = record(item);
        if (typeof song.id !== 'string' || typeof song.title !== 'string' || song.isDir !== false)
          throw new ApiError('internal_error');
        if (!ids.has(song.id)) {
          ids.add(song.id);
          songs.push(item);
        }
      }
      return songs;
    },
    async folders(signal: AbortSignal): Promise<{ id: string; name: string }[]> {
      const value = await request('/music/folders', signal);
      if (!Array.isArray(value.folders)) throw new ApiError('internal_error');
      return value.folders.map((item) => {
        const folder = record(item);
        if (typeof folder.id !== 'string' || typeof folder.name !== 'string')
          throw new ApiError('internal_error');
        return { id: folder.id, name: folder.name };
      });
    },
    async genres(signal: AbortSignal): Promise<string[]> {
      const value = await request('/music/genres', signal);
      if (!Array.isArray(value.genres)) throw new ApiError('internal_error');
      return value.genres.map((item) => {
        const genre = record(item);
        if (typeof genre.value !== 'string') throw new ApiError('internal_error');
        return genre.value;
      });
    },
  };
}
