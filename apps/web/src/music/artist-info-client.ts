import { apiErrorCodes, type ApiErrorCode, type ArtistInfoResponse } from '@musiclatte/contracts';
import { ApiError } from '../auth/client';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function decode(value: unknown, artistId: string): ArtistInfoResponse {
  if (!record(value)) throw new ApiError('internal_error');
  const allowed = new Set([
    'schemaVersion',
    'artistId',
    'state',
    'biography',
    'musicBrainzId',
    'coverArtId',
    'similarArtists',
  ]);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    value.schemaVersion !== 1 ||
    value.artistId !== artistId ||
    !['available', 'empty'].includes(String(value.state)) ||
    !Array.isArray(value.similarArtists) ||
    value.similarArtists.length > 20 ||
    !value.similarArtists.every(
      (item) =>
        record(item) &&
        Object.keys(item).sort().join(',') === 'id,name' &&
        typeof item.id === 'string' &&
        Boolean(item.id) &&
        typeof item.name === 'string' &&
        Boolean(item.name),
    ) ||
    ['biography', 'musicBrainzId', 'coverArtId'].some(
      (key) => value[key] !== undefined && (typeof value[key] !== 'string' || !value[key]),
    )
  )
    throw new ApiError('internal_error');
  return value as unknown as ArtistInfoResponse;
}

export function createArtistInfoClient(fetcher: typeof fetch, apiOrigin = '') {
  return {
    async read(artistId: string, signal: AbortSignal): Promise<ArtistInfoResponse> {
      let response: Response;
      try {
        response = await fetcher(
          `${apiOrigin}/api/v1/music/artists/${encodeURIComponent(artistId)}/info`,
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
            : response.status === 404
              ? 'not_found'
              : 'upstream_unavailable';
        try {
          const body = await response.json();
          if (apiErrorCodes.includes(body?.error?.code)) code = body.error.code;
        } catch {
          // Raw upstream bodies never become UI copy.
        }
        throw new ApiError(code);
      }
      try {
        return decode(await response.json(), artistId);
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError('internal_error');
      }
    },
  };
}
