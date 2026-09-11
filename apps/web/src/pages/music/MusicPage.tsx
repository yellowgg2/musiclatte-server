import { useMetadataUI } from '../../metadata/MetadataUIProvider';
import { MetadataAction } from '../../metadata/components/MetadataAction';
import { navigateMusic } from '../../music/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useMetadataSync } from '../../metadata/MetadataSyncProvider';
import { useMetadataSelectionRebase } from '../../metadata/selection';
import { Action } from '../../design/components/Action';
import { TextField } from '../../design/components/TextField';
import { StatusSurface } from '../../design/components/StatusSurface';
import { SectionNav } from '../../design/components/SectionNav';
import { LanguagePicker } from '../../app/LanguagePicker';
import { messages, formatCount, type Locale } from '../../i18n';
import { errorCode } from '../../auth/client';
import { createMusicClient, type LibraryData, type MusicClient } from '../../music/client';
import {
  createSearchReturnTo,
  musicHref,
  musicRoute,
  pageOffset,
  parseSearchReturnTo,
  scopeQuery,
} from '../../music/queries';
import { FolderRow } from '../../music/components/FolderRow';
import { MusicRow } from '../../music/components/MusicRow';
import {
  SongList,
  SongViewHeading,
  songLayout,
  useSongView,
} from '../../music/components/SongView';
import { usePlayer } from '../../player/PlayerProvider';
import { useSelection } from '../../selection/SelectionProvider';
import { SelectionBar } from '../../selection/components/SelectionBar';
import { FavoriteAction } from '../../favorites/components/FavoriteAction';
import { selectionScopeKey } from '../../selection/model';
import type { ApiErrorCode, MusicDirectory, MusicEntry } from '@musiclatte/contracts';
import styles from './Music.module.css';
import { ArtistInfoPanel } from './ArtistInfoPanel';
import { MusicSectionNav, type MusicSectionAvailability } from './MusicSectionNav';

const MAX_FOLDER_TRAIL_DEPTH = 24;

async function loadFolderTrail(client: MusicClient, current: MusicDirectory, signal: AbortSignal) {
  const reversed = [current];
  const visited = new Set([current.id]);
  let parent = current.parent;
  while (parent && reversed.length < MAX_FOLDER_TRAIL_DEPTH && !visited.has(parent)) {
    visited.add(parent);
    let data: LibraryData;
    try {
      data = await client.read(
        { kind: 'folder', id: parent, query: new URLSearchParams() },
        signal,
      );
    } catch (error) {
      if (errorCode(error) === 'unauthenticated') throw error;
      break;
    }
    if (data.kind !== 'folder') break;
    reversed.push(data.directory);
    parent = data.directory.parent;
  }
  return reversed.reverse();
}

export function MusicPage({
  location,
  base,
  locale,
  onLocale,
  fetcher,
  apiOrigin,
  onUnauthenticated,
  canStream,
  canRandom,
  canWritePlaylists,
  canFavorites,
  canArtistInfo = false,
  sections,
  csrfToken,
}: {
  location: string;
  base: string;
  locale: Locale;
  onLocale: (locale: Locale) => void;
  fetcher: typeof fetch;
  apiOrigin: string;
  onUnauthenticated: () => void;
  canStream: boolean;
  canRandom: boolean;
  canWritePlaylists: boolean;
  canFavorites: boolean;
  canArtistInfo?: boolean;
  sections: MusicSectionAvailability;
  csrfToken: string;
}) {
  const [songView, setSongView] = useSongView();
  const player = usePlayer();
  const metadataUI = useMetadataUI();
  const metadata = useMetadataSync();
  const selection = useSelection();
  const route = useMemo(() => musicRoute(location, base)!, [location, base]);
  const metadataVersion =
    route.kind === 'album' || route.kind === 'artist'
      ? Math.max(
          0,
          ...[...metadata.state.latest.values()]
            .filter(
              (change) =>
                change.reflection === 'verified' &&
                change.oldTrackId === change.newTrackId &&
                (route.kind === 'album'
                  ? change.relatedIds.albumIds
                  : change.relatedIds.artistIds
                ).includes(route.id!),
            )
            .map((change) => change.sequence),
        )
      : metadata.state.version;
  const client = useMemo(() => createMusicClient({ fetcher, apiOrigin }), [fetcher, apiOrigin]);
  const [state, setState] = useState<{
    key: string;
    data?: LibraryData;
    libraryId?: string;
    error?: ApiErrorCode;
    loading: boolean;
  }>({ key: location, loading: true });
  const [attempt, retry] = useState(0);
  const q = route.query.get('q') ?? '';
  const [draft, setDraft] = useState(q);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(q);
    setInvalid(false);
  }, [q]);
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    if (route.kind === 'search' && !q.trim()) {
      setState({ key: location, loading: false });
      return () => controller.abort();
    }
    setState((previous) => ({
      key: location,
      ...(previous.key === location && previous.data
        ? { data: previous.data, ...(previous.libraryId ? { libraryId: previous.libraryId } : {}) }
        : {}),
      loading: previous.key !== location || !previous.data,
    }));
    void (async () => {
      const data = await client.read(route, controller.signal);
      if (
        route.kind === 'folders' &&
        !route.query.has('musicFolderId') &&
        data.kind === 'folders' &&
        data.folders.length === 1
      ) {
        const libraryId = data.folders[0]!.id;
        const query = new URLSearchParams(route.query);
        query.set('musicFolderId', libraryId);
        return {
          data: await client.read({ ...route, query }, controller.signal),
          libraryId,
        };
      }
      return { data };
    })().then(
      (result) => {
        if (current) setState({ key: location, ...result, loading: false });
      },
      (error) => {
        if (!current) return;
        const code = errorCode(error);
        if (code === 'unauthenticated') {
          onUnauthenticated();
          return;
        }
        setState((previous) => ({ ...previous, error: code, loading: false }));
      },
    );
    return () => {
      current = false;
      controller.abort();
    };
  }, [route, client, location, attempt, onUnauthenticated, q, metadataVersion, metadata.client]);
  useEffect(() => {
    if (state.key !== location || state.loading) return;
    const top = window.history.state?.musicScroll;
    window.scrollTo({
      top: typeof top === 'number' && Number.isFinite(top) ? top : 0,
      behavior: 'instant',
    });
  }, [location, state.key, state.loading]);
  const copy = messages[locale];
  const data = state.key === location ? state.data : undefined;
  const error = state.key === location ? state.error : undefined;
  const loading = state.key !== location || state.loading;
  const scope = scopeQuery(route.query);
  if (state.key === location && state.libraryId) scope.set('musicFolderId', state.libraryId);
  const searchReturnTo = route.kind === 'search' ? parseSearchReturnTo(route.query, base) : null;
  const searchReturnRoute = searchReturnTo ? musicRoute(searchReturnTo, base) : null;
  const searchResetHref =
    searchReturnTo ?? musicHref(base, 'folders', undefined, new URLSearchParams(scope));
  const currentDirectory = data?.kind === 'folder' ? data.directory : undefined;
  const [folderTrail, setFolderTrail] = useState<{
    key: string;
    currentId: string;
    directories: MusicDirectory[];
  }>();
  useEffect(() => {
    if (!currentDirectory) {
      setFolderTrail(undefined);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setFolderTrail({
      key: location,
      currentId: currentDirectory.id,
      directories: [currentDirectory],
    });
    if (currentDirectory.parent)
      void loadFolderTrail(client, currentDirectory, controller.signal).then(
        (directories) => {
          if (active)
            setFolderTrail({ key: location, currentId: currentDirectory.id, directories });
        },
        (error) => {
          if (active && errorCode(error) === 'unauthenticated') onUnauthenticated();
        },
      );
    return () => {
      active = false;
      controller.abort();
    };
  }, [client, currentDirectory, location, onUnauthenticated]);
  const visibleFolderTrail =
    currentDirectory &&
    folderTrail?.key === location &&
    folderTrail.currentId === currentDirectory.id
      ? folderTrail.directories
      : currentDirectory
        ? [currentDirectory]
        : [];
  const title =
    data?.kind === 'folder'
      ? data.directory.name
      : data?.kind === 'artist'
        ? data.artist.name
        : data?.kind === 'album'
          ? data.album.name
          : copy[
              route.kind === 'search'
                ? 'music.searchResults'
                : route.kind === 'folder'
                  ? 'music.folder'
                  : route.kind === 'artist'
                    ? 'music.artists'
                    : route.kind === 'album'
                      ? 'music.albums'
                      : 'music.all'
            ];
  const empty =
    data?.kind === 'folders'
      ? data.folders.length === 0
      : data?.kind === 'indexes'
        ? data.indexes.index.every((group) => group.artist.length === 0)
        : data?.kind === 'folder'
          ? data.directory.child.length === 0
          : data?.kind === 'artist'
            ? data.artist.album.length === 0
            : data?.kind === 'album'
              ? data.album.song.length === 0
              : data?.kind === 'search'
                ? Object.values(data.result).every((items) => items.length === 0)
                : false;
  const link = (kind: Parameters<typeof musicHref>[1], id?: string) =>
    musicHref(base, kind, id, scope);
  useEffect(() => {
    document.title = `${title} · Musiclatte`;
  }, [title]);
  const searchItems = data?.kind === 'search' ? data.result : null;
  const selectableSongs =
    data?.kind === 'folder'
      ? data.directory.child.filter((entry) => !entry.isDir)
      : data?.kind === 'search'
        ? data.result.song
        : [];
  const selectionKey =
    data?.kind === 'folder'
      ? selectionScopeKey({ kind: 'folder', id: data.directory.id })
      : data?.kind === 'search'
        ? selectionScopeKey({
            kind: 'search',
            query: q,
            ...(route.query.get('musicFolderId')
              ? { musicFolderId: route.query.get('musicFolderId')! }
              : {}),
          })
        : undefined;
  const selectionOffset = data?.kind === 'search' ? pageOffset(route.query, 'song') : 0;
  const pageSelectionItems = selectableSongs.map((song, index) => ({
    id: song.id,
    order: selectionOffset + index,
  }));
  useMetadataSelectionRebase({
    key: location,
    ...(selectionKey ? { scope: selectionKey } : {}),
    data,
    items: pageSelectionItems,
    ready: !loading && !error,
  });
  useEffect(() => {
    selection.dispatch({
      type: 'scope',
      ...(selectionKey ? { key: selectionKey } : {}),
    });
    return () => {
      if (selectionKey) selection.dispatch({ type: 'leave', key: selectionKey });
    };
  }, [selection.dispatch, selectionKey]);
  const songRow = (song: MusicEntry, songs: readonly MusicEntry[], order = 0) => (
    <MusicRow
      key={song.id}
      song={song}
      layout={songLayout(songView)}
      songs={songs}
      locale={locale}
      base={base}
      scope={scope}
      current={player.state.current?.id === song.id}
      playbackStatus={player.state.status}
      coverUrl={player.coverUrl}
      {...(canStream ? { onActivate: player.activate } : {})}
      onPause={player.pause}
      onResume={player.resume}
      {...(selectionKey && selection.state.active
        ? {
            selected: selection.state.items.some(({ id }) => id === song.id),
            onSelect: () => selection.dispatch({ type: 'toggle', item: { id: song.id, order } }),
          }
        : {})}
      actions={
        <>
          <MetadataAction song={song} />
          {canFavorites && <FavoriteAction song={song} locale={locale} />}
        </>
      }
    />
  );
  return (
    <div className={styles.page}>
      <div className={styles.topline}>
        <header className={styles.heading}>
          <h1 tabIndex={-1} data-page-heading>
            {title}
          </h1>
          {route.kind === 'folders' && <p>{copy['music.description']}</p>}
        </header>
        <div className={styles.utilities}>
          {metadataUI.canHistory && <a href={`${base}metadata-jobs`}>{copy['metadata.history']}</a>}
          <LanguagePicker locale={locale} onChange={onLocale} />
        </div>
      </div>
      {route.kind !== 'folders' && (
        <SectionNav
          label={copy['music.breadcrumb']}
          variant="breadcrumb"
          items={
            data?.kind === 'folder'
              ? [
                  { label: copy['music.all'], href: `${base}music` },
                  ...visibleFolderTrail.map((directory, index) =>
                    index === visibleFolderTrail.length - 1
                      ? { label: directory.name, current: true }
                      : { label: directory.name, href: link('folder', directory.id) },
                  ),
                ]
              : [
                  { label: copy['music.all'], href: `${base}music` },
                  ...(route.kind === 'search' && searchReturnRoute?.kind === 'folder'
                    ? [{ label: copy['music.searchOrigin'], href: searchReturnTo! }]
                    : scope.size > 0
                      ? [{ label: copy['music.selectedLibrary'], href: link('folders') }]
                      : []),
                  { label: title, current: true },
                ]
          }
        />
      )}
      <div className={styles.toolbar}>
        <MusicSectionNav base={base} locale={locale} current="music" available={sections} />
        {canRandom && (
          <div className={styles.random}>
            <Action
              busy={player.state.randomStatus === 'loading'}
              onClick={() => void player.playRandom()}
            >
              {
                copy[
                  player.state.randomStatus === 'loading'
                    ? 'player.random.loading'
                    : 'player.random'
                ]
              }
            </Action>
            {player.state.randomStatus === 'empty' && (
              <p role="status">{copy['player.random.empty']}</p>
            )}
            {player.state.randomStatus === 'error' && (
              <p role="alert">{copy['player.random.error']}</p>
            )}
          </div>
        )}
      </div>
      <form
        className={styles.search}
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.trim()) {
            setInvalid(true);
            return;
          }
          const query = new URLSearchParams(scope);
          query.set('q', draft.trim());
          const returnTo =
            route.kind === 'folder' ? createSearchReturnTo(base, route) : searchReturnTo;
          if (returnTo) query.set('returnTo', returnTo);
          navigateMusic(musicHref(base, 'search', undefined, query));
        }}
      >
        <TextField
          type="search"
          name="q"
          label={copy['music.search']}
          placeholder={copy['music.searchPlaceholder']}
          value={draft}
          maxLength={2048}
          onChange={(event) => {
            setDraft(event.target.value);
            setInvalid(false);
          }}
          {...(invalid ? { error: copy['music.searchRequired'] } : {})}
        />
        <div className={styles.searchActions}>
          <Action type="submit">{copy['music.searchAction']}</Action>
          {route.kind === 'search' && (
            <Action
              variant="secondary"
              type="button"
              onClick={() => navigateMusic(searchResetHref)}
            >
              {copy['music.searchReset']}
            </Action>
          )}
        </div>
      </form>
      {selectionKey && (selectableSongs.length > 0 || selection.state.active) && (
        <SelectionBar
          locale={locale}
          scopeLabel={
            data?.kind === 'search'
              ? copy['selection.scope.search'].replace('{query}', q)
              : copy['selection.scope.folder'].replace(
                  '{name}',
                  data?.kind === 'folder' ? data.directory.name : '',
                )
          }
          pageItems={pageSelectionItems}
          fetcher={fetcher}
          apiOrigin={apiOrigin}
          csrfToken={csrfToken}
          canWrite={canWritePlaylists}
          onUnauthenticated={onUnauthenticated}
        />
      )}
      {loading && (
        <StatusSurface
          state="loading"
          title={copy['music.loading']}
          description={copy['music.loadingHelp']}
        />
      )}
      {error && (
        <StatusSurface
          state="error"
          title={copy[error === 'not_found' ? 'music.notFound' : 'music.error']}
          description={error === 'not_found' ? copy['music.notFoundHelp'] : copy[`error.${error}`]}
          action={
            <Action variant="secondary" onClick={() => retry((value) => value + 1)}>
              {copy['status.retry']}
            </Action>
          }
        />
      )}
      {!loading && !error && (empty || (route.kind === 'search' && !q.trim())) && (
        <StatusSurface
          state="empty"
          title={copy[route.kind === 'search' ? 'music.noMatches' : 'music.empty']}
          description={copy[route.kind === 'search' ? 'music.noMatchesHelp' : 'music.emptyHelp']}
        />
      )}
      {data?.kind === 'folders' && data.folders.length > 0 && (
        <section className={styles.section}>
          <h2>{copy['music.libraries']}</h2>
          <ul className={styles.list}>
            {data.folders.map((folder) => (
              <FolderRow
                key={folder.id}
                title={folder.name}
                href={musicHref(
                  base,
                  'folders',
                  undefined,
                  new URLSearchParams({ musicFolderId: folder.id }),
                )}
              />
            ))}
          </ul>
        </section>
      )}
      {data?.kind === 'indexes' && !empty && (
        <section className={styles.section}>
          <h2>{copy['music.folders']}</h2>
          <ul className={styles.list}>
            {data.indexes.index
              .flatMap((group) => group.artist)
              .map((folder) => (
                <FolderRow key={folder.id} title={folder.name} href={link('folder', folder.id)} />
              ))}
          </ul>
        </section>
      )}
      {data?.kind === 'folder' && !empty && (
        <section className={styles.section}>
          <SongViewHeading locale={locale} view={songView} onChange={setSongView}>
            {copy['music.folderContents']}{' '}
            <span className={styles.count}>{formatCount(data.directory.child.length, locale)}</span>
          </SongViewHeading>
          <SongList
            className={styles.list}
            aria-label={copy['music.folderContents']}
            view={songView}
          >
            {data.directory.child.map((song, index) =>
              song.isDir ? (
                <FolderRow key={song.id} title={song.title} href={link('folder', song.id)} />
              ) : (
                songRow(song, data.directory.child, index)
              ),
            )}
          </SongList>
        </section>
      )}
      {data?.kind === 'artist' && !empty && (
        <section className={styles.section}>
          <h2>{copy['music.albums']}</h2>
          <ul className={styles.list}>
            {data.artist.album.map((album) => (
              <FolderRow
                key={album.id}
                title={album.name}
                kind="album"
                href={link('album', album.id)}
              />
            ))}
          </ul>
        </section>
      )}
      {data?.kind === 'artist' && canArtistInfo && (
        <ArtistInfoPanel
          artistId={data.artist.id}
          artistName={data.artist.name}
          base={base}
          locale={locale}
          fetcher={fetcher}
          apiOrigin={apiOrigin}
          coverUrl={player.coverUrl}
          onUnauthenticated={onUnauthenticated}
        />
      )}
      {data?.kind === 'album' && (
        <>
          {data.album.artistId && (
            <a className={styles.detailLink} href={link('artist', data.album.artistId)}>
              {copy['music.viewArtist']}: {data.album.artist || copy['music.unknownArtist']}
            </a>
          )}
          {!empty && (
            <section className={styles.section}>
              <SongViewHeading locale={locale} view={songView} onChange={setSongView}>
                {copy['music.songs']}{' '}
                <span className={styles.count}>{formatCount(data.album.song.length, locale)}</span>
              </SongViewHeading>
              <SongList className={styles.list} aria-label={copy['music.songs']} view={songView}>
                {data.album.song.map((song) => songRow(song, data.album.song))}
              </SongList>
            </section>
          )}
        </>
      )}
      {searchItems &&
        (['artist', 'album', 'song'] as const).map((kind) => {
          const items = searchItems[kind];
          const offset = pageOffset(route.query, kind);
          if (items.length === 0 && offset === 0) return null;
          const page = (next: number) => {
            const query = new URLSearchParams(scope);
            query.set('q', q);
            for (const pageKind of ['artist', 'album', 'song'] as const) {
              const key = `${pageKind}Offset`;
              if (route.query.getAll(key).length !== 1) continue;
              const current = pageOffset(route.query, pageKind);
              if (current > 0) query.set(key, String(current));
            }
            if (searchReturnTo) query.set('returnTo', searchReturnTo);
            query.set(`${kind}Offset`, String(next));
            return musicHref(base, 'search', undefined, query);
          };
          return (
            <section className={styles.section} key={kind}>
              {kind === 'song' ? (
                <SongViewHeading locale={locale} view={songView} onChange={setSongView}>
                  {copy[`music.${kind}s`]}{' '}
                  <span className={styles.count}>{formatCount(items.length, locale)}</span>
                </SongViewHeading>
              ) : (
                <h2>
                  {copy[`music.${kind}s`]}{' '}
                  <span className={styles.count}>{formatCount(items.length, locale)}</span>
                </h2>
              )}
              <SongList
                className={styles.list}
                aria-label={copy[`music.${kind}s`]}
                view={kind === 'song' ? songView : 'list'}
              >
                {kind === 'song'
                  ? searchItems.song.map((song, index) =>
                      songRow(song, searchItems.song, offset + index),
                    )
                  : searchItems[kind].map((item) => (
                      <FolderRow
                        key={item.id}
                        title={item.name}
                        kind={kind}
                        href={link(kind, item.id)}
                      />
                    ))}
              </SongList>
              {(offset > 0 || items.length === 20) && (
                <nav className={styles.pagination} aria-label={copy[`music.${kind}s`]}>
                  {offset > 0 && (
                    <a href={page(Math.max(0, offset - 20))}>{copy[`music.previous.${kind}`]}</a>
                  )}
                  {items.length === 20 && Number.isSafeInteger(offset + 20) && (
                    <a href={page(offset + 20)}>{copy[`music.next.${kind}`]}</a>
                  )}
                </nav>
              )}
            </section>
          );
        })}
    </div>
  );
}
