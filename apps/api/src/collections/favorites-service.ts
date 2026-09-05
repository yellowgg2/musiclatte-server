import type {
  FavoriteSongResponse,
  FavoriteSongSetRequest,
  FavoriteSongsResponse,
} from '@musiclatte/contracts';
import { ApiError, type SessionService } from '../auth/session-service.js';
import { SubsonicError } from '../subsonic/errors.js';

type VerifiedSession = Awaited<ReturnType<SessionService['verify']>>;

function rejectFavoriteError(
  service: SessionService,
  verified: VerifiedSession,
  error: unknown,
): never {
  if (error instanceof ApiError) throw error;
  if (error instanceof SubsonicError) {
    if (error.kind === 'invalid_request') throw new ApiError(400, 'invalid_request');
    if (error.kind === 'not_found' || error.httpStatus === 404)
      throw new ApiError(404, 'not_found');
    if (error.kind === 'protocol_incompatible') throw new ApiError(422, 'upstream_incompatible');
  }
  return service.rejectUpstream(error, verified.session.raw);
}

export function createFavoritesService(service: SessionService) {
  async function read(
    verified: VerifiedSession,
    signal: AbortSignal,
  ): Promise<FavoriteSongsResponse> {
    try {
      return {
        schemaVersion: 1,
        songs: await verified.upstream.getStarred2({ signal }),
      };
    } catch (error) {
      return rejectFavoriteError(service, verified, error);
    }
  }

  async function set(
    verified: VerifiedSession,
    id: string,
    request: FavoriteSongSetRequest,
    signal: AbortSignal,
  ): Promise<FavoriteSongResponse> {
    try {
      if (request.starred) await verified.upstream.starSong(id, { signal });
      else await verified.upstream.unstarSong(id, { signal });

      const song = (await verified.upstream.getStarred2({ signal })).find(
        (entry) => !entry.isDir && entry.id === id,
      );
      if (request.starred) {
        if (!song) throw new ApiError(404, 'not_found');
        return { schemaVersion: 1, id, starred: true, song };
      }
      if (song) throw new ApiError(409, 'outcome_unknown');
      return { schemaVersion: 1, id, starred: false };
    } catch (error) {
      return rejectFavoriteError(service, verified, error);
    }
  }

  return { read, set };
}
