import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createFavoritesClient } from './client';
import { useMetadataSync } from '../metadata/MetadataSyncProvider';
import { createFavoritesStore, type FavoritesStore } from './state';

interface FavoritesContextValue {
  store: FavoritesStore;
  state: ReturnType<FavoritesStore['getSnapshot']>;
}

const FavoritesContext = createContext<FavoritesContextValue | undefined>(undefined);

export function FavoritesProvider({
  children,
  accountId,
  csrfToken,
  enabled,
  fetcher,
  apiOrigin,
  onUnauthenticated,
}: {
  children: ReactNode;
  accountId: string;
  csrfToken: string;
  enabled: boolean;
  fetcher: typeof fetch;
  apiOrigin: string;
  onUnauthenticated: () => void;
}) {
  const client = useMemo(() => createFavoritesClient({ fetcher, apiOrigin }), [fetcher, apiOrigin]);
  const [store] = useState(() => createFavoritesStore({ client, onUnauthenticated }));
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const metadata = useMetadataSync();
  const previousClient = useRef(metadata.client);
  const metadataKey = JSON.stringify(
    state.songs.flatMap((song) =>
      metadata.state.trackVersions.has(song.id)
        ? [[song.id, metadata.state.trackVersions.get(song.id)]]
        : [],
    ),
  );
  useEffect(() => {
    const changedScope = previousClient.current !== metadata.client;
    previousClient.current = metadata.client;
    if (metadataKey !== '[]' || changedScope) void store.refresh();
  }, [metadataKey, metadata.client, store]);

  useEffect(() => {
    void store.setScope({ accountId, csrfToken, enabled });
  }, [accountId, csrfToken, enabled, store]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void store.refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [store]);

  useEffect(() => () => store.dispose(), [store]);
  return <FavoritesContext.Provider value={{ store, state }}>{children}</FavoritesContext.Provider>;
}

export function useFavorites() {
  const favorites = useContext(FavoritesContext);
  if (!favorites) throw new Error('FavoritesProvider is missing');
  return favorites;
}
