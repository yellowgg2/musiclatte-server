import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createFavoritesClient } from './client';
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
