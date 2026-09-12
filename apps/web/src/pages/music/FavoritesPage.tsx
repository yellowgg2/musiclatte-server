import { MetadataAction } from '../../metadata/components/MetadataAction';
import { useEffect } from 'react';
import { Action } from '../../design/components/Action';
import { StatusSurface } from '../../design/components/StatusSurface';
import { FavoriteAction } from '../../favorites/components/FavoriteAction';
import { useFavorites } from '../../favorites/FavoritesProvider';
import { formatCount, messages, type Locale } from '../../i18n';
import { MusicRow } from '../../music/components/MusicRow';
import {
  SongList,
  SongViewHeading,
  songLayout,
  useSongView,
} from '../../music/components/SongView';
import { usePlayer } from '../../player/PlayerProvider';
import { useSelection } from '../../selection/SelectionProvider';
import { useMetadataSelectionRebase } from '../../metadata/selection';
import { SelectionBar } from '../../selection/components/SelectionBar';
import { selectionScopeKey } from '../../selection/model';
import { LanguagePicker } from '../../app/LanguagePicker';
import styles from './FavoritesPage.module.css';
import { MusicSectionNav, type MusicSectionAvailability } from './MusicSectionNav';

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
  sections,
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
  sections: MusicSectionAvailability;
}) {
  const { store, state } = useFavorites();
  const player = usePlayer();
  const selection = useSelection();
  const copy = messages[locale];
  const [view, setView] = useSongView();
  const selectionKey = selectionScopeKey({ kind: 'favorites' });
  const source = 'favorites:songs';
  useMetadataSelectionRebase({
    key: source,
    scope: selectionKey,
    data: state.songs,
    items: state.songs.map((song, order) => ({ id: song.id, order })),
    ready: state.loaded && !state.loading && !state.error,
  });

  useEffect(() => {
    document.title = `${copy['favorites.title']} · Musiclatte`;
  }, [copy]);

  useEffect(() => {
    selection.dispatch({ type: 'scope', key: selectionKey });
    return () => selection.dispatch({ type: 'leave', key: selectionKey });
  }, [selection.dispatch, selectionKey]);

  const selectionBar =
    state.songs.length > 0 || selection.state.active ? (
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
    ) : undefined;

  return (
    <div className={styles.page}>
      <div className={styles.topline}>
        <header className={styles.heading}>
          <h1 tabIndex={-1} data-page-heading>
            {copy['favorites.title']}
          </h1>
          <p>{copy['favorites.description']}</p>
        </header>
        <LanguagePicker locale={locale} onChange={onLocale} />
      </div>
      <MusicSectionNav base={base} locale={locale} current="favorites" available={sections} />
      <section className={styles.headingActions} aria-label={copy['favorites.actions']}>
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
      </section>
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
          <SongViewHeading locale={locale} view={view} onChange={setView} actions={selectionBar}>
            {copy['favorites.songs']}{' '}
            <span className={styles.count}>{formatCount(state.songs.length, locale)}</span>
          </SongViewHeading>
          <SongList className={styles.list} aria-label={copy['favorites.songs']} view={view}>
            {state.songs.map((song, position) => (
              <MusicRow
                key={song.id}
                layout={songLayout(view)}
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
                actions={
                  <>
                    <MetadataAction song={song} />
                    <FavoriteAction song={song} locale={locale} />
                  </>
                }
              />
            ))}
          </SongList>
        </section>
      )}
    </div>
  );
}
