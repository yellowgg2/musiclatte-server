import {
  apiErrorCodes,
  importFailureCodes,
  importStages,
  type ImportJob,
  type ImportItem,
  type ImportListResponse,
  type ImportDetailResponse,
  type ImportCreateRequest,
  type ImportRetryRequest,
} from '@musiclatte/contracts';
import { ApiError } from '../auth/client';

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  return (
    required.every((key) => key in value) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  );
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function id(value: unknown): value is string {
  return text(value) && value.length <= 1024 && /^[A-Za-z0-9_.:-]+$/.test(value);
}
function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function item(value: unknown): value is ImportItem {
  return (
    record(value) &&
    keys(
      value,
      ['id', 'sourceId', 'stage'],
      ['title', 'channel', 'failureCode', 'mediaLinkId', 'duplicate'],
    ) &&
    id(value.id) &&
    typeof value.sourceId === 'string' &&
    /^[A-Za-z0-9_-]{11}$/.test(value.sourceId) &&
    importStages.some((stage) => stage === value.stage) &&
    ['title', 'channel'].every((key) => !(key in value) || text(value[key])) &&
    (!('failureCode' in value) || importFailureCodes.some((code) => code === value.failureCode)) &&
    (!('mediaLinkId' in value) || id(value.mediaLinkId)) &&
    (value.stage !== 'ready' || id(value.mediaLinkId)) &&
    (!('duplicate' in value) ||
      (record(value.duplicate) &&
        keys(value.duplicate, ['kind', 'id']) &&
        ['item', 'media'].includes(String(value.duplicate.kind)) &&
        id(value.duplicate.id)))
  );
}
function job(value: unknown): value is ImportJob {
  return (
    record(value) &&
    keys(value, [
      'id',
      'libraryId',
      'createdAt',
      'cancelRequestedAt',
      'retryOfJobId',
      'status',
      'items',
    ]) &&
    id(value.id) &&
    text(value.libraryId) &&
    timestamp(value.createdAt) &&
    (value.cancelRequestedAt === null || timestamp(value.cancelRequestedAt)) &&
    (value.retryOfJobId === null || id(value.retryOfJobId)) &&
    ['queued', 'running', 'completed', 'partial', 'failed', 'cancelled'].includes(
      String(value.status),
    ) &&
    Array.isArray(value.items) &&
    value.items.every(item) &&
    new Set(value.items.map((i) => i.id)).size === value.items.length
  );
}
export function decodeImportDetail(value: unknown): ImportDetailResponse {
  if (
    !record(value) ||
    !keys(value, ['schemaVersion', 'job']) ||
    value.schemaVersion !== 1 ||
    !job(value.job)
  )
    throw new ApiError('internal_error');
  return { schemaVersion: 1, job: value.job };
}
export function decodeImportList(value: unknown): ImportListResponse {
  if (
    !record(value) ||
    !keys(value, ['schemaVersion', 'jobs', 'libraries', 'nextCursor']) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.jobs) ||
    !value.jobs.every(job) ||
    !Array.isArray(value.libraries) ||
    !value.libraries.every((l) => record(l) && keys(l, ['id']) && text(l.id)) ||
    !(value.nextCursor === null || text(value.nextCursor))
  )
    throw new ApiError('internal_error');
  return {
    schemaVersion: 1,
    jobs: value.jobs,
    libraries: value.libraries.map((l) => ({ id: l.id as string })),
    nextCursor: value.nextCursor,
  };
}
type MutationOptions = { csrfToken: string; signal: AbortSignal };
export function createImportClient({
  fetcher = fetch,
  apiOrigin = '',
}: { fetcher?: typeof fetch; apiOrigin?: string } = {}) {
  async function request(
    path: string,
    signal: AbortSignal,
    mutation?: { method: 'POST' | 'DELETE'; csrfToken: string; body?: object },
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(`${apiOrigin}/api/v1/imports${path}`, {
        credentials: 'include',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        headers: {
          Accept: 'application/json',
          ...(mutation
            ? {
                'X-Musiclatte-Client': 'web',
                'X-CSRF-Token': mutation.csrfToken,
                ...(mutation.body ? { 'Content-Type': 'application/json' } : {}),
              }
            : {}),
        },
        ...(mutation
          ? {
              method: mutation.method,
              ...(mutation.body ? { body: JSON.stringify(mutation.body) } : {}),
            }
          : {}),
      });
    } catch {
      throw new ApiError('upstream_unavailable');
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new ApiError(response.ok ? 'internal_error' : 'upstream_unavailable');
    }
    if (!response.ok) {
      const candidate = record(value) && record(value.error) ? value.error.code : undefined;
      const code = apiErrorCodes.find((code) => code === candidate);
      throw new ApiError(
        response.status === 401
          ? 'unauthenticated'
          : response.status === 403
            ? 'forbidden'
            : (code ?? 'upstream_unavailable'),
      );
    }
    return value;
  }
  return {
    async list(signal: AbortSignal, cursor?: string) {
      return decodeImportList(
        await request(cursor ? `?cursor=${encodeURIComponent(cursor)}` : '', signal),
      );
    },
    async detail(id: string, signal: AbortSignal) {
      return decodeImportDetail(await request(`/${encodeURIComponent(id)}`, signal));
    },
    async create(body: ImportCreateRequest, { csrfToken, signal }: MutationOptions) {
      return decodeImportDetail(await request('', signal, { method: 'POST', csrfToken, body }));
    },
    async retry(id: string, body: ImportRetryRequest, { csrfToken, signal }: MutationOptions) {
      return decodeImportDetail(
        await request(`/${encodeURIComponent(id)}/retries`, signal, {
          method: 'POST',
          csrfToken,
          body,
        }),
      );
    },
    async cancel(id: string, { csrfToken, signal }: MutationOptions) {
      return decodeImportDetail(
        await request(`/${encodeURIComponent(id)}`, signal, { method: 'DELETE', csrfToken }),
      );
    },
  };
}
