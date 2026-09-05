import {
  apiErrorCodes,
  type ApiErrorCode,
  type MusicAlbum,
  type MusicArtist,
  type MusicDirectory,
  type MusicEntry,
  type MusicFolder,
  type MusicIndexes,
  type MusicSearchResult,
} from '@musiclatte/contracts';
import { ApiError } from '../auth/client';
import { pageOffset, type MusicRoute } from './queries';
export type LibraryData =
  | { kind: 'folders'; folders: MusicFolder[] }
  | { kind: 'indexes'; indexes: MusicIndexes }
  | { kind: 'folder'; directory: MusicDirectory }
  | { kind: 'search'; result: MusicSearchResult }
  | { kind: 'artist'; artist: MusicArtist }
  | { kind: 'album'; album: MusicAlbum };
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function strings(value: Record<string, unknown>, keys: string[]) {
  return keys.every((key) => typeof value[key] === 'string');
}
function list<T>(value: unknown, check: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(check);
}
function entry(value: unknown): value is MusicEntry {
  return (
    record(value) &&
    strings(value, ['id', 'title']) &&
    typeof value.isDir === 'boolean' &&
    ['artist', 'artistId', 'album', 'albumId', 'parent', 'coverArt'].every(
      (key) => value[key] === undefined || typeof value[key] === 'string',
    ) &&
    (value.duration === undefined ||
      (typeof value.duration === 'number' &&
        Number.isFinite(value.duration) &&
        value.duration >= 0))
  );
}
function folder(value: unknown): value is MusicFolder {
  return record(value) && strings(value, ['id', 'name']);
}
function album(value: unknown): value is MusicAlbum {
  return (
    folder(value) &&
    record(value) &&
    list(value.song, entry) &&
    ['artist', 'artistId'].every(
      (key) => value[key] === undefined || typeof value[key] === 'string',
    )
  );
}
function artist(value: unknown): value is MusicArtist {
  return folder(value) && record(value) && list(value.album, album);
}
function decode(value: unknown, kind: MusicRoute['kind']): LibraryData {
  if (record(value) && value.schemaVersion === 1) {
    if (kind === 'folders') {
      if (list(value.folders, folder)) return { kind: 'folders', folders: value.folders };
      const indexes = value.indexes;
      if (
        record(indexes) &&
        Array.isArray(indexes.index) &&
        indexes.index.every(
          (group) => record(group) && typeof group.name === 'string' && list(group.artist, artist),
        )
      )
        return {
          kind: 'indexes',
          indexes: {
            index: indexes.index.map((group) => ({
              name: String(group.name),
              artist: group.artist.filter(artist),
            })),
          },
        };
    }
    if (
      kind === 'folder' &&
      folder(value.directory) &&
      record(value.directory) &&
      list(value.directory.child, entry) &&
      (value.directory.parent === undefined || typeof value.directory.parent === 'string')
    )
      return {
        kind: 'folder',
        directory: {
          id: value.directory.id,
          name: value.directory.name,
          child: value.directory.child,
          ...(typeof value.directory.parent === 'string' ? { parent: value.directory.parent } : {}),
        },
      };
    if (kind === 'artist' && artist(value.artist)) return { kind: 'artist', artist: value.artist };
    if (kind === 'album' && album(value.album)) return { kind: 'album', album: value.album };
    const result = value.result;
    if (
      kind === 'search' &&
      record(result) &&
      list(result.song, entry) &&
      list(result.artist, artist) &&
      list(result.album, album)
    )
      return {
        kind: 'search',
        result: { song: result.song, artist: result.artist, album: result.album },
      };
  }
  throw new ApiError('internal_error');
}
export function createMusicClient({
  fetcher = fetch,
  apiOrigin = '',
}: { fetcher?: typeof fetch; apiOrigin?: string } = {}) {
  return {
    async read(route: MusicRoute, signal: AbortSignal): Promise<LibraryData> {
      const params = new URLSearchParams();
      let path = 'folders';
      if (route.kind === 'folders') {
        const id = route.query.get('musicFolderId');
        if (id) params.set('musicFolderId', id);
      } else if (route.kind === 'search') {
        path = 'search';
        params.set('q', route.query.get('q') ?? '');
        const scope = route.query.get('musicFolderId');
        if (scope) params.set('musicFolderId', scope);
        for (const kind of ['artist', 'album', 'song'] as const) {
          params.set(`${kind}Count`, '20');
          params.set(`${kind}Offset`, String(pageOffset(route.query, kind)));
        }
      } else
        path = `${{ folder: 'folders', artist: 'artists', album: 'albums' }[route.kind]}/${encodeURIComponent(route.id!)}`;
      let response: Response;
      try {
        response = await fetcher(
          `${apiOrigin}/api/v1/music/${path}${params.size ? `?${params}` : ''}`,
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
          const value = await response.json();
          if (apiErrorCodes.includes(value?.error?.code)) code = value.error.code;
        } catch {
          /* Raw upstream responses never become UI copy. */
        }
        throw new ApiError(code);
      }
      try {
        return decode(await response.json(), route.kind);
      } catch {
        throw new ApiError('internal_error');
      }
    },
  };
}
export type MusicClient = ReturnType<typeof createMusicClient>;
