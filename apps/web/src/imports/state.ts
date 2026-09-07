import type {
  ApiErrorCode,
  ImportCreateRequest,
  ImportJob,
  ImportListResponse,
  ImportRetryRequest,
} from '@musiclatte/contracts';
import { errorCode } from '../auth/client';
import { newPlaylistOperationId } from '../playlists/operation-id';
import type { createImportClient } from './client';

type Pending =
  | { kind: 'create'; body: ImportCreateRequest }
  | { kind: 'retry'; id: string; body: ImportRetryRequest }
  | { kind: 'cancel'; id: string };
export interface ImportState {
  jobs: ImportJob[];
  libraries: ImportListResponse['libraries'];
  nextCursor: string | null;
  loading: boolean;
  busy: boolean;
  error: ApiErrorCode | null;
  requestError: ApiErrorCode | null;
  pending: Pending | null;
  resultId: string | null;
  resultKind: Pending['kind'] | null;
  revision: number;
}
export function activeImport(job: ImportJob) {
  return (
    job.status === 'queued' ||
    job.status === 'running' ||
    job.items.some((item) =>
      [
        'queued',
        'resolving',
        'downloading',
        'postprocessing',
        'publishing',
        'registering',
      ].includes(item.stage),
    )
  );
}
/** Owns only this route/account lifetime; stale reads cannot overwrite mutation results. */
export function createImportStore(
  client: ReturnType<typeof createImportClient>,
  csrfToken: string,
  onUnauthenticated: () => void,
) {
  let state: ImportState = {
    jobs: [],
    libraries: [],
    nextCursor: null,
    loading: true,
    busy: false,
    error: null,
    requestError: null,
    pending: null,
    resultId: null,
    resultKind: null,
    revision: 0,
  };
  const listeners = new Set<() => void>();
  let disposed = false;
  let started = false;
  let focused = true;
  let failures = 0;
  let paged = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let read: AbortController | undefined;
  let write: AbortController | undefined;
  const update = (patch: Partial<ImportState>) => {
    if (disposed) return;
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn());
  };
  const visible = () => focused && document.visibilityState !== 'hidden' && navigator.onLine;
  const invalidate = () => {
    generation++;
    read?.abort();
    clearTimeout(timer);
  };
  function schedule() {
    clearTimeout(timer);
    if (disposed || !visible() || state.busy || failures >= 3) return;
    if (failures || state.jobs.some(activeImport))
      timer = setTimeout(() => void refresh(false), failures ? 2000 * 2 ** failures : 2000);
  }
  function failed(error: unknown) {
    const code = errorCode(error);
    if (code === 'unauthenticated') onUnauthenticated();
    return code;
  }
  async function refresh(manual = true, cursor?: string) {
    if (disposed || !visible() || state.busy) return;
    if (manual) failures = 0;
    invalidate();
    const version = generation;
    read = new AbortController();
    const signal = read.signal;
    try {
      const data = await client.list(signal, cursor);
      if (disposed || signal.aborted || version !== generation) return;
      const merged = new Map(state.jobs.map((j) => [j.id, j]));
      data.jobs.forEach((j) => merged.set(j.id, j));
      // Older loaded active jobs may be beyond the first history page.
      if (!cursor)
        for (const previous of state.jobs.filter(
          (j) => activeImport(j) && !data.jobs.some((n) => n.id === j.id),
        )) {
          const detail = await client.detail(previous.id, signal);
          merged.set(detail.job.id, detail.job);
        }
      if (disposed || signal.aborted || version !== generation) return;
      for (const child of data.jobs) {
        if (child.retryOfJobId && !merged.has(child.retryOfJobId)) {
          const original = await client.detail(child.retryOfJobId, signal);
          if (disposed || signal.aborted || version !== generation) return;
          merged.set(original.job.id, original.job);
        }
      }
      if (cursor) paged = true;
      failures = 0;
      update({
        jobs: [...merged.values()].sort((a, b) => b.createdAt - a.createdAt),
        libraries: data.libraries,
        nextCursor: cursor || !paged ? data.nextCursor : state.nextCursor,
        loading: false,
        error: null,
      });
    } catch (error) {
      if (disposed || signal.aborted || version !== generation) return;
      failures++;
      update({ loading: false, error: failed(error) });
    }
    schedule();
  }
  async function execute(pending: Pending) {
    if (disposed || state.busy) return;
    invalidate();
    write = new AbortController();
    const signal = write.signal;
    update({ busy: true, pending, requestError: null });
    try {
      const options = { csrfToken, signal };
      const data =
        pending.kind === 'create'
          ? await client.create(pending.body, options)
          : pending.kind === 'retry'
            ? await client.retry(pending.id, pending.body, options)
            : await client.cancel(pending.id, options);
      if (disposed || signal.aborted) return;
      update({
        jobs: [data.job, ...state.jobs.filter((j) => j.id !== data.job.id)],
        busy: false,
        pending: null,
        requestError: null,
        resultId: data.job.id,
        resultKind: pending.kind,
        revision: state.revision + 1,
      });
      failures = 0;
    } catch (error) {
      if (disposed || signal.aborted) return;
      update({ busy: false, requestError: failed(error) });
    }
    schedule();
  }
  const pause = () => {
    focused = false;
    invalidate();
  };
  const resume = () => {
    focused = true;
    void refresh();
  };
  const visibility = () => {
    if (document.visibilityState === 'hidden') invalidate();
    else if (focused) void refresh();
  };
  const offline = () => {
    invalidate();
    update({ loading: false, error: 'upstream_unavailable' });
  };
  return {
    getSnapshot: () => state,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    start() {
      disposed = false;
      if (started) return;
      started = true;
      window.addEventListener('blur', pause);
      window.addEventListener('focus', resume);
      window.addEventListener('offline', offline);
      window.addEventListener('online', resume);
      document.addEventListener('visibilitychange', visibility);
      void refresh();
    },
    refresh: () => refresh(),
    more: () => (state.nextCursor ? refresh(true, state.nextCursor) : Promise.resolve()),
    create(libraryId: string, urls: string[]) {
      if (state.pending) return;
      return execute({
        kind: 'create',
        body: { libraryId, urls, operationId: newPlaylistOperationId() },
      });
    },
    retry(id: string, itemId: string) {
      if (
        state.pending ||
        !state.jobs
          .find((j) => j.id === id)
          ?.items.some((i) => i.id === itemId && i.stage === 'failed')
      )
        return;
      return execute({
        kind: 'retry',
        id,
        body: { operationId: newPlaylistOperationId(), itemIds: [itemId] },
      });
    },
    cancel(id: string) {
      if (state.pending) return;
      return execute({ kind: 'cancel', id });
    },
    retryRequest: () => (state.pending ? execute(state.pending) : Promise.resolve()),
    discardRequest() {
      if (!state.busy) update({ pending: null, requestError: null });
    },
    dispose() {
      disposed = true;
      started = false;
      invalidate();
      write?.abort();
      window.removeEventListener('blur', pause);
      window.removeEventListener('focus', resume);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', visibility);
    },
  };
}
