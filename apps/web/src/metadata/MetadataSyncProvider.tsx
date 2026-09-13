import { createCurationClient, type CurationClient } from '../curation/client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { mediaRoutes } from '@musiclatte/contracts';
import { createMetadataClient, type MetadataClient } from './client';
import { createMetadataSyncStore, initialMetadataState, type MetadataSyncState } from './state';
import { metadataRoutes } from './routes';
import {
  createOrganizationStateStore,
  type OrganizationStateStore,
} from './organization-state-store';

interface MetadataContextValue {
  state: MetadataSyncState;
  client?: MetadataClient;
  curationClient?: CurationClient;
  coverUrl(id: string): string;
  refresh(): void;
  organizationStore?: OrganizationStateStore;
  refreshOrganization(trackId?: string): void;
}
const MetadataContext = createContext<MetadataContextValue>({
  state: initialMetadataState,
  coverUrl: mediaRoutes.cover,
  refresh: () => undefined,
  refreshOrganization: () => undefined,
});
const unavailableOrganizationState = { phase: 'loading' } as const;
export function MetadataSyncProvider({
  children,
  scope,
  enabled,
  fetcher,
  apiOrigin,
  csrfToken,
  onUnauthenticated,
}: {
  children: ReactNode;
  scope: string;
  enabled: boolean;
  fetcher: typeof fetch;
  apiOrigin: string;
  csrfToken: string;
  onUnauthenticated: () => void;
}) {
  const current = useRef({ scope, active: true });
  current.current.scope = scope;
  const client = useMemo(
    () =>
      createMetadataClient({
        fetcher,
        apiOrigin,
        isCurrent: () => current.current.active && current.current.scope === scope,
      }),
    [scope, fetcher, apiOrigin],
  );
  const curationClient = useMemo(
    () => createCurationClient({ fetcher, apiOrigin }),
    [scope, fetcher, apiOrigin],
  );
  const store = useMemo(
    () => createMetadataSyncStore({ client, onUnauthenticated }),
    [client, onUnauthenticated],
  );
  const organizationStore = useMemo(
    () =>
      createOrganizationStateStore({
        load: (targets, signal) => client.organizationStatuses(targets, { csrfToken, signal }),
        onUnauthenticated,
      }),
    [client, csrfToken, onUnauthenticated],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useLayoutEffect(() => {
    current.current.active = true;
    return () => {
      current.current.active = false;
    };
  }, [client]);
  useEffect(() => {
    const visibility = () => {
      const visible = document.visibilityState === 'visible';
      store.setVisible(visible);
      organizationStore.setVisible(visible);
    };
    const connectivity = () => store.setOnline(navigator.onLine);
    visibility();
    connectivity();
    if (enabled) store.start();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('online', connectivity);
    window.addEventListener('offline', connectivity);
    return () => {
      store.stop();
      organizationStore.dispose();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('online', connectivity);
      window.removeEventListener('offline', connectivity);
    };
  }, [store, organizationStore, enabled]);
  useEffect(() => {
    if (!state.statusVersion) return;
    const trackIds = new Set<string>();
    for (const change of state.latest.values()) {
      trackIds.add(change.oldTrackId);
      trackIds.add(change.newTrackId);
    }
    trackIds.forEach((trackId) => organizationStore.refresh(trackId));
  }, [state.statusVersion, state.latest, organizationStore]);
  const coverUrl = useCallback(
    (id: string) => {
      const generation = state.coverVersions.get(id);
      const route = generation ? metadataRoutes.cover(id, generation) : mediaRoutes.cover(id);
      return `${apiOrigin}${route}`;
    },
    [apiOrigin, state.coverVersions],
  );
  const value = useMemo(
    () => ({
      state,
      client,
      curationClient,
      coverUrl,
      refresh: store.refresh,
      organizationStore,
      refreshOrganization: organizationStore.refresh,
    }),
    [state, client, curationClient, coverUrl, store, organizationStore],
  );
  return <MetadataContext.Provider value={value}>{children}</MetadataContext.Provider>;
}
export function useMetadataSync() {
  return useContext(MetadataContext);
}

export function useOrganizationState(trackId: string, enabled = true) {
  const { organizationStore } = useContext(MetadataContext);
  const subscribe = useCallback(
    (listener: () => void) =>
      enabled
        ? (organizationStore?.subscribe(trackId, listener) ?? (() => undefined))
        : () => undefined,
    [enabled, organizationStore, trackId],
  );
  const snapshot = useCallback(
    () =>
      enabled
        ? (organizationStore?.getSnapshot(trackId) ?? unavailableOrganizationState)
        : unavailableOrganizationState,
    [enabled, organizationStore, trackId],
  );
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
