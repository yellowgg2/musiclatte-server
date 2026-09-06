import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApiErrorCode, PlaylistDetail } from '@musiclatte/contracts';
import { ApiError } from '../../auth/client';
import { LanguagePicker } from '../../app/LanguagePicker';
import { Action } from '../../design/components/Action';
import { Artwork } from '../../design/components/Artwork';
import { StatusSurface } from '../../design/components/StatusSurface';
import { formatCount, messages, type Locale } from '../../i18n';
import { MusicRow } from '../../music/components/MusicRow';
import { createPlaylistClient, PlaylistMutationError } from '../../playlists/client';
import { DeletePlaylistConfirmation } from '../../playlists/components/DeletePlaylistConfirmation';
import { PlaylistForm } from '../../playlists/components/PlaylistForm';
import { PlaylistOccurrenceActions } from '../../playlists/components/PlaylistOccurrenceActions';
import { moveOccurrenceOrder } from '../../playlists/occurrences';
import { newPlaylistOperationId } from '../../playlists/operation-id';
import { playlistHref } from '../../playlists/routes';
import { usePlayer } from '../../player/PlayerProvider';
import { useSelection } from '../../selection/SelectionProvider';
import { SelectionBar } from '../../selection/components/SelectionBar';
import { selectionScopeKey } from '../../selection/model';
import styles from './Playlist.module.css';

function songCountLabel(count: number, locale: Locale) {
  const key = count === 1 ? 'playlists.songCount.one' : 'playlists.songCount.many';
  return messages[locale][key].replace('{count}', formatCount(count, locale));
}

export function PlaylistDetailPage({
  id,
  base,
  locale,
  onLocale,
  fetcher,
  apiOrigin,
  onUnauthenticated,
  canStream,
  canWrite,
  csrfToken,
}: {
  id: string;
  base: string;
  locale: Locale;
  onLocale: (locale: Locale) => void;
  fetcher: typeof fetch;
  apiOrigin: string;
  onUnauthenticated: () => void;
  canStream: boolean;
  canWrite: boolean;
  csrfToken: string;
}) {
  const player = usePlayer();
  const selection = useSelection();
  const client = useMemo(() => createPlaylistClient({ fetcher, apiOrigin }), [fetcher, apiOrigin]);
  const [attempt, retry] = useState(0);
  const [overlay, setOverlay] = useState<'rename' | 'delete' | undefined>(undefined);
  const [mutation, setMutation] = useState<{ position: number; kind: 'move' | 'remove' }>();
  const [editError, setEditError] = useState<ApiErrorCode>();
  const [focusRequest, setFocusRequest] = useState<{
    kind: 'move' | 'remove' | 'conflict';
    songId: string;
    position: number;
  }>();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const occurrenceRefs = useRef(new Map<number, HTMLDivElement>());
  const [state, setState] = useState<{
    key: string;
    playlist?: PlaylistDetail;
    error?: ApiErrorCode;
    loading: boolean;
  }>({ key: id, loading: true });
  const copy = messages[locale];

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    setState((previous) => ({
      key: id,
      ...(previous.key === id && previous.playlist ? { playlist: previous.playlist } : {}),
      loading: true,
    }));
    void client.read({ kind: 'detail', id }, controller.signal).then(
      (data) => {
        if (current && data.kind === 'detail')
          setState({ key: id, playlist: data.playlist, loading: false });
      },
      (error) => {
        if (!current) return;
        const code = error instanceof ApiError ? error.code : 'internal_error';
        if (code === 'unauthenticated') {
          onUnauthenticated();
          return;
        }
        setState({ key: id, error: code, loading: false });
      },
    );
    return () => {
      current = false;
      controller.abort();
    };
  }, [attempt, client, id, onUnauthenticated]);

  const playlist = state.key === id ? state.playlist : undefined;
  const error = state.key === id ? state.error : undefined;
  const loading = state.key !== id || state.loading;
  const source = playlist ? `playlist:${playlist.id}@${playlist.revision}` : '';
  const songs = playlist?.entries.map((entry) => entry.song) ?? [];
  const canManage = Boolean(playlist?.editable && canWrite);
  const selectionKey = playlist
    ? selectionScopeKey({ kind: 'playlist', id: playlist.id, revision: playlist.revision })
    : undefined;

  useEffect(() => {
    selection.dispatch({
      type: 'scope',
      ...(selectionKey ? { key: selectionKey } : {}),
    });
    return () => {
      if (selectionKey) selection.dispatch({ type: 'leave', key: selectionKey });
    };
  }, [selection.dispatch, selectionKey]);

  useEffect(() => {
    document.title = `${playlist?.name ?? copy['playlists.title']} · Musiclatte`;
  }, [copy, playlist?.name]);

  useEffect(() => {
    if (!focusRequest || !playlist) return;
    let position: number | undefined;
    if (focusRequest.kind === 'remove') {
      position =
        playlist.entries[Math.min(focusRequest.position, playlist.entries.length - 1)]?.position;
    } else {
      position = playlist.entries
        .filter((entry) => entry.song.id === focusRequest.songId)
        .sort(
          (left, right) =>
            Math.abs(left.position - focusRequest.position) -
            Math.abs(right.position - focusRequest.position),
        )[0]?.position;
    }
    const target = position === undefined ? undefined : occurrenceRefs.current.get(position);
    (target ?? headingRef.current)?.focus();
    setFocusRequest(undefined);
  }, [focusRequest, playlist]);

  async function editOccurrence(
    entry: PlaylistDetail['entries'][number],
    kind: 'remove' | 'move',
    direction?: 'up' | 'down',
  ) {
    if (!playlist || mutation) return;
    const order =
      kind === 'move' && direction
        ? moveOccurrenceOrder(
            playlist.entries,
            { position: entry.position, songId: entry.song.id },
            direction,
          )
        : undefined;
    if (kind === 'move' && !order) return;
    const destination =
      kind === 'move' ? entry.position + (direction === 'up' ? -1 : 1) : entry.position;
    const controller = new AbortController();
    setMutation({ position: entry.position, kind });
    setEditError(undefined);
    try {
      const options = {
        csrfToken,
        operationId: newPlaylistOperationId(),
        signal: controller.signal,
      };
      const result =
        kind === 'remove'
          ? await client.remove(
              playlist.id,
              playlist.revision,
              { position: entry.position, songId: entry.song.id },
              options,
            )
          : await client.reorder(playlist.id, playlist.revision, order!, options);
      setState({ key: id, playlist: result.playlist, loading: false });
      selection.dispatch({
        type: 'rebase',
        key: selectionScopeKey({
          kind: 'playlist',
          id: result.playlist.id,
          revision: result.playlist.revision,
        }),
      });
      setFocusRequest({ kind, songId: entry.song.id, position: destination });
    } catch (error) {
      if (error instanceof PlaylistMutationError) {
        if (error.current) setState({ key: id, playlist: error.current, loading: false });
        setEditError(error.code);
        setFocusRequest({ kind: 'conflict', songId: entry.song.id, position: entry.position });
      } else if (error instanceof ApiError) {
        if (error.code === 'unauthenticated') onUnauthenticated();
        else setEditError(error.code);
      } else setEditError('internal_error');
    } finally {
      setMutation(undefined);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.topline}>
        <a className={styles.breadcrumb} href={playlistHref(base)}>
          ← {copy['playlists.back']}
        </a>
        <LanguagePicker locale={locale} onChange={onLocale} />
      </div>
      {loading && !playlist && (
        <StatusSurface
          state="loading"
          title={copy['playlists.loadingDetail']}
          description={copy['playlists.loadingHelp']}
        />
      )}
      {error && (
        <StatusSurface
          state="error"
          title={
            copy[
              error === 'not_found'
                ? 'playlists.notFound'
                : error === 'forbidden'
                  ? 'playlists.denied'
                  : 'playlists.error'
            ]
          }
          description={
            error === 'not_found'
              ? copy['playlists.notFoundHelp']
              : error === 'forbidden'
                ? copy['playlists.deniedHelp']
                : copy[`error.${error}`]
          }
          action={
            error === 'not_found' || error === 'forbidden' ? (
              <a className={styles.recoveryLink} href={playlistHref(base)}>
                {copy['playlists.back']}
              </a>
            ) : (
              <Action variant="secondary" onClick={() => retry((value) => value + 1)}>
                {copy['status.retry']}
              </Action>
            )
          }
        />
      )}
      {!error && playlist && (
        <>
          <header className={styles.detailHeader}>
            <div className={styles.detailArtwork}>
              <Artwork
                alt={playlist.name}
                {...(playlist.coverArt ? { src: player.coverUrl(playlist.coverArt) } : {})}
              />
            </div>
            <div className={styles.headingCopy}>
              <p className={styles.eyebrow}>{copy['playlists.eyebrow']}</p>
              <h1 ref={headingRef} tabIndex={-1} data-page-heading>
                {playlist.name}
              </h1>
              <p className={styles.meta}>{songCountLabel(playlist.songCount, locale)}</p>
              {(canManage || (canStream && songs.length > 0)) && (
                <div className={styles.headingActions}>
                  {canStream && songs.length > 0 && (
                    <Action
                      onClick={() =>
                        player.activate({ song: songs[0]!, songs, source, position: 0 })
                      }
                    >
                      {copy['playlists.play']}
                    </Action>
                  )}
                  {canManage && (
                    <>
                      <Action variant="secondary" onClick={() => setOverlay('rename')}>
                        {copy['playlists.rename']}
                      </Action>
                      <Action variant="destructive" onClick={() => setOverlay('delete')}>
                        {copy['playlists.delete']}
                      </Action>
                    </>
                  )}
                </div>
              )}
            </div>
          </header>
          {playlist.entries.length > 0 && (
            <SelectionBar
              locale={locale}
              scopeLabel={copy['selection.scope.playlist'].replace('{name}', playlist.name)}
              pageItems={playlist.entries.map((entry) => ({
                id: entry.song.id,
                order: entry.position,
              }))}
              fetcher={fetcher}
              apiOrigin={apiOrigin}
              csrfToken={csrfToken}
              canWrite={canWrite}
              onUnauthenticated={onUnauthenticated}
              onPlaylistUpdated={(updated) => {
                if (updated.id !== playlist.id) return;
                setState({ key: id, playlist: updated, loading: false });
                selection.dispatch({
                  type: 'rebase',
                  key: selectionScopeKey({
                    kind: 'playlist',
                    id: updated.id,
                    revision: updated.revision,
                  }),
                });
              }}
            />
          )}
          {editError && (
            <StatusSurface
              state="error"
              title={copy['playlists.editErrorTitle']}
              description={
                editError === 'conflict'
                  ? copy['playlists.editConflict']
                  : editError === 'outcome_unknown'
                    ? copy['playlists.outcomeUnknown']
                    : copy[`error.${editError}`]
              }
              action={
                <Action
                  variant="secondary"
                  onClick={() => {
                    setEditError(undefined);
                    retry((value) => value + 1);
                  }}
                >
                  {copy['playlists.refresh']}
                </Action>
              }
            />
          )}
          {playlist.entries.length === 0 ? (
            <StatusSurface
              state="empty"
              title={copy['playlists.detailEmpty']}
              description={copy['playlists.detailEmptyHelp']}
              action={
                <a className={styles.recoveryLink} href={`${base}music`}>
                  {copy['playlists.browseMusic']}
                </a>
              }
            />
          ) : (
            <section className={styles.section}>
              <h2>
                {copy['playlists.songs']}{' '}
                <span className={styles.count}>
                  {copy['playlists.sectionCount'].replace(
                    '{count}',
                    formatCount(songs.length, locale),
                  )}
                </span>
              </h2>
              <ul className={styles.songList}>
                {playlist.entries.map((entry) => (
                  <MusicRow
                    key={`${entry.position}:${entry.song.id}`}
                    song={entry.song}
                    songs={songs}
                    locale={locale}
                    base={base}
                    current={
                      player.state.queue?.source === source &&
                      player.state.queue.position === entry.position
                    }
                    playbackStatus={player.state.status}
                    coverUrl={player.coverUrl}
                    {...(canStream
                      ? {
                          onActivate: (selection) =>
                            player.activate({ ...selection, source, position: entry.position }),
                        }
                      : {})}
                    onPause={player.pause}
                    onResume={player.resume}
                    {...(selection.state.active
                      ? {
                          selected: selection.state.items.some(
                            ({ id: selectedId }) => selectedId === entry.song.id,
                          ),
                          onSelect: () =>
                            selection.dispatch({
                              type: 'toggle',
                              item: { id: entry.song.id, order: entry.position },
                            }),
                        }
                      : {})}
                    {...(canManage
                      ? {
                          actions: (
                            <PlaylistOccurrenceActions
                              key={`${entry.position}:${entry.song.id}:${editError ?? 'ready'}`}
                              entry={entry}
                              count={playlist.entries.length}
                              locale={locale}
                              pending={Boolean(mutation || editError)}
                              groupRef={(node) => {
                                if (node) occurrenceRefs.current.set(entry.position, node);
                                else occurrenceRefs.current.delete(entry.position);
                              }}
                              onMove={(direction) => {
                                void editOccurrence(entry, 'move', direction);
                              }}
                              onRemove={() => {
                                void editOccurrence(entry, 'remove');
                              }}
                            />
                          ),
                        }
                      : {})}
                  />
                ))}
              </ul>
            </section>
          )}
          {overlay === 'rename' && (
            <PlaylistForm
              mode="rename"
              initialName={playlist.name}
              locale={locale}
              onDismiss={() => setOverlay(undefined)}
              onRefresh={() => {
                setOverlay(undefined);
                retry((value) => value + 1);
              }}
              onSubmit={async (name, operationId, signal) => {
                try {
                  const result = await client.rename(playlist.id, playlist.revision, name, {
                    csrfToken,
                    operationId,
                    signal,
                  });
                  setState({ key: id, playlist: result.playlist, loading: false });
                  retry((value) => value + 1);
                } catch (error) {
                  if (error instanceof PlaylistMutationError && error.current)
                    setState({ key: id, playlist: error.current, loading: false });
                  if (error instanceof ApiError && error.code === 'unauthenticated')
                    onUnauthenticated();
                  throw error;
                }
              }}
            />
          )}
          {overlay === 'delete' && (
            <DeletePlaylistConfirmation
              name={playlist.name}
              locale={locale}
              onDismiss={() => setOverlay(undefined)}
              onRefresh={() => {
                setOverlay(undefined);
                retry((value) => value + 1);
              }}
              onDelete={async (operationId, signal) => {
                try {
                  await client.delete(playlist.id, playlist.revision, {
                    csrfToken,
                    operationId,
                    signal,
                  });
                  window.history.replaceState(null, '', playlistHref(base));
                  window.dispatchEvent(new PopStateEvent('popstate'));
                } catch (error) {
                  if (error instanceof PlaylistMutationError && error.current)
                    setState({ key: id, playlist: error.current, loading: false });
                  if (error instanceof ApiError && error.code === 'unauthenticated')
                    onUnauthenticated();
                  throw error;
                }
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
