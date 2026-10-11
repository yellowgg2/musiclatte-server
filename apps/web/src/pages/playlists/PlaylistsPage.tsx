import { useEffect, useMemo, useState } from 'react';
import { mediaRoutes } from '@musiclatte/contracts';
import { usePlaylistArtwork } from '../../playlists/use-playlist-artwork';
import { useMetadataSync } from '../../metadata/MetadataSyncProvider';
import type { ApiErrorCode, PlaylistDetail, PlaylistSummary } from '@musiclatte/contracts';
import { ApiError } from '../../auth/client';
import { LanguagePicker } from '../../app/LanguagePicker';
import { Action } from '../../design/components/Action';
import { StatusSurface } from '../../design/components/StatusSurface';
import { formatCount, messages, type Locale } from '../../i18n';
import { createPlaylistClient } from '../../playlists/client';
import { PlaylistCard } from '../../playlists/components/PlaylistCard';
import { PlaylistForm } from '../../playlists/components/PlaylistForm';
import styles from './Playlist.module.css';
import { useInvalidateAccountSummary } from '../../account/AccountSummaryProvider';

function countLabel(count: number, locale: Locale, key: 'playlists.count' | 'playlists.songCount') {
  const suffix = count === 1 ? '.one' : '.many';
  return messages[locale][`${key}${suffix}`].replace('{count}', formatCount(count, locale));
}

function summaryOf(playlist: PlaylistDetail): PlaylistSummary {
  return {
    id: playlist.id,
    name: playlist.name,
    owner: playlist.owner,
    songCount: playlist.songCount,
    created: playlist.created,
    changed: playlist.changed,
    duration: playlist.duration,
    public: playlist.public,
    editable: playlist.editable,
    coverState: 'fallback',
    revision: playlist.revision,
  };
}

export function PlaylistsPage({
  base,
  locale,
  onLocale,
  fetcher,
  apiOrigin,
  onUnauthenticated,
  canWrite,
  csrfToken,
}: {
  base: string;
  locale: Locale;
  onLocale: (locale: Locale) => void;
  fetcher: typeof fetch;
  apiOrigin: string;
  onUnauthenticated: () => void;
  canWrite: boolean;
  csrfToken: string;
}) {
  const client = useMemo(
    () => createPlaylistClient({ fetcher, apiOrigin }),
    [fetcher, apiOrigin, csrfToken],
  );
  const invalidateAccountSummary = useInvalidateAccountSummary();
  const [attempt, retry] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [state, setState] = useState<{
    client?: ReturnType<typeof createPlaylistClient>;
    playlists?: PlaylistSummary[];
    error?: ApiErrorCode;
    loading: boolean;
  }>({ loading: true });
  const copy = messages[locale];
  const playlists = state.client === client ? state.playlists : undefined;
  const metadata = useMetadataSync();
  const artwork = usePlaylistArtwork({
    playlists: playlists ?? [],
    client,
    generation: JSON.stringify([attempt, metadata.state.version]),
    onUnauthenticated,
  });
  const coverUrl = (id: string) =>
    metadata.client ? metadata.coverUrl(id) : `${apiOrigin}${mediaRoutes.cover(id)}`;
  useEffect(() => {
    const foreground = () => {
      if (document.visibilityState === 'visible') retry((value) => value + 1);
    };
    window.addEventListener('focus', foreground);
    document.addEventListener('visibilitychange', foreground);
    return () => {
      window.removeEventListener('focus', foreground);
      document.removeEventListener('visibilitychange', foreground);
    };
  }, []);

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    setState((previous) => ({
      ...(previous.client === client && previous.playlists
        ? { playlists: previous.playlists }
        : {}),
      client,
      loading: true,
    }));
    void client.read({ kind: 'list' }, controller.signal).then(
      (data) => {
        if (current && data.kind === 'list')
          setState({ client, playlists: data.playlists, loading: false });
      },
      (error) => {
        if (!current) return;
        const code = error instanceof ApiError ? error.code : 'internal_error';
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
  }, [attempt, client, onUnauthenticated]);

  useEffect(() => {
    document.title = `${copy['playlists.title']} · Musiclatte`;
  }, [copy]);

  return (
    <div className={styles.page}>
      <div className={styles.topline}>
        <header className={styles.heading}>
          <h1 tabIndex={-1} data-page-heading>
            {copy['playlists.title']}
          </h1>
        </header>
        <LanguagePicker locale={locale} onChange={onLocale} />
      </div>
      <div className={styles.summary}>
        <p className={styles.description}>{copy['playlists.description']}</p>
        <div className={styles.headingActions}>
          {playlists && (
            <p className={styles.count}>
              {countLabel(playlists.length, locale, 'playlists.count')}
            </p>
          )}
          {canWrite && (
            <div className={styles.headingActions}>
              <Action onClick={() => setCreateOpen(true)}>{copy['playlists.create']}</Action>
            </div>
          )}
        </div>
      </div>
      {state.loading && !playlists && (
        <StatusSurface
          state="loading"
          title={copy['playlists.loading']}
          description={copy['playlists.loadingHelp']}
        />
      )}
      {state.error && (
        <StatusSurface
          state="error"
          title={copy['playlists.error']}
          description={copy[`error.${state.error}`]}
          action={
            <Action variant="secondary" onClick={() => retry((value) => value + 1)}>
              {copy['status.retry']}
            </Action>
          }
        />
      )}
      {!state.loading && !state.error && playlists?.length === 0 && (
        <StatusSurface
          state="empty"
          title={copy['playlists.empty']}
          description={copy['playlists.emptyHelp']}
          action={
            <a className={styles.recoveryLink} href={`${base}music`}>
              {copy['playlists.browseMusic']}
            </a>
          }
        />
      )}
      {!state.error && playlists && playlists.length > 0 && (
        <ul ref={artwork.root} className={styles.list} aria-label={copy['playlists.title']}>
          {playlists.map((playlist) => (
            <PlaylistCard
              key={playlist.id}
              playlist={playlist}
              base={base}
              coverLoading={artwork.get(playlist).loading}
              {...(artwork.get(playlist).coverArt
                ? { coverSrc: coverUrl(artwork.get(playlist).coverArt!) }
                : {})}
              songCount={countLabel(playlist.songCount, locale, 'playlists.songCount')}
            />
          ))}
        </ul>
      )}
      {createOpen && (
        <PlaylistForm
          mode="create"
          locale={locale}
          onDismiss={() => setCreateOpen(false)}
          onRefresh={() => {
            setCreateOpen(false);
            retry((value) => value + 1);
          }}
          onSubmit={async (name, operationId, signal) => {
            try {
              const result = await client.create(name, { csrfToken, operationId, signal });
              const created = summaryOf(result.playlist);
              setState((previous) => ({
                client,
                playlists: [
                  ...(previous.playlists?.filter((playlist) => playlist.id !== created.id) ?? []),
                  created,
                ],
                loading: false,
              }));
              invalidateAccountSummary();
              retry((value) => value + 1);
            } catch (error) {
              if (error instanceof ApiError && error.code === 'unauthenticated')
                onUnauthenticated();
              throw error;
            }
          }}
        />
      )}
    </div>
  );
}
