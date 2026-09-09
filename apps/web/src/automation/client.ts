import {
  apiErrorCodes,
  decodeAccessTokenCreated,
  decodeAccessTokenList,
  decodeAccessTokenOptions,
  type AccessTokenRequest,
} from '@musiclatte/contracts';
import { ApiError } from '../auth/client';
export function createAccessTokenClient({
  fetcher = fetch,
  apiOrigin = '',
}: { fetcher?: typeof fetch; apiOrigin?: string } = {}) {
  async function request(
    path: string,
    signal: AbortSignal,
    mutation?: { method: 'POST' | 'DELETE'; csrfToken: string; body: unknown },
  ) {
    let response: Response;
    try {
      response = await fetcher(`${apiOrigin}/api/v1/access-tokens${path}`, {
        method: mutation?.method ?? 'GET',
        credentials: 'include',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
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
        ...(mutation ? { body: JSON.stringify(mutation.body) } : {}),
      });
    } catch {
      throw new ApiError(mutation ? 'outcome_unknown' : 'upstream_unavailable');
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const fallback =
        response.status === 401
          ? 'unauthenticated'
          : response.status === 403
            ? 'forbidden'
            : 'upstream_unavailable';
      throw new ApiError(apiErrorCodes.find((code) => code === body?.error?.code) ?? fallback);
    }
    const expected = mutation?.method === 'POST' ? 201 : mutation ? 204 : 200;
    if (response.status !== expected)
      throw new ApiError(mutation?.method === 'POST' ? 'outcome_unknown' : 'internal_error');
    if (expected === 204) return undefined;
    try {
      return await response.json();
    } catch {
      throw new ApiError(mutation?.method === 'POST' ? 'outcome_unknown' : 'internal_error');
    }
  }
  return {
    async options(signal: AbortSignal) {
      try {
        return decodeAccessTokenOptions(await request('/options', signal));
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError('internal_error');
      }
    },
    async list(signal: AbortSignal, cursor?: string) {
      try {
        return decodeAccessTokenList(
          await request(cursor ? '?cursor=' + encodeURIComponent(cursor) : '', signal),
        );
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError('internal_error');
      }
    },
    async create(body: AccessTokenRequest, csrfToken: string, signal: AbortSignal) {
      const response = await request('', signal, { method: 'POST', csrfToken, body });
      try {
        return decodeAccessTokenCreated(response);
      } catch {
        throw new ApiError('outcome_unknown');
      }
    },
    async revoke(id: string, csrfToken: string, signal: AbortSignal) {
      await request('/' + encodeURIComponent(id), signal, {
        method: 'DELETE',
        csrfToken,
        body: {},
      });
    },
  };
}
