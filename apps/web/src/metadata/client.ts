import {
  apiErrorCodes,
  decodeMetadataChanges,
  decodeMetadataIntent,
  decodeMetadataRestorePreview,
  decodeMetadataCoverUpload,
  decodeMetadataJob,
  decodeAutomationJobResponse,
  decodeMetadataPreview,
  decodeMetadataSnapshot,
  type MetadataJobRequest,
  type MetadataPreviewRequest,
} from '@musiclatte/contracts';
import { ApiError } from '../auth/client';
import { metadataRoutes as routes } from './routes';

export interface MetadataMutationOptions {
  csrfToken: string;
  signal?: AbortSignal;
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error('Invalid metadata response');
  return value as Record<string, unknown>;
}
function detail(value: unknown) {
  if (value && typeof value === 'object' && 'admissionResults' in value) {
    const result = decodeAutomationJobResponse(value);
    if (!result.job) throw new Error('Invalid metadata job');
    return result.job;
  }
  const v = object(value, ['schemaVersion', 'job']);
  if (v.schemaVersion !== 1) throw new Error('Invalid metadata response');
  return decodeMetadataJob(v.job);
}
function history(value: unknown) {
  const v = object(value, ['schemaVersion', 'jobs', 'nextCursor']);
  if (
    v.schemaVersion !== 1 ||
    !Array.isArray(v.jobs) ||
    v.jobs.length > 100 ||
    (v.nextCursor !== null &&
      (typeof v.nextCursor !== 'string' || !v.nextCursor || v.nextCursor.length > 8192))
  )
    throw new Error('Invalid metadata response');
  return {
    schemaVersion: 1 as const,
    jobs: v.jobs.map(decodeMetadataJob),
    nextCursor: v.nextCursor as string | null,
  };
}
export function createMetadataClient({
  fetcher = fetch,
  apiOrigin = '',
  isCurrent = () => true,
}: { fetcher?: typeof fetch; apiOrigin?: string; isCurrent?: () => boolean } = {}) {
  let lifecycle = new AbortController();
  async function request<T>(
    path: string,
    decode: (value: unknown) => T,
    signal?: AbortSignal,
    mutation?: { csrfToken: string; body: object | Blob; headers?: Record<string, string> },
  ) {
    const scope = lifecycle.signal;
    const assertCurrent = () => {
      if (scope.aborted || signal?.aborted || !isCurrent())
        throw new DOMException('Obsolete metadata response', 'AbortError');
    };
    assertCurrent();
    let response: Response;
    try {
      response = await fetcher(`${apiOrigin}${path}`, {
        credentials: 'include',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.any([scope, ...(signal ? [signal] : []), AbortSignal.timeout(15000)]),
        headers: {
          Accept: 'application/json',
          ...(mutation
            ? {
                'X-Musiclatte-Client': 'web',
                'X-CSRF-Token': mutation.csrfToken,
                'Content-Type':
                  mutation.body instanceof Blob ? mutation.body.type : 'application/json',
                ...mutation.headers,
              }
            : {}),
        },
        ...(mutation
          ? {
              method: 'POST',
              body: mutation.body instanceof Blob ? mutation.body : JSON.stringify(mutation.body),
            }
          : {}),
      });
    } catch {
      assertCurrent();
      throw new ApiError('upstream_unavailable');
    }
    assertCurrent();
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      assertCurrent();
      throw new ApiError(response.ok ? 'internal_error' : 'upstream_unavailable');
    }
    assertCurrent();
    if (!response.ok) {
      const candidate =
        value && typeof value === 'object' && 'error' in value ? value.error : undefined;
      const code =
        candidate && typeof candidate === 'object' && 'code' in candidate
          ? candidate.code
          : undefined;
      throw new ApiError(
        response.status === 401
          ? 'unauthenticated'
          : response.status === 403
            ? 'forbidden'
            : (apiErrorCodes.find((item) => item === code) ?? 'upstream_unavailable'),
      );
    }
    try {
      return decode(value);
    } catch {
      throw new ApiError('internal_error');
    }
  }
  return {
    invalidate() {
      lifecycle.abort();
      lifecycle = new AbortController();
    },
    read(id: string, signal?: AbortSignal) {
      return request(
        routes.snapshot(id),
        (value) => {
          const snapshot = decodeMetadataSnapshot(value);
          if (
            snapshot.trackId !== id ||
            snapshot.coverFrames.some(
              (frame) => frame.previewUrl !== routes.frame(id, frame.frameId),
            )
          )
            throw new Error();
          return snapshot;
        },
        signal,
      );
    },
    preview(body: MetadataPreviewRequest, options: MetadataMutationOptions) {
      return request(routes.previews, decodeMetadataPreview, options.signal, { ...options, body });
    },
    submit(body: MetadataJobRequest, options: MetadataMutationOptions) {
      return request(routes.jobs, detail, options.signal, { ...options, body });
    },
    list(signal?: AbortSignal, cursor?: string) {
      return request(
        `${routes.jobs}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
        history,
        signal,
      );
    },
    detail(id: string, signal?: AbortSignal) {
      return request(
        routes.job(id),
        (value) => {
          const job = detail(value);
          if (job.id !== id) throw new Error();
          return job;
        },
        signal,
      );
    },
    intent(id: string, itemId: string, signal?: AbortSignal) {
      return request(
        `${routes.job(id)}/items/${encodeURIComponent(itemId)}/intent`,
        decodeMetadataIntent,
        signal,
      );
    },
    restorePreview(id: string, itemId: string, signal?: AbortSignal) {
      return request(
        `${routes.job(id)}/items/${encodeURIComponent(itemId)}/restore-preview`,
        (value) => {
          const preview = decodeMetadataRestorePreview(value);
          if (preview.jobId !== id || preview.itemId !== itemId) throw new Error();
          return preview;
        },
        signal,
      );
    },
    retry(
      id: string,
      body: { operationId: string; items: { itemId: string; expectedRevision: string }[] },
      options: MetadataMutationOptions,
    ) {
      return request(`${routes.job(id)}/retries`, detail, options.signal, { ...options, body });
    },
    recheck(
      id: string,
      body: { operationId: string; itemIds: string[] },
      options: MetadataMutationOptions,
    ) {
      return request(`${routes.job(id)}/rechecks`, detail, options.signal, { ...options, body });
    },
    restore(
      id: string,
      body: { operationId: string; itemId: string; currentExpectedRevision: string },
      options: MetadataMutationOptions,
    ) {
      return request(`${routes.job(id)}/restores`, detail, options.signal, { ...options, body });
    },
    changes(cursor?: string, signal?: AbortSignal) {
      return request(
        `${routes.changes}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
        decodeMetadataChanges,
        signal,
      );
    },
    upload(
      body: Blob,
      options: MetadataMutationOptions & { operationId: string; libraryId: string },
    ) {
      if (
        !['image/jpeg', 'image/png'].includes(body.type) ||
        !body.size ||
        body.size > 8 * 1024 * 1024
      )
        return Promise.reject(new ApiError('invalid_request'));
      return request(
        routes.covers,
        (value) => {
          const upload = decodeMetadataCoverUpload(value);
          if (
            upload.libraryId !== options.libraryId ||
            upload.previewUrl !== routes.upload(upload.uploadId)
          )
            throw new Error();
          return upload;
        },
        options.signal,
        {
          ...options,
          body,
          headers: {
            'X-Operation-Id': options.operationId,
            'X-Metadata-Library-Id': options.libraryId,
          },
        },
      );
    },
  };
}
export type MetadataClient = ReturnType<typeof createMetadataClient>;
