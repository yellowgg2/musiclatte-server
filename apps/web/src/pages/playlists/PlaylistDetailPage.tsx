import { useEffect, useMemo, useState } from 'react';
import type { ApiErrorCode, PlaylistDetail } from '@musiclatte/contracts';
import { ApiError } from '../../auth/client';
import { LanguagePicker } from '../../app/LanguagePicker';
import { Action } from '../../design/components/Action';
import { Artwork } from '../../design/components/Artwork';
import { StatusSurface } from '../../design/components/StatusSurface';
import { formatCount, messages, type Locale } from '../../i18n';
import { MusicRow } from '../../music/components/MusicRow';
import { createPlaylistClient } from '../../playlists/client';
import { playlistHref } from '../../playlists/routes';
import { usePlayer } from '../../player/PlayerProvider';
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
}: {
  id: string;
  base: string;
  locale: Locale;
  onLocale: (locale: Locale) => void;
  fetcher: typeof fetch;
  apiOrigin: string;
  onUnauthenticated: () => void;
  canStream: boolean;
}) {
  const player = usePlayer();
  const client = useMemo(() => createPlaylistClient({ fetcher, apiOrigin }), [fetcher, apiOrigin]);
  const [attempt, retry] = useState(0);
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

  useEffect(() => {
    document.title = `${playlist?.name ?? copy['playlists.title']} · Musiclatte`;
  }, [copy, playlist?.name]);

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
              <h1 tabIndex={-1} data-page-heading>
                {playlist.name}
              </h1>
              <p className={styles.meta}>{songCountLabel(playlist.songCount, locale)}</p>
              {canStream && songs.length > 0 && (
                <div className={styles.headingActions}>
                  <Action
                    onClick={() => player.activate({ song: songs[0]!, songs, source, position: 0 })}
                  >
                    {copy['playlists.play']}
                  </Action>
                </div>
              )}
            </div>
          </header>
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
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
