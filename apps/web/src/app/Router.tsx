import { navigateMusic } from '../music/navigation';
import { MusicPage } from '../pages/music/MusicPage';
import { PlayerProvider, type PlayerAudio } from '../player/PlayerProvider';
import { DesktopPlayer } from '../player/DesktopPlayer';
import { MiniPlayer } from '../player/MiniPlayer';
import { musicRoute } from '../music/queries';
import { availableEntries, featureState } from '../capabilities/client-features';
import { playlistRoute } from '../playlists/routes';
import { PlaylistsPage } from '../pages/playlists/PlaylistsPage';
import { PlaylistDetailPage } from '../pages/playlists/PlaylistDetailPage';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createSessionClient } from '../auth/client';
import { createSessionStore } from '../auth/session-store';
import { isSettingsPath, safeReturnPath } from '../auth/guards';
import { useLocale } from '../i18n/locale';
import { messages } from '../i18n';
import { LoginPage } from '../pages/LoginPage';
import { SettingsPage } from '../pages/SettingsPage';
import { AppShell } from './AppShell';
import { LanguagePicker } from './LanguagePicker';
import { StatusSurface } from '../design/components/StatusSurface';
import { Action } from '../design/components/Action';
import { SelectionProvider } from '../selection/SelectionProvider';
import { FavoritesProvider } from '../favorites/FavoritesProvider';
import { isFavoritesPath } from '../favorites/routes';
import { FavoritesPage } from '../pages/music/FavoritesPage';
import styles from './Shell.module.css';
import '../design/global.css';
export function Router({
  fetcher = fetch,
  base = '/',
  apiOrigin = '',
  audioFactory,
}: {
  fetcher?: typeof fetch;
  base?: string;
  apiOrigin?: string;
  audioFactory?: () => PlayerAudio;
}) {
  const [store] = useState(() => createSessionStore(createSessionClient({ fetcher, apiOrigin })));
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [locale, onLocale] = useLocale();
  const [location, setLocation] = useState(window.location.pathname + window.location.search);
  const path = location.split('?')[0]!;
  const canBrowse = availableEntries(state.capabilities).includes('music.browse');
  const canStream = availableEntries(state.capabilities).includes('music.stream');
  const canRandom = availableEntries(state.capabilities).includes('library.randomSongs');
  const canReadPlaylists = availableEntries(state.capabilities).includes('playlists.read');
  const canWritePlaylists = availableEntries(state.capabilities).includes('playlists.write');
  const canFavorites = availableEntries(state.capabilities).includes('favorites.songs');
  const currentPlaylistRoute = playlistRoute(location, base);
  const currentFavoritesPath = isFavoritesPath(location, base);
  const playlistCapability = featureState(state.capabilities?.features['playlists.read']);
  const favoritesCapability = featureState(state.capabilities?.features['favorites.songs']);
  const copy = messages[locale];
  useEffect(() => {
    void store.restore();
    const refresh = () => {
      if (document.visibilityState === 'visible') void store.restore();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      store.dispose();
    };
  }, [store]);
  useEffect(() => {
    const changed = () => setLocation(window.location.pathname + window.location.search);
    const clicked = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = event.target instanceof Element ? event.target.closest('a') : null;
      if (
        !anchor ||
        anchor.target ||
        anchor.hasAttribute('download') ||
        anchor.getAttribute('href')?.startsWith('#')
      )
        return;
      const url = new URL(anchor.href);
      if (url.origin !== window.location.origin || !url.pathname.startsWith(base)) return;
      event.preventDefault();
      navigateMusic(url.pathname + url.search + url.hash);
    };
    window.addEventListener('popstate', changed);
    document.addEventListener('click', clicked);
    return () => {
      window.removeEventListener('popstate', changed);
      document.removeEventListener('click', clicked);
    };
  }, [base]);
  useEffect(() => {
    let next: string | undefined;
    if (state.status === 'signed-out' && path !== `${base}login`)
      next = `${base}login?returnTo=${encodeURIComponent(safeReturnPath(location, base))}`;
    if (
      state.status === 'signed-in' &&
      (path === `${base}login` || path === base || path === base.slice(0, -1))
    )
      if (state.capabilities || state.capabilityUnavailable)
        next = safeReturnPath(
          new URLSearchParams(window.location.search).get('returnTo'),
          base,
          canBrowse ? 'music' : canReadPlaylists ? 'playlists' : 'settings',
        );
    if (next) {
      window.history.replaceState(null, '', next);
      setLocation(window.location.pathname + window.location.search);
    }
  }, [
    state.status,
    location,
    base,
    state.capabilities,
    state.capabilityUnavailable,
    canBrowse,
    canReadPlaylists,
  ]);
  useEffect(() => {
    if (state.status === 'signed-in' && currentFavoritesPath && canFavorites) return;
    if (state.status === 'signed-in' && canBrowse && musicRoute(location, base)) return;
    if (state.status === 'signed-in' && canReadPlaylists && currentPlaylistRoute) return;
    document.title = `${state.status === 'signed-in' ? (musicRoute(location, base) ? copy['music.title'] : currentPlaylistRoute ? copy['playlists.title'] : copy['shell.settings']) : copy['login.title']} · Musiclatte`;
  }, [
    state.status,
    copy,
    location,
    base,
    canBrowse,
    canFavorites,
    canReadPlaylists,
    currentFavoritesPath,
    currentPlaylistRoute,
  ]);
  useEffect(() => {
    const heading = document.querySelector<HTMLElement>('[data-page-heading]');
    if (heading) heading.focus({ preventScroll: true });
    else if (state.status === 'signed-out')
      document.querySelector<HTMLInputElement>('[name="username"]')?.focus();
  }, [state.status, path]);
  if (state.status === 'loading' || state.status === 'error')
    return (
      <main className={styles.boot}>
        <LanguagePicker locale={locale} onChange={onLocale} />
        <StatusSurface
          state={state.status === 'loading' ? 'loading' : 'error'}
          title={
            copy[
              state.error === 'forbidden'
                ? 'status.denied'
                : state.status === 'loading'
                  ? 'status.loading'
                  : 'status.error'
            ]
          }
          description={state.error ? copy[`error.${state.error}`] : copy['status.loadingHelp']}
          action={
            state.status === 'error' ? (
              <Action onClick={() => void store.restore()}>{copy['status.retry']}</Action>
            ) : undefined
          }
        />
      </main>
    );
  if (!state.session)
    return (
      <LoginPage
        base={base}
        state={state}
        locale={locale}
        onLocale={onLocale}
        onLogin={store.login}
      />
    );
  return (
    <FavoritesProvider
      accountId={state.session.username}
      csrfToken={state.session.csrfToken}
      enabled={canFavorites}
      fetcher={fetcher}
      apiOrigin={apiOrigin}
      onUnauthenticated={store.expire}
    >
      <PlayerProvider
        fetcher={fetcher}
        apiOrigin={apiOrigin}
        onUnauthenticated={store.expire}
        {...(audioFactory ? { audioFactory } : {})}
      >
        <SelectionProvider>
          <AppShell
            locale={locale}
            base={base}
            capabilities={state.capabilities}
            player={
              <>
                <DesktopPlayer locale={locale} />
                <MiniPlayer locale={locale} />
              </>
            }
          >
            {currentFavoritesPath && canFavorites ? (
              <FavoritesPage
                base={base}
                locale={locale}
                onLocale={onLocale}
                fetcher={fetcher}
                apiOrigin={apiOrigin}
                onUnauthenticated={store.expire}
                canStream={canStream}
                canWritePlaylists={canWritePlaylists}
                csrfToken={state.session.csrfToken}
              />
            ) : currentFavoritesPath ? (
              <div className={styles.settings}>
                <h1 tabIndex={-1} data-page-heading>
                  {copy[favoritesCapability === 'denied' ? 'status.denied' : 'status.unavailable']}
                </h1>
                <p>
                  {
                    copy[
                      favoritesCapability === 'denied'
                        ? 'favorites.deniedHelp'
                        : 'favorites.unavailableHelp'
                    ]
                  }
                </p>
                <a href={canBrowse ? `${base}music` : `${base}settings`}>
                  {copy[canBrowse ? 'favorites.back' : 'status.back']}
                </a>
              </div>
            ) : currentPlaylistRoute && canReadPlaylists ? (
              currentPlaylistRoute.kind === 'list' ? (
                <PlaylistsPage
                  base={base}
                  locale={locale}
                  onLocale={onLocale}
                  fetcher={fetcher}
                  apiOrigin={apiOrigin}
                  onUnauthenticated={store.expire}
                  canWrite={canWritePlaylists}
                  csrfToken={state.session.csrfToken}
                />
              ) : (
                <PlaylistDetailPage
                  id={currentPlaylistRoute.id}
                  base={base}
                  locale={locale}
                  onLocale={onLocale}
                  fetcher={fetcher}
                  apiOrigin={apiOrigin}
                  onUnauthenticated={store.expire}
                  canStream={canStream}
                  canWrite={canWritePlaylists}
                  canFavorites={canFavorites}
                  csrfToken={state.session.csrfToken}
                />
              )
            ) : currentPlaylistRoute ? (
              <div className={styles.settings}>
                <h1 tabIndex={-1} data-page-heading>
                  {copy[playlistCapability === 'denied' ? 'status.denied' : 'status.unavailable']}
                </h1>
                <p>
                  {
                    copy[
                      playlistCapability === 'denied'
                        ? 'playlists.deniedHelp'
                        : 'playlists.unavailableHelp'
                    ]
                  }
                </p>
                <a href={canBrowse ? `${base}music` : `${base}settings`}>
                  {copy[canBrowse ? 'playlists.browseMusic' : 'status.back']}
                </a>
              </div>
            ) : musicRoute(location, base) && canBrowse ? (
              <MusicPage
                location={location}
                base={base}
                locale={locale}
                onLocale={onLocale}
                fetcher={fetcher}
                apiOrigin={apiOrigin}
                onUnauthenticated={store.expire}
                canStream={canStream}
                canRandom={canRandom}
                canWritePlaylists={canWritePlaylists}
                canFavorites={canFavorites}
                csrfToken={state.session.csrfToken}
              />
            ) : isSettingsPath(path, base) || path === `${base}login` || path === base ? (
              <SettingsPage
                state={state}
                locale={locale}
                onLocale={onLocale}
                onLogout={() => void store.logout()}
              />
            ) : (
              <div className={styles.settings}>
                <h1 tabIndex={-1} data-page-heading>
                  {copy['status.unavailable']}
                </h1>
                <p>{copy['status.unavailableHelp']}</p>
                <a href={`${base}settings`}>{copy['status.back']}</a>
              </div>
            )}
          </AppShell>
        </SelectionProvider>
      </PlayerProvider>
    </FavoritesProvider>
  );
}
