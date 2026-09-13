import {
  apiErrorCodes,
  type AccountSummaryResponse,
  type ApiErrorCode,
} from '@musiclatte/contracts';
import { ApiError } from '../auth/client';

function decodeAccountSummary(value: unknown): AccountSummaryResponse {
  if (!value || typeof value !== 'object') throw new ApiError('internal_error');
  const summary = value as Record<string, unknown>;
  if (
    Object.keys(summary).length !== 3 ||
    summary.schemaVersion !== 1 ||
    !Number.isSafeInteger(summary.favoriteSongCount) ||
    Number(summary.favoriteSongCount) < 0 ||
    !Number.isSafeInteger(summary.playlistCount) ||
    Number(summary.playlistCount) < 0
  )
    throw new ApiError('internal_error');
  return {
    schemaVersion: 1,
    favoriteSongCount: Number(summary.favoriteSongCount),
    playlistCount: Number(summary.playlistCount),
  };
}

export function createAccountSummaryClient({
  fetcher = fetch,
  apiOrigin = '',
}: { fetcher?: typeof fetch; apiOrigin?: string } = {}) {
  return {
    async read(signal: AbortSignal): Promise<AccountSummaryResponse> {
      let response: Response;
      try {
        response = await fetcher(`${apiOrigin}/api/v1/account/summary`, {
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
              : 'upstream_unavailable';
        try {
          const value = await response.json();
          if (apiErrorCodes.includes(value?.error?.code)) code = value.error.code;
        } catch {
          /* Never surface an upstream body. */
        }
        throw new ApiError(code);
      }
      try {
        return decodeAccountSummary(await response.json());
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError('internal_error');
      }
    },
  };
}

export type AccountSummaryClient = ReturnType<typeof createAccountSummaryClient>;
