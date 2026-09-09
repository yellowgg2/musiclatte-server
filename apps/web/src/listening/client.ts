import type { ListeningDeliveryStatus, ListeningEventInput } from '@musiclatte/contracts';
export interface ListeningObserverState {
  pending: number;
  failed: number;
  dropped: number;
  lastStatus: ListeningDeliveryStatus | null;
  revision: number;
}
export const initialListeningObserver: ListeningObserverState = {
  pending: 0,
  failed: 0,
  dropped: 0,
  lastStatus: null,
  revision: 0,
};
interface Pending {
  body: string;
  createdAt: number;
  attempts: number;
  controller: AbortController;
  timer?: ReturnType<typeof setTimeout>;
}
/** Tab memory only. Retries concern local receipts, never an upstream resubmission endpoint. */
export function createListeningSender({
  fetcher,
  apiOrigin,
  csrfToken,
  onUnauthenticated,
  onChange = () => {},
  onRecorded = () => {},
  clock = Date.now,
}: {
  fetcher: typeof fetch;
  apiOrigin: string;
  csrfToken: string;
  onUnauthenticated(): void;
  onChange?(state: ListeningObserverState): void;
  onRecorded?(): void;
  clock?: () => number;
}) {
  const pending = new Map<string, Pending>();
  let disposed = false;
  let state = { ...initialListeningObserver };
  const retryDelays = [1000, 3000, 10000];
  function publish() {
    state = { ...state, pending: pending.size };
    if (!disposed) onChange(state);
  }
  function remove(id: string) {
    const item = pending.get(id);
    if (item) {
      if (item.timer) clearTimeout(item.timer);
      item.controller.abort();
      pending.delete(id);
    }
  }
  function prune() {
    for (const [id, item] of pending)
      if (clock() - item.createdAt >= 86400000) {
        remove(id);
        state = { ...state, dropped: state.dropped + 1 };
      }
  }
  function dispose() {
    disposed = true;
    for (const id of pending.keys()) remove(id);
  }
  async function send(id: string, item: Pending) {
    if (disposed || pending.get(id) !== item) return;
    prune();
    if (!pending.has(id)) {
      publish();
      return;
    }
    let terminal = false;
    let recorded: ListeningDeliveryStatus | null = null;
    try {
      const response = await fetcher(`${apiOrigin}/api/v1/listening/events`, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          'X-Musiclatte-Client': 'web',
          'X-CSRF-Token': csrfToken,
          Accept: 'application/json',
        },
        body: item.body,
        signal: AbortSignal.any([item.controller.signal, AbortSignal.timeout(15000)]),
      });
      if (disposed || item.controller.signal.aborted) return;
      if (response.status === 401) {
        dispose();
        onUnauthenticated();
        return;
      }
      terminal = [400, 403, 409].includes(response.status);
      if (response.ok) {
        const body = await response.json();
        if (
          body?.schemaVersion === 1 &&
          ['submitted', 'uncertain', 'skipped'].includes(body?.delivery?.status)
        ) {
          recorded = body.delivery.status;
          terminal = true;
        }
      }
    } catch {
      /* Network and malformed receipt failures use the same frozen local request. */
    }
    if (disposed || item.controller.signal.aborted || pending.get(id) !== item) return;
    if (recorded) {
      remove(id);
      state = { ...state, lastStatus: recorded, revision: state.revision + 1 };
      publish();
      onRecorded();
      return;
    }
    if (terminal || item.attempts >= retryDelays.length) {
      remove(id);
      state = { ...state, failed: state.failed + 1 };
      publish();
      return;
    }
    const delay = retryDelays[item.attempts++]!;
    item.timer = setTimeout(() => void send(id, item), delay);
    publish();
  }
  return {
    enqueue(event: Readonly<ListeningEventInput>) {
      if (disposed || pending.has(event.eventId)) return;
      prune();
      if (clock() - Date.parse(event.startedAt) >= 86400000) {
        state = { ...state, dropped: state.dropped + 1 };
        publish();
        return;
      }
      while (pending.size >= 50) {
        remove(pending.keys().next().value!);
        state = { ...state, dropped: state.dropped + 1 };
      }
      const item: Pending = {
        body: JSON.stringify(event),
        createdAt: Date.parse(event.startedAt),
        attempts: 0,
        controller: new AbortController(),
      };
      pending.set(event.eventId, item);
      publish();
      void send(event.eventId, item);
    },
    snapshot: () => ({ ...state, pending: pending.size }),
    dispose,
  };
}
