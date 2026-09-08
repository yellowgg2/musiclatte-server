import { isScanSettings, type ScanSettingsRequest } from '@musiclatte/contracts';
import { ApiError } from '../auth/client';
export function createScanClient(fetcher: typeof fetch, apiOrigin: string) {
  async function request(
    path: string,
    signal: AbortSignal,
    mutation?: { method: string; body: unknown; csrfToken: string },
  ) {
    let r: Response;
    try {
      r = await fetcher(`${apiOrigin}/api/v1/scan${path}`, {
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
      throw new ApiError('upstream_unavailable');
    }
    if (!r.ok)
      throw new ApiError(
        r.status === 401
          ? 'unauthenticated'
          : r.status === 403
            ? 'forbidden'
            : 'upstream_unavailable',
      );
    return r.json();
  }
  return {
    async settings(signal: AbortSignal) {
      const value = await request('/schedule', signal);
      if (!isScanSettings(value)) throw new ApiError('internal_error');
      return value;
    },
    async save(body: ScanSettingsRequest, csrfToken: string, signal: AbortSignal) {
      const value = await request('/schedule', signal, { method: 'PUT', body, csrfToken });
      if (!isScanSettings(value)) throw new ApiError('internal_error');
      return value;
    },
    async status(signal: AbortSignal) {
      const value = await request('', signal);
      if (value?.schemaVersion !== 1 || typeof value.scanning !== 'boolean')
        throw new ApiError('internal_error');
      return value.scanning as boolean;
    },
    async start(csrfToken: string, signal: AbortSignal) {
      const value = await request('', signal, { method: 'POST', body: {}, csrfToken });
      if (value?.schemaVersion !== 1 || value.accepted !== true)
        throw new ApiError('internal_error');
    },
  };
}
