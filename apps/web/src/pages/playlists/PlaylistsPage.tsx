import { useEffect, useMemo, useState } from 'react';
import type { ApiErrorCode, PlaylistSummary } from '@musiclatte/contracts';
import { ApiError } from '../../auth/client';
import { LanguagePicker } from '../../app/LanguagePicker';
import { Action } from '../../design/components/Action';
import { StatusSurface } from '../../design/components/StatusSurface';
import { formatCount, messages, type Locale } from '../../i18n';
import { createPlaylistClient } from '../../playlists/client';
import { PlaylistCard } from '../../playlists/components/PlaylistCard';
import styles from './Playlist.module.css';

function countLabel(count: number, locale: Locale, key: 'playlists.count' | 'playlists.songCount') {
  const suffix = count === 1 ? '.one' : '.many';
  return messages[locale][`${key}${suffix}`].replace('{count}', formatCount(count, locale));
}

export function PlaylistsPage({
  base,
  locale,
  onLocale,
  fetcher,
  apiOrigin,
  onUnauthenticated,
}: {
  base: string;
  locale: Locale;
  onLocale: (locale: Locale) => void;
  fetcher: typeof fetch;
  apiOrigin: string;
  onUnauthenticated: () => void;
}) {
  const client = useMemo(() => createPlaylistClient({ fetcher, apiOrigin }), [fetcher, apiOrigin]);
  const [attempt, retry] = useState(0);
  const [state, setState] = useState<{
    playlists?: PlaylistSummary[];
    error?: ApiErrorCode;
    loading: boolean;
  }>({ loading: true });
  const copy = messages[locale];

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    setState((previous) => ({
      ...(previous.playlists ? { playlists: previous.playlists } : {}),
      loading: true,
    }));
    void client.read({ kind: 'list' }, controller.signal).then(
      (data) => {
        if (current && data.kind === 'list')
          setState({ playlists: data.playlists, loading: false });
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
        <p className={styles.eyebrow}>{copy['playlists.eyebrow']}</p>
        <LanguagePicker locale={locale} onChange={onLocale} />
      </div>
      <header className={styles.heading}>
        <h1 tabIndex={-1} data-page-heading>
          {copy['playlists.title']}
        </h1>
        <p className={styles.description}>{copy['playlists.description']}</p>
        {state.playlists && (
          <p className={styles.count}>
            {countLabel(state.playlists.length, locale, 'playlists.count')}
          </p>
        )}
      </header>
      {state.loading && !state.playlists && (
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
      {!state.loading && !state.error && state.playlists?.length === 0 && (
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
      {!state.error && state.playlists && state.playlists.length > 0 && (
        <ul className={styles.list} aria-label={copy['playlists.title']}>
          {state.playlists.map((playlist) => (
            <PlaylistCard
              key={playlist.id}
              playlist={playlist}
              base={base}
              songCount={countLabel(playlist.songCount, locale, 'playlists.songCount')}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
