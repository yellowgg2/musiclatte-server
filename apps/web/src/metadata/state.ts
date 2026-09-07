import type { MetadataChange, MetadataChangesPage } from '@musiclatte/contracts';
import { ApiError } from '../auth/client';
import type { MetadataClient } from './client';

export interface MetadataSyncState {
  version: number;
  statusVersion: number;
  latest: ReadonlyMap<string, MetadataChange>;
  coverVersions: ReadonlyMap<string, string>;
  trackVersions: ReadonlyMap<string, number>;
}
export const initialMetadataState: MetadataSyncState = {
  version: 0,
  statusVersion: 0,
  latest: new Map(),
  coverVersions: new Map(),
  trackVersions: new Map(),
};
export function applyMetadataChanges(
  state: MetadataSyncState,
  page: MetadataChangesPage,
): MetadataSyncState {
  const latest = new Map(state.latest);
  const covers = new Map(state.coverVersions);
  const tracks = new Map(state.trackVersions);
  let statusChanged = false;
  let verifiedChanged = false;
  for (const change of page.changes) {
    const previous = latest.get(change.oldTrackId);
    if (previous && previous.sequence >= change.sequence) continue;
    latest.set(change.oldTrackId, change);
    statusChanged = true;
    if (
      change.reflection !== 'verified' ||
      change.oldTrackId !== change.newTrackId ||
      (previous?.reflection === 'verified' && previous.newRevision === change.newRevision)
    )
      continue;
    verifiedChanged = true;
    for (const id of new Set([change.newTrackId, ...change.relatedIds.trackIds]))
      tracks.set(id, change.sequence);
    for (const id of change.relatedIds.coverIds) covers.set(id, change.coverGeneration);
  }
  return statusChanged
    ? {
        version: state.version + Number(verifiedChanged),
        statusVersion: state.statusVersion + 1,
        latest,
        coverVersions: covers,
        trackVersions: tracks,
      }
    : state;
}

/** Polling owns one cursor and one request per account/instance/policy generation. */
export function createMetadataSyncStore({
  client,
  onUnauthenticated,
}: {
  client: Pick<MetadataClient, 'changes' | 'invalidate'>;
  onUnauthenticated: () => void;
}) {
  let state = initialMetadataState;
  let cursor: string | undefined;
  let started = false;
  let visible = true;
  let online = true;
  let failures = 0;
  let lifecycle = 0;
  let active: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let refreshPending = false;
  const listeners = new Set<() => void>();
  const backoff = () => [3000, 6000, 12000, 30000][Math.min(Math.max(0, failures - 1), 3)]!;
  function cancel() {
    lifecycle++;
    clearTimeout(timer);
    timer = undefined;
    active?.abort();
    active = undefined;
  }
  function schedule(ms: number) {
    clearTimeout(timer);
    if (started && visible) timer = setTimeout(() => void poll(), ms);
  }
  async function poll() {
    if (!started || !visible || active) return;
    if (!online) {
      failures++;
      schedule(backoff());
      return;
    }
    const generation = lifecycle;
    const controller = new AbortController();
    active = controller;
    let wait = 3000;
    try {
      const page = await client.changes(cursor, controller.signal);
      if (controller.signal.aborted || generation !== lifecycle) return;
      const next = applyMetadataChanges(state, page);
      cursor = page.nextCursor;
      failures = 0;
      if (next !== state) {
        state = next;
        listeners.forEach((listener) => listener());
      }
      wait = page.hasMore ? 0 : 3000;
    } catch (error) {
      if (controller.signal.aborted || generation !== lifecycle) return;
      if (error instanceof ApiError && error.code === 'unauthenticated') {
        stop();
        onUnauthenticated();
        return;
      }
      if (error instanceof ApiError && error.code === 'invalid_request' && cursor)
        cursor = undefined;
      failures++;
      wait = backoff();
    } finally {
      if (active === controller) active = undefined;
      if (generation === lifecycle) {
        schedule(refreshPending ? 0 : wait);
        refreshPending = false;
      }
    }
  }
  function stop() {
    started = false;
    cancel();
    client.invalidate();
  }
  function refresh() {
    if (active) refreshPending = true;
    else schedule(0);
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (started) return;
      started = true;
      schedule(0);
    },
    stop,
    refresh,
    setVisible(next: boolean) {
      if (visible === next) return;
      visible = next;
      cancel();
      if (next) refresh();
    },
    setOnline(next: boolean) {
      if (online === next) return;
      online = next;
      cancel();
      if (next) failures = 0;
      refresh();
    },
  };
}
