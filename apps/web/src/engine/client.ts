import {
  apiErrorCodes,
  enginePublicStatuses,
  type EngineActionRequest,
  type EngineStatusResponse,
} from '@musiclatte/contracts';
import { ApiError } from '../auth/client';
export function decodeEngineStatus(value: unknown): EngineStatusResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ApiError('internal_error');
  const v = value as Record<string, unknown>;
  const fields = [
    'schemaVersion',
    'channel',
    'activeVersion',
    'candidateVersion',
    'previousVersion',
    'lastCheckedAt',
    'lastSuccessfulCheckAt',
    'status',
    'recoverability',
  ];
  const version = (value: unknown): value is string | null =>
    value === null ||
    (typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value));
  const instant = (value: unknown): value is number | null =>
    value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
  const status = enginePublicStatuses.find((status) => status === v.status);
  const recoverability = (['available', 'no_previous', 'temporarily_unavailable'] as const).find(
    (state) => state === v.recoverability,
  );
  if (
    Object.keys(v).length !== fields.length ||
    !fields.every((key) => Object.hasOwn(v, key)) ||
    v.schemaVersion !== 1 ||
    v.channel !== 'nightly' ||
    !version(v.activeVersion) ||
    !version(v.candidateVersion) ||
    !version(v.previousVersion) ||
    !instant(v.lastCheckedAt) ||
    !instant(v.lastSuccessfulCheckAt) ||
    !status ||
    !recoverability
  )
    throw new ApiError('internal_error');
  return {
    schemaVersion: 1,
    channel: 'nightly',
    activeVersion: v.activeVersion,
    candidateVersion: v.candidateVersion,
    previousVersion: v.previousVersion,
    lastCheckedAt: v.lastCheckedAt,
    lastSuccessfulCheckAt: v.lastSuccessfulCheckAt,
    status,
    recoverability,
  };
}
export function createEngineClient({
  fetcher = fetch,
  apiOrigin = '',
}: { fetcher?: typeof fetch; apiOrigin?: string } = {}) {
  async function request(
    signal: AbortSignal,
    mutation?: { action: EngineActionRequest['action']; csrfToken: string },
  ) {
    let response: Response;
    try {
      response = await fetcher(`${apiOrigin}/api/v1/engine`, {
        method: mutation ? 'POST' : 'GET',
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
        ...(mutation ? { body: JSON.stringify({ action: mutation.action }) } : {}),
      });
    } catch {
      throw new ApiError('upstream_unavailable');
    }
    if (!response.ok) {
      let code =
        response.status === 401
          ? 'unauthenticated'
          : response.status === 403
            ? 'forbidden'
            : response.status === 409
              ? 'conflict'
              : 'upstream_unavailable';
      if (![401, 403, 409].includes(response.status)) {
        const value = await response.json().catch(() => null);
        code = apiErrorCodes.find((code) => code === value?.error?.code) ?? code;
      }
      throw new ApiError(apiErrorCodes.find((candidate) => candidate === code)!);
    }
    if (response.status !== (mutation ? 202 : 200)) throw new ApiError('internal_error');
    return decodeEngineStatus(
      await response.json().catch(() => {
        throw new ApiError('internal_error');
      }),
    );
  }
  return {
    read: (signal: AbortSignal) => request(signal),
    action: (
      action: EngineActionRequest['action'],
      options: { csrfToken: string; signal: AbortSignal },
    ) => request(options.signal, { action, csrfToken: options.csrfToken }),
  };
}
