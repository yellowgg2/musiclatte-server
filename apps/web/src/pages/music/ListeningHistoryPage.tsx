import { useEffect, useMemo, useRef, useState } from 'react';
import { Action } from '../../design/components/Action';
import { StatusSurface } from '../../design/components/StatusSurface';
import { LanguagePicker } from '../../app/LanguagePicker';
import { MusicRow } from '../../music/components/MusicRow';
import { createMusicClient } from '../../music/client';
import { useMetadataSync } from '../../metadata/MetadataSyncProvider';
import { usePlayer } from '../../player/PlayerProvider';
import { createListeningReader, listeningRange, type ListeningRow } from '../../listening/state';
import { errorCode } from '../../auth/client';
import { messages, type Locale } from '../../i18n';
import styles from './Listening.module.css';
export function ListeningHistoryPage({
  kind,
  locale,
  base,
  fetcher,
  apiOrigin,
  onUnauthenticated,
  onLocale,
  canStream,
}: {
  kind: 'history' | 'top';
  locale: Locale;
  base: string;
  fetcher: typeof fetch;
  apiOrigin: string;
  onUnauthenticated(): void;
  onLocale?: (locale: Locale) => void;
  canStream: boolean;
}) {
  const copy = messages[locale];
  const player = usePlayer();
  const metadata = useMetadataSync();
  const reader = useMemo(() => createListeningReader(fetcher, apiOrigin), [fetcher, apiOrigin]);
  const music = useMemo(() => createMusicClient({ fetcher, apiOrigin }), [fetcher, apiOrigin]);
  const [preset, setPreset] = useState<'all' | '7' | '30'>('all');
  const [refresh, setRefresh] = useState(0);
  const range = useMemo(() => listeningRange(preset), [preset, refresh]);
  const [rows, setRows] = useState<ListeningRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState('');
  const [moreError, setMoreError] = useState('');
  const [notice, setNotice] = useState('');
  const controller = useRef(new AbortController());
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setMoreLoading(false);
    setError('');
    setMoreError('');
    setRows([]);
    setCursor(null);
    void reader
      .page(kind, range, abort.signal)
      .then(
        (page) => {
          if (!abort.signal.aborted) {
            setRows(page.rows);
            setCursor(page.nextCursor);
          }
        },
        (reason) => {
          if (!abort.signal.aborted) {
            if (errorCode(reason) === 'unauthenticated') onUnauthenticated();
            else setError(errorCode(reason));
          }
        },
      )
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [kind, range, reader, onUnauthenticated]);
  useEffect(() => {
    const updated = () => setRefresh((value) => value + 1);
    window.addEventListener('musiclatte:listening-recorded', updated);
    return () => window.removeEventListener('musiclatte:listening-recorded', updated);
  }, []);
  const versions = JSON.stringify(
    [...new Set(rows.map((row) => row.songId))].flatMap((id) =>
      metadata.state.trackVersions.has(id) ? [[id, metadata.state.trackVersions.get(id)]] : [],
    ),
  );
  useEffect(() => {
    const abort = new AbortController();
    void Promise.all(
      (JSON.parse(versions) as [string, number][]).map(async ([id]) => {
        try {
          const song = await music.song(id, abort.signal);
          if (!abort.signal.aborted)
            setRows((previous) =>
              previous.map((row) => (row.songId === id ? { ...row, song } : row)),
            );
        } catch (reason) {
          if (!abort.signal.aborted && errorCode(reason) === 'unauthenticated') onUnauthenticated();
        }
      }),
    );
    return () => abort.abort();
  }, [versions, music, onUnauthenticated]);
  async function more() {
    if (!cursor || moreLoading) return;
    setMoreLoading(true);
    setMoreError('');
    const signal = controller.current.signal;
    try {
      const page = await reader.page(kind, range, signal, cursor);
      if (!signal.aborted) {
        setRows((previous) => {
          const seen = new Set(previous.map((row) => row.key));
          return [...previous, ...page.rows.filter((row) => !seen.has(row.key))];
        });
        setCursor(page.nextCursor);
      }
    } catch (reason) {
      if (!signal.aborted) {
        if (errorCode(reason) === 'unauthenticated') onUnauthenticated();
        else setMoreError(errorCode(reason));
      }
    } finally {
      if (!signal.aborted) setMoreLoading(false);
    }
  }
  const songs = rows.flatMap((row) => (row.song ? [row.song] : []));
  const title = copy[kind === 'history' ? 'listening.history' : 'listening.top'];
  const date = (time: string) =>
    new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(time));
  return (
    <section className={styles.page}>
      <header>
        {onLocale && <LanguagePicker locale={locale} onChange={onLocale} />}
        <a href={`${base}music`}>{copy['music.all']}</a>
        <h1 data-page-heading tabIndex={-1}>
          {title}
        </h1>
        <p>{copy['listening.scope']}</p>
        <nav aria-label={copy['listening.navigation']}>
          <a href={`${base}music/history`} aria-current={kind === 'history' ? 'page' : undefined}>
            {copy['listening.history']}
          </a>
          <a href={`${base}music/top`} aria-current={kind === 'top' ? 'page' : undefined}>
            {copy['listening.top']}
          </a>
        </nav>
      </header>
      <div className={styles.actions}>
        <label>
          {copy['listening.period']}
          <select
            value={preset}
            onChange={(event) => setPreset(event.target.value as 'all' | '7' | '30')}
          >
            <option value="all">{copy['listening.all']}</option>
            <option value="7">{copy['listening.week']}</option>
            <option value="30">{copy['listening.month']}</option>
          </select>
        </label>
        <Action onClick={() => setRefresh((n) => n + 1)}>{copy['listening.refresh']}</Action>
        <Action
          disabled={!canStream || !songs.length || loading}
          onClick={() => player.activate({ song: songs[0]!, songs, source: `listening-${kind}` })}
        >
          {copy['mix.play']}
        </Action>
        <Action
          disabled={!canStream || !songs.length || loading}
          onClick={() => {
            player.appendSongs(songs);
            setNotice(copy['mix.added']);
          }}
        >
          {copy['mix.append']}
        </Action>
      </div>
      {player.listening.pending > 0 && <p role="status">{copy['listening.saving']}</p>}
      {(player.listening.failed > 0 || player.listening.dropped > 0) && (
        <p role="status">{copy['listening.recordError']}</p>
      )}
      {loading ? (
        <StatusSurface
          state="loading"
          title={copy['status.loading']}
          description={copy['status.loadingHelp']}
        />
      ) : error ? (
        <div role="alert">
          <p>{copy['listening.error']}</p>
          <Action onClick={() => setRefresh((n) => n + 1)}>{copy['status.retry']}</Action>
        </div>
      ) : rows.length === 0 ? (
        <p role="status">{copy['listening.empty']}</p>
      ) : (
        <ul className={styles.list} aria-label={title}>
          {rows.map((row, index) => (
            <li key={row.key} data-listening-event={row.key}>
              <div className={styles.detail}>
                <time dateTime={row.time}>{date(row.time)}</time>
                {row.count !== undefined && (
                  <span>{copy['listening.count'].replace('{count}', String(row.count))}</span>
                )}
              </div>
              {row.song ? (
                <ul className={styles.song}>
                  <MusicRow
                    song={row.song}
                    songs={songs}
                    locale={locale}
                    base={base}
                    coverUrl={player.coverUrl}
                    current={player.state.current?.id === row.songId}
                    playbackStatus={player.state.status}
                    {...(canStream
                      ? {
                          onActivate: (activation) =>
                            player.activate({
                              ...activation,
                              position: rows.slice(0, index).filter((item) => item.song).length,
                            }),
                        }
                      : {})}
                    onPause={player.pause}
                    onResume={player.resume}
                  />
                </ul>
              ) : (
                <div className={styles.missing}>
                  <p>{copy['listening.missing']}</p>
                  <Action disabled>{copy['mix.play']}</Action>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {moreError && (
        <div role="alert">
          <p>
            {
              copy[
                moreError === 'invalid_request' ? 'listening.cursorError' : 'listening.moreError'
              ]
            }
          </p>
          <Action
            disabled={moreLoading}
            onClick={() =>
              moreError === 'invalid_request' ? setRefresh((n) => n + 1) : void more()
            }
          >
            {copy[moreError === 'invalid_request' ? 'listening.refresh' : 'status.retry']}
          </Action>
        </div>
      )}
      {cursor && !loading && !error && (
        <Action busy={moreLoading} onClick={() => void more()}>
          {copy['listening.more']}
        </Action>
      )}
      {notice && <p role="status">{notice}</p>}
      <details>
        <summary>{copy['listening.helpTitle']}</summary>
        <p>{copy['listening.help']}</p>
        <p>{copy['listening.upstreamHelp']}</p>
        {player.listening.lastStatus === 'uncertain' && <p>{copy['listening.uncertain']}</p>}
      </details>
    </section>
  );
}
