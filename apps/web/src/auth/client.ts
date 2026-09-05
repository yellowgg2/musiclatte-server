import {
  apiErrorCodes,
  decodeCapabilities,
  type ApiErrorCode,
  type SessionResponse,
} from '@musiclatte/contracts';
export type CookieSession = SessionResponse & { authScheme: 'cookie'; csrfToken: string };
export class ApiError extends Error {
  constructor(public readonly code: ApiErrorCode) {
    super(code);
  }
}
export function errorCode(error: unknown): ApiErrorCode {
  return error instanceof ApiError ? error.code : 'upstream_unavailable';
}
function decodeSession(value: unknown): CookieSession {
  if (!value || typeof value !== 'object') throw new ApiError('internal_error');
  const v = value as Record<string, unknown>;
  if (
    v.schemaVersion !== 1 ||
    v.authScheme !== 'cookie' ||
    typeof v.username !== 'string' ||
    !v.username ||
    typeof v.csrfToken !== 'string' ||
    !v.csrfToken ||
    typeof v.expiresAt !== 'number' ||
    !Number.isSafeInteger(v.expiresAt) ||
    v.expiresAt <= 0 ||
    'accessToken' in v
  )
    throw new ApiError('internal_error');
  return {
    schemaVersion: 1,
    username: v.username,
    authScheme: 'cookie',
    csrfToken: v.csrfToken,
    expiresAt: v.expiresAt,
  };
}
export function createSessionClient({
  fetcher = fetch,
  apiOrigin = '',
}: { fetcher?: typeof fetch; apiOrigin?: string } = {}) {
  async function request(
    path: string,
    method = 'GET',
    body?: object,
    csrf?: string,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(`${apiOrigin}/api/v1/${path}`, {
        method,
        credentials: 'include',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: {
          Accept: 'application/json',
          ...(method !== 'GET'
            ? { 'Content-Type': 'application/json', 'X-Musiclatte-Client': 'web' }
            : {}),
          ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
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
        /* Never display upstream bodies. */
      }
      throw new ApiError(code);
    }
    if (response.status === 204) return undefined;
    try {
      return await response.json();
    } catch {
      throw new ApiError('internal_error');
    }
  }
  return {
    read: async () => decodeSession(await request('session')),
    login: async (username: string, password: string, csrf?: string) =>
      decodeSession(
        await request('session', 'POST', { kind: 'password', username, password }, csrf),
      ),
    logout: async (csrf?: string) => {
      await request('session', 'DELETE', {}, csrf);
    },
    capabilities: async () => {
      try {
        return decodeCapabilities(await request('capabilities'));
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError('internal_error');
      }
    },
  };
}
export type SessionClient = ReturnType<typeof createSessionClient>;
