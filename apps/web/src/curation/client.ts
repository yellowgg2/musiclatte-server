import {
  decodeCurationList,
  decodeCurationDetail,
  decodeCurationPolicy,
  curationRecord,
  apiErrorCodes,
} from '@musiclatte/contracts';
import { ApiError } from '../auth/client';
export function createCurationClient({
  fetcher = fetch,
  apiOrigin = '',
}: { fetcher?: typeof fetch; apiOrigin?: string } = {}) {
  async function read<T>(
    path: string,
    decode: (value: unknown) => T,
    signal: AbortSignal,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetcher(`${apiOrigin}/api/v1/${path}`, {
        credentials: 'include',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        headers: { Accept: 'application/json' },
      });
    } catch {
      throw new ApiError('upstream_unavailable');
    }
    if (signal.aborted) throw new DOMException('Obsolete response', 'AbortError');
    if (!response.ok) {
      let code =
        response.status === 401
          ? 'unauthenticated'
          : response.status === 403
            ? 'forbidden'
            : 'upstream_unavailable';
      try {
        const body = await response.json();
        code = apiErrorCodes.find((value) => value === body?.error?.code) ?? code;
      } catch {}
      throw new ApiError(code as ConstructorParameters<typeof ApiError>[0]);
    }
    if (response.status !== 200) throw new ApiError('internal_error');
    try {
      const result = decode(await response.json());
      if (signal.aborted) throw new Error();
      return result;
    } catch {
      throw new ApiError('internal_error');
    }
  }
  return {
    list: (query: URLSearchParams, signal: AbortSignal) =>
      read('tracks?' + query, decodeCurationList, signal),
    detail: (id: string, signal: AbortSignal) =>
      read(`tracks/${encodeURIComponent(id)}/curation`, decodeCurationDetail, signal),
    policy: (signal: AbortSignal) =>
      read(
        'metadata-policy',
        (value) => {
          const r = curationRecord(value, ['schemaVersion', 'policy']);
          if (r.schemaVersion !== 1) throw new Error();
          return decodeCurationPolicy(r.policy);
        },
        signal,
      ),
  };
}
export type CurationClient = ReturnType<typeof createCurationClient>;
