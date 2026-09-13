import type {
  OrganizationStatusItem,
  OrganizationStatusResponse,
  OrganizationStatusTarget,
} from '@musiclatte/contracts';
import { ApiError } from '../auth/client';

export type OrganizationStateView =
  | { phase: 'loading' }
  | { phase: 'ready'; value: OrganizationStatusItem }
  | { phase: 'error'; retry(): void };

interface Entry {
  view: OrganizationStateView;
  listeners: Set<() => void>;
  subscribers: number;
  updatedAt: number;
  lastUsedAt: number;
}

const loading: OrganizationStateView = { phase: 'loading' };
const chunkSize = 100;

/** One provider-scoped registrar owns batching, cache retention, and late-response fencing. */
export function createOrganizationStateStore({
  load,
  onUnauthenticated,
  now = Date.now,
  staleMs = 30_000,
  retainMs = 60_000,
  maxEntries = 1_000,
}: {
  load(
    targets: Extract<OrganizationStatusTarget, { kind: 'track' }>[],
    signal: AbortSignal,
  ): Promise<OrganizationStatusResponse>;
  onUnauthenticated(): void;
  now?: () => number;
  staleMs?: number;
  retainMs?: number;
  maxEntries?: number;
}) {
  const entries = new Map<string, Entry>();
  const queued = new Set<string>();
  const active = new Set<AbortController>();
  let batchTimer: ReturnType<typeof setTimeout> | undefined;
  let staleTimer: ReturnType<typeof setTimeout> | undefined;
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  let visible = true;
  let generation = 0;
  let disposed = false;

  function entry(trackId: string) {
    let current = entries.get(trackId);
    if (!current) {
      current = {
        view: loading,
        listeners: new Set(),
        subscribers: 0,
        updatedAt: 0,
        lastUsedAt: now(),
      };
      entries.set(trackId, current);
    }
    current.lastUsedAt = now();
    return current;
  }

  function notify(current: Entry) {
    current.listeners.forEach((listener) => listener());
  }

  function prune() {
    const threshold = now() - retainMs;
    for (const [trackId, current] of entries)
      if (current.subscribers === 0 && current.lastUsedAt <= threshold) entries.delete(trackId);
    if (entries.size <= maxEntries) return;
    const removable = [...entries]
      .filter(([, current]) => current.subscribers === 0)
      .sort(([, left], [, right]) => left.lastUsedAt - right.lastUsedAt);
    for (const [trackId] of removable) {
      if (entries.size <= maxEntries) break;
      entries.delete(trackId);
    }
  }

  function scheduleCleanup() {
    clearTimeout(cleanupTimer);
    cleanupTimer = setTimeout(() => {
      cleanupTimer = undefined;
      prune();
    }, retainMs);
  }

  function scheduleStale() {
    clearTimeout(staleTimer);
    staleTimer = undefined;
    if (!visible || disposed) return;
    const timestamps = [...entries.values()]
      .filter((current) => current.subscribers > 0 && current.updatedAt > 0)
      .map((current) => current.updatedAt);
    if (!timestamps.length) return;
    const delay = Math.max(0, Math.min(...timestamps) + staleMs - now());
    staleTimer = setTimeout(() => {
      staleTimer = undefined;
      for (const [trackId, current] of entries)
        if (current.subscribers > 0 && now() - current.updatedAt >= staleMs) queue(trackId);
      scheduleStale();
    }, delay);
  }

  function fail(trackIds: readonly string[], error: unknown) {
    if (error instanceof ApiError && error.code === 'unauthenticated') onUnauthenticated();
    for (const trackId of trackIds) {
      const current = entries.get(trackId);
      if (!current || current.subscribers === 0) continue;
      current.view = { phase: 'error', retry: () => refresh(trackId) };
      current.updatedAt = now();
      notify(current);
    }
  }

  async function run(trackIds: string[], requestGeneration: number) {
    const controller = new AbortController();
    active.add(controller);
    try {
      const response = await load(
        trackIds.map((trackId) => ({ kind: 'track', trackId })),
        controller.signal,
      );
      if (disposed || controller.signal.aborted || requestGeneration !== generation) return;
      const results = new Map<string, OrganizationStatusItem>();
      for (const item of response.items) {
        if (item.target.kind !== 'track' || results.has(item.target.trackId))
          throw new Error('Invalid organization status batch');
        results.set(item.target.trackId, item);
      }
      if (results.size !== trackIds.length || trackIds.some((trackId) => !results.has(trackId)))
        throw new Error('Invalid organization status batch');
      for (const trackId of trackIds) {
        const current = entries.get(trackId);
        if (!current || current.subscribers === 0) continue;
        current.view = { phase: 'ready', value: results.get(trackId)! };
        current.updatedAt = now();
        current.lastUsedAt = now();
        notify(current);
      }
      scheduleStale();
      prune();
    } catch (error) {
      if (disposed || controller.signal.aborted || requestGeneration !== generation) return;
      fail(trackIds, error);
    } finally {
      active.delete(controller);
    }
  }

  function flush() {
    batchTimer = undefined;
    if (!visible || disposed) return;
    const trackIds = [...queued].filter((trackId) => (entries.get(trackId)?.subscribers ?? 0) > 0);
    queued.clear();
    for (let index = 0; index < trackIds.length; index += chunkSize)
      void run(trackIds.slice(index, index + chunkSize), generation);
  }

  function queue(trackId: string) {
    if (disposed) return;
    queued.add(trackId);
    const current = entries.get(trackId);
    if (current && current.view.phase !== 'loading') {
      current.view = loading;
      notify(current);
    }
    if (visible && !batchTimer) batchTimer = setTimeout(flush, 0);
  }

  function refresh(trackId?: string) {
    if (trackId) {
      const current = entries.get(trackId);
      if (current?.subscribers) queue(trackId);
      return;
    }
    for (const [id, current] of entries) if (current.subscribers > 0) queue(id);
  }

  return {
    getSnapshot(trackId: string) {
      return entries.get(trackId)?.view ?? loading;
    },
    subscribe(trackId: string, listener: () => void) {
      const current = entry(trackId);
      current.subscribers++;
      current.listeners.add(listener);
      if (current.view.phase === 'loading' || now() - current.updatedAt >= staleMs) queue(trackId);
      return () => {
        const latest = entries.get(trackId);
        if (!latest) return;
        latest.listeners.delete(listener);
        latest.subscribers = Math.max(0, latest.subscribers - 1);
        latest.lastUsedAt = now();
        if (latest.subscribers === 0) queued.delete(trackId);
        scheduleCleanup();
      };
    },
    refresh,
    setVisible(next: boolean) {
      if (visible === next || disposed) return;
      visible = next;
      if (!visible) {
        clearTimeout(batchTimer);
        batchTimer = undefined;
        clearTimeout(staleTimer);
        staleTimer = undefined;
        generation++;
        active.forEach((controller) => controller.abort());
        active.clear();
        return;
      }
      refresh();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      clearTimeout(batchTimer);
      clearTimeout(staleTimer);
      clearTimeout(cleanupTimer);
      active.forEach((controller) => controller.abort());
      active.clear();
      queued.clear();
      entries.clear();
    },
  };
}

export type OrganizationStateStore = ReturnType<typeof createOrganizationStateStore>;
