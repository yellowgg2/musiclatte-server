import { useEffect } from 'react';
import { Action } from '../../design/components/Action';
import { StatusSurface } from '../../design/components/StatusSurface';
import { FavoriteAction } from '../../favorites/components/FavoriteAction';
import { useFavorites } from '../../favorites/FavoritesProvider';
import { formatCount, messages, type Locale } from '../../i18n';
import { MusicRow } from '../../music/components/MusicRow';
import { usePlayer } from '../../player/PlayerProvider';
import { useSelection } from '../../selection/SelectionProvider';
import { SelectionBar } from '../../selection/components/SelectionBar';
import { selectionScopeKey } from '../../selection/model';
import { LanguagePicker } from '../../app/LanguagePicker';
import styles from './FavoritesPage.module.css';

export function FavoritesPage({
  base,
  locale,
  onLocale,
  fetcher,
  apiOrigin,
  onUnauthenticated,
  canStream,
  canWritePlaylists,
  csrfToken,
}: {
  base: string;
  locale: Locale;
  onLocale: (locale: Locale) => void;
  fetcher: typeof fetch;
  apiOrigin: string;
  onUnauthenticated: () => void;
  canStream: boolean;
  canWritePlaylists: boolean;
  csrfToken: string;
}) {
  const { store, state } = useFavorites();
  const player = usePlayer();
  const selection = useSelection();
  const copy = messages[locale];
  const selectionKey = selectionScopeKey({ kind: 'favorites' });
  const source = 'favorites:songs';

  useEffect(() => {
    document.title = `${copy['favorites.title']} · Musiclatte`;
  }, [copy]);

  useEffect(() => {
    selection.dispatch({ type: 'scope', key: selectionKey });
    return () => selection.dispatch({ type: 'leave', key: selectionKey });
  }, [selection.dispatch, selectionKey]);

  return (
    <div className={styles.page}>
      <div className={styles.topline}>
        <a className={styles.back} href={`${base}music`}>
          ← {copy['favorites.back']}
        </a>
        <LanguagePicker locale={locale} onChange={onLocale} />
      </div>
      <header className={styles.heading}>
        <h1 tabIndex={-1} data-page-heading>
          {copy['favorites.title']}
        </h1>
        <p>{copy['favorites.description']}</p>
      </header>
      <div className={styles.headingActions}>
        {state.songs.length > 0 && canStream && (
          <Action
            onClick={() =>
              player.activate({ song: state.songs[0]!, songs: state.songs, source, position: 0 })
            }
          >
            {copy['favorites.play']}
          </Action>
        )}
        <Action variant="secondary" busy={state.loading} onClick={() => void store.refresh()}>
          {copy['favorites.refresh']}
        </Action>
      </div>
      {state.songs.length > 0 && (
        <SelectionBar
          locale={locale}
          scopeLabel={copy['selection.scope.favorites']}
          pageItems={state.songs.map((song, order) => ({ id: song.id, order }))}
          fetcher={fetcher}
          apiOrigin={apiOrigin}
          csrfToken={csrfToken}
          canWrite={canWritePlaylists}
          onUnauthenticated={onUnauthenticated}
        />
      )}
      {state.loading && !state.loaded && (
        <StatusSurface
          state="loading"
          title={copy['favorites.loading']}
          description={copy['favorites.loadingHelp']}
        />
      )}
      {state.error && (
        <StatusSurface
          state="error"
          title={copy['favorites.error']}
          description={copy[`error.${state.error}`]}
          action={
            <Action variant="secondary" onClick={() => void store.refresh()}>
              {copy['status.retry']}
            </Action>
          }
        />
      )}
      {state.loaded && !state.error && state.songs.length === 0 && (
        <StatusSurface
          state="empty"
          title={copy['favorites.empty']}
          description={copy['favorites.emptyHelp']}
          action={
            <a className={styles.recoveryLink} href={`${base}music`}>
              {copy['favorites.browse']}
            </a>
          }
        />
      )}
      {state.songs.length > 0 && (
        <section className={styles.section}>
          <h2>
            {copy['favorites.songs']}{' '}
            <span className={styles.count}>{formatCount(state.songs.length, locale)}</span>
          </h2>
          <ul className={styles.list}>
            {state.songs.map((song, position) => (
              <MusicRow
                key={song.id}
                song={song}
                songs={state.songs}
                locale={locale}
                base={base}
                current={
                  player.state.queue?.source === source && player.state.queue.position === position
                }
                playbackStatus={player.state.status}
                coverUrl={player.coverUrl}
                {...(canStream
                  ? {
                      onActivate: (activation) =>
                        player.activate({ ...activation, source, position }),
                    }
                  : {})}
                onPause={player.pause}
                onResume={player.resume}
                {...(selection.state.active
                  ? {
                      selected: selection.state.items.some(({ id }) => id === song.id),
                      onSelect: () =>
                        selection.dispatch({
                          type: 'toggle',
                          item: { id: song.id, order: position },
                        }),
                    }
                  : {})}
                actions={<FavoriteAction song={song} locale={locale} />}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
