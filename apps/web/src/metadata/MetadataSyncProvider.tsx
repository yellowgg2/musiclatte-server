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

interface MetadataContextValue {
  state: MetadataSyncState;
  client?: MetadataClient;
  coverUrl(id: string): string;
  refresh(): void;
}
const MetadataContext = createContext<MetadataContextValue>({
  state: initialMetadataState,
  coverUrl: mediaRoutes.cover,
  refresh: () => undefined,
});
export function MetadataSyncProvider({
  children,
  scope,
  enabled,
  fetcher,
  apiOrigin,
  onUnauthenticated,
}: {
  children: ReactNode;
  scope: string;
  enabled: boolean;
  fetcher: typeof fetch;
  apiOrigin: string;
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
  const store = useMemo(
    () => createMetadataSyncStore({ client, onUnauthenticated }),
    [client, onUnauthenticated],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useLayoutEffect(() => {
    current.current.active = true;
    return () => {
      current.current.active = false;
    };
  }, [client]);
  useEffect(() => {
    const visibility = () => store.setVisible(document.visibilityState === 'visible');
    const connectivity = () => store.setOnline(navigator.onLine);
    visibility();
    connectivity();
    if (enabled) store.start();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('online', connectivity);
    window.addEventListener('offline', connectivity);
    return () => {
      store.stop();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('online', connectivity);
      window.removeEventListener('offline', connectivity);
    };
  }, [store, enabled]);
  const coverUrl = useCallback(
    (id: string) => {
      const generation = state.coverVersions.get(id);
      const route = generation ? metadataRoutes.cover(id, generation) : mediaRoutes.cover(id);
      return `${apiOrigin}${route}`;
    },
    [apiOrigin, state.coverVersions],
  );
  const value = useMemo(
    () => ({ state, client, coverUrl, refresh: store.refresh }),
    [state, client, coverUrl, store],
  );
  return <MetadataContext.Provider value={value}>{children}</MetadataContext.Provider>;
}
export function useMetadataSync() {
  return useContext(MetadataContext);
}
