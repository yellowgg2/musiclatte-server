import { navigateMusic } from '../../music/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Action } from '../../design/components/Action';
import { TextField } from '../../design/components/TextField';
import { StatusSurface } from '../../design/components/StatusSurface';
import { LanguagePicker } from '../../app/LanguagePicker';
import { messages, formatCount, type Locale } from '../../i18n';
import { errorCode } from '../../auth/client';
import { createMusicClient, type LibraryData } from '../../music/client';
import { musicHref, musicRoute, scopeQuery, pageOffset } from '../../music/queries';
import { FolderRow } from '../../music/components/FolderRow';
import { MusicRow } from '../../music/components/MusicRow';
import type { ApiErrorCode } from '@musiclatte/contracts';
import styles from './Music.module.css';

export function MusicPage({
  location,
  base,
  locale,
  onLocale,
  fetcher,
  apiOrigin,
  onUnauthenticated,
}: {
  location: string;
  base: string;
  locale: Locale;
  onLocale: (locale: Locale) => void;
  fetcher: typeof fetch;
  apiOrigin: string;
  onUnauthenticated: () => void;
}) {
  const route = useMemo(() => musicRoute(location, base)!, [location, base]);
  const client = useMemo(() => createMusicClient({ fetcher, apiOrigin }), [fetcher, apiOrigin]);
  const [state, setState] = useState<{
    key: string;
    data?: LibraryData;
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
      ...(previous.key === location && previous.data ? { data: previous.data } : {}),
      loading: true,
    }));
    void client.read(route, controller.signal).then(
      (data) => {
        if (current) setState({ key: location, data, loading: false });
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
  }, [route, client, location, attempt, onUnauthenticated, q]);
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
                      : 'music.title'
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
  return (
    <div className={styles.page}>
      <div className={styles.topline}>
        <p className={styles.eyebrow}>{copy['music.eyebrow']}</p>
        <LanguagePicker locale={locale} onChange={onLocale} />
      </div>
      <nav className={styles.breadcrumb} aria-label={copy['music.breadcrumb']}>
        <a href={`${base}music`}>{copy['music.all']}</a>
        {scope.size > 0 && (
          <>
            <span aria-hidden="true">/</span>
            <a href={link('folders')}>{copy['music.selectedLibrary']}</a>
          </>
        )}
        {data?.kind === 'folder' && data.directory.parent && (
          <>
            <span aria-hidden="true">/</span>
            <a href={link('folder', data.directory.parent)}>{copy['music.parent']}</a>
          </>
        )}
      </nav>
      <header className={styles.heading}>
        <h1 tabIndex={-1} data-page-heading>
          {title}
        </h1>
        <p>
          {route.kind === 'search' ? `${copy['music.query']}: ${q}` : copy['music.description']}
        </p>
      </header>
      <form
        className={styles.search}
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.trim()) {
            setInvalid(true);
            return;
          }
          const query = scopeQuery(route.query);
          query.set('q', draft.trim());
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
        <Action type="submit">{copy['music.searchAction']}</Action>
      </form>
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
          <h2>
            {copy['music.folderContents']}{' '}
            <span className={styles.count}>{formatCount(data.directory.child.length, locale)}</span>
          </h2>
          <ul className={styles.list}>
            {data.directory.child.map((song) =>
              song.isDir ? (
                <FolderRow key={song.id} title={song.title} href={link('folder', song.id)} />
              ) : (
                <MusicRow key={song.id} song={song} locale={locale} base={base} scope={scope} />
              ),
            )}
          </ul>
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
      {data?.kind === 'album' && (
        <>
          {data.album.artistId && (
            <a className={styles.detailLink} href={link('artist', data.album.artistId)}>
              {copy['music.viewArtist']}: {data.album.artist || copy['music.unknownArtist']}
            </a>
          )}
          {!empty && (
            <section className={styles.section}>
              <h2>
                {copy['music.songs']}{' '}
                <span className={styles.count}>{formatCount(data.album.song.length, locale)}</span>
              </h2>
              <ul className={styles.list}>
                {data.album.song.map((song) => (
                  <MusicRow key={song.id} song={song} locale={locale} base={base} scope={scope} />
                ))}
              </ul>
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
            const query = new URLSearchParams(route.query);
            query.set(`${kind}Offset`, String(next));
            return musicHref(base, 'search', undefined, query);
          };
          return (
            <section className={styles.section} key={kind}>
              <h2>
                {copy[`music.${kind}s`]}{' '}
                <span className={styles.count}>{formatCount(items.length, locale)}</span>
              </h2>
              <ul className={styles.list}>
                {kind === 'song'
                  ? searchItems.song.map((song) => (
                      <MusicRow
                        key={song.id}
                        song={song}
                        locale={locale}
                        base={base}
                        scope={scope}
                      />
                    ))
                  : searchItems[kind].map((item) => (
                      <FolderRow
                        key={item.id}
                        title={item.name}
                        kind={kind}
                        href={link(kind, item.id)}
                      />
                    ))}
              </ul>
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
