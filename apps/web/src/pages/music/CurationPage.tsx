import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { MusicEntry, ApiErrorCode } from '@musiclatte/contracts';
import { createCurationClient } from '../../curation/client';
import {
  applyCurationResponse,
  curationQuery,
  emptyCurationFilters,
  initialCurationState,
  type CurationFilters,
} from '../../curation/state';
import { createMusicClient } from '../../music/client';
import { MusicRow } from '../../music/components/MusicRow';
import { MetadataAction } from '../../metadata/components/MetadataAction';
import { CurationInspector } from '../../metadata/components/CurationStatus';
import { useMetadataSync } from '../../metadata/MetadataSyncProvider';
import { usePlayer } from '../../player/PlayerProvider';
import { Action } from '../../design/components/Action';
import { StatusSurface } from '../../design/components/StatusSurface';
import { LanguagePicker } from '../../app/LanguagePicker';
import { messages, type Locale } from '../../i18n';
import { errorCode } from '../../auth/client';
import styles from './CurationPage.module.css';
import { MusicSectionNav, type MusicSectionAvailability } from './MusicSectionNav';
export function CurationPage({
  base,
  locale,
  onLocale,
  fetcher,
  apiOrigin,
  canStream,
  onUnauthenticated,
  sections,
}: {
  base: string;
  locale: Locale;
  onLocale: (locale: Locale) => void;
  fetcher: typeof fetch;
  apiOrigin: string;
  canStream: boolean;
  onUnauthenticated: () => void;
  sections: MusicSectionAvailability;
}) {
  const copy = messages[locale];
  const player = usePlayer();
  const sync = useMetadataSync();
  const client = useMemo(() => createCurationClient({ fetcher, apiOrigin }), [fetcher, apiOrigin]);
  const music = useMemo(() => createMusicClient({ fetcher, apiOrigin }), [fetcher, apiOrigin]);
  const [filters, setFilters] = useState<CurationFilters>(emptyCurationFilters);
  const [state, setState] = useState(initialCurationState);
  const [attempt, retry] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [playError, setPlayError] = useState<ApiErrorCode | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);
  const sequence = useRef(0);
  const request = useRef<AbortController | null>(null);
  const playing = useRef<AbortController | null>(null);
  const loading = useRef(false);
  const callbacks = useRef({ onUnauthenticated });
  callbacks.current = { onUnauthenticated };
  const query = useMemo(() => curationQuery(filters), [filters]);
  async function load(more = false) {
    if (more && (loading.current || !state.data?.nextCursor)) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    loading.current = true;
    const generation = ++sequence.current;
    setState((previous) => ({
      ...previous,
      generation,
      loading: true,
      error: null,
      ...(!more ? { data: null } : {}),
    }));
    const params = new URLSearchParams(query);
    params.set('limit', '25');
    if (more && state.data?.nextCursor) params.set('cursor', state.data.nextCursor);
    try {
      const page = await client.list(params, controller.signal);
      if (controller.signal.aborted) return;
      setState((previous) => applyCurationResponse(previous, page, generation, more));
    } catch (cause) {
      if (controller.signal.aborted) return;
      const code = errorCode(cause);
      if (code === 'unauthenticated') callbacks.current.onUnauthenticated();
      setState((previous) => ({
        ...previous,
        loading: false,
        error: code,
        ...(['forbidden', 'snapshot_expired', 'snapshot_scope_changed'].includes(code)
          ? { data: null }
          : {}),
      }));
    } finally {
      if (!controller.signal.aborted) loading.current = false;
    }
  }
  useEffect(() => {
    setExpanded(null);
    void load();
    return () => request.current?.abort();
  }, [client, query, attempt, sync.state.version, sync.client]);
  useEffect(() => () => playing.current?.abort(), []);
  useEffect(() => {
    document.title = `${copy['curation.title']} · Musiclatte`;
  }, [copy]);
  const date = (value: number) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(value);
  const data = state.data;
  const pending = data?.coverage.some((item) => item.status !== 'ready');
  function filter<K extends keyof CurationFilters>(key: K, value: CurationFilters[K]) {
    request.current?.abort();
    sequence.current++;
    setState({ ...initialCurationState, generation: sequence.current });
    setFilters((previous) => ({
      ...previous,
      [key]: value,
      ...(key === 'field' ? { fieldStatus: value ? previous.fieldStatus || 'missing' : '' } : {}),
    }));
  }
  async function play(id: string) {
    playing.current?.abort();
    const controller = new AbortController();
    playing.current = controller;
    setPlayError(null);
    try {
      const song = await music.song(id, controller.signal);
      if (!controller.signal.aborted) player.activate({ song, songs: [song], source: 'curation' });
    } catch (cause) {
      if (controller.signal.aborted) return;
      const code = errorCode(cause);
      if (code === 'unauthenticated') onUnauthenticated();
      else setPlayError(code);
    }
  }
  return (
    <div className={styles.page}>
      <div className={styles.topline}>
        <header className={styles.heading}>
          <h1 ref={heading} tabIndex={-1} data-page-heading>
            {copy['curation.title']}
          </h1>
          <p>{copy['curation.description']}</p>
        </header>
        <LanguagePicker locale={locale} onChange={onLocale} />
      </div>
      <MusicSectionNav base={base} locale={locale} current="curation" available={sections} />
      <section className={styles.filterPanel} aria-label={copy['curation.filters']}>
        <h2>{copy['curation.filters']}</h2>
        <div className={styles.filters}>
          <label>
            {copy['curation.library']}
            <select value={filters.libraryId} onChange={(e) => filter('libraryId', e.target.value)}>
              <option value="">{copy['curation.all']}</option>
              {[
                ...new Set([
                  ...(data?.coverage.map((c) => c.libraryId) ?? []),
                  ...(filters.libraryId ? [filters.libraryId] : []),
                ]),
              ].map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <label>
            {copy['curation.format']}
            <select
              value={filters.format}
              onChange={(e) => filter('format', e.target.value as CurationFilters['format'])}
            >
              <option value="">{copy['curation.all']}</option>
              <option value="mp3">MP3</option>
              <option value="unsupported">{copy['curation.unsupportedFormat']}</option>
            </select>
          </label>
          <label>
            {copy['curation.status']}
            <select
              value={filters.curationStatus}
              onChange={(e) =>
                filter('curationStatus', e.target.value as CurationFilters['curationStatus'])
              }
            >
              <option value="">{copy['curation.all']}</option>
              {(['unreviewed', 'needs_review', 'in_progress', 'completed'] as const).map(
                (value) => (
                  <option key={value} value={value}>
                    {copy[`curation.state.${value}`]}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            {copy['curation.optionalField']}
            <select
              value={filters.field}
              onChange={(e) => filter('field', e.target.value as CurationFilters['field'])}
            >
              <option value="">{copy['curation.all']}</option>
              {(['album', 'cover', 'lyrics'] as const).map((value) => (
                <option key={value} value={value}>
                  {copy[`metadata.${value}`]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {copy['curation.fieldStatus']}
            <select
              disabled={!filters.field}
              value={filters.fieldStatus}
              onChange={(e) =>
                filter('fieldStatus', e.target.value as CurationFilters['fieldStatus'])
              }
            >
              <option value="">{copy['curation.all']}</option>
              {(['unknown', 'missing', 'present', 'unavailable', 'not_applicable'] as const).map(
                (value) => (
                  <option key={value} value={value}>
                    {copy[`curation.field.${value}`]}
                  </option>
                ),
              )}
            </select>
          </label>
        </div>
        <div className={styles.actions}>
          <Action variant="secondary" disabled={state.loading} onClick={() => retry((v) => v + 1)}>
            {copy['curation.refresh']}
          </Action>
          <p>{copy['curation.snapshotHelp']}</p>
        </div>
      </section>
      {state.loading && !data && (
        <StatusSurface
          state="loading"
          title={copy['curation.loading']}
          description={copy['status.loadingHelp']}
        />
      )}
      {state.error && (
        <StatusSurface
          state="error"
          title={copy['status.error']}
          description={copy[`error.${state.error}`]}
          action={<Action onClick={() => retry((v) => v + 1)}>{copy['curation.restart']}</Action>}
        />
      )}
      {playError && <p role="alert">{copy[`error.${playError}`]}</p>}
      {data && (
        <>
          <section className={styles.summaryPanel} aria-label={copy['curation.coverage']}>
            <h2>{copy['curation.coverage']}</h2>
            <p className={styles.resultCount} role="status">
              {copy['curation.count']
                .replace('{shown}', String(data.tracks.length))
                .replace('{total}', String(data.total))}{' '}
              · {copy['curation.asOf']} {date(data.asOf)}
            </p>
            <ul className={styles.coverage}>
              {data.coverage.map((item) => (
                <li key={item.libraryId}>
                  <strong>{item.libraryId}</strong>
                  <span>{copy[`curation.coverage.${item.status}`]}</span>
                  <span>
                    {copy['curation.coverageCount']
                      .replace('{found}', String(item.discoveredCount))
                      .replace('{verified}', String(item.verifiedCount))
                      .replace('{unknown}', String(item.unknownCount))}
                  </span>
                </li>
              ))}
            </ul>
            {pending && <p role="status">{copy['curation.inventoryPending']}</p>}
          </section>
          {!data.tracks.length && (
            <StatusSurface
              state="empty"
              title={copy['curation.empty']}
              description={copy[pending ? 'curation.inventoryPending' : 'curation.emptyHelp']}
            />
          )}
          <ul className={styles.list} aria-label={copy['curation.tracks']}>
            {data.tracks.map((track) => {
              const song: MusicEntry = {
                id: track.trackId,
                title: track.title ?? copy['metadata.empty'],
                artist: track.artist.join(' / '),
                isDir: false,
              };
              return (
                <Fragment key={track.trackId}>
                  <MusicRow
                    song={song}
                    locale={locale}
                    base={base}
                    current={player.state.current?.id === song.id}
                    playbackStatus={player.state.status}
                    onPause={player.pause}
                    onResume={player.resume}
                    {...(canStream ? { onActivate: () => void play(song.id) } : {})}
                    actions={<MetadataAction song={song} />}
                  />
                  <li className={styles.rowStatus}>
                    <div className={styles.rowSummary}>
                      <p>
                        {copy[`curation.state.${track.curationStatus}`]} · {copy['metadata.lyrics']}
                        : {copy[`curation.field.${track.lyricsState}`]} ·{' '}
                        {copy[`curation.validation.${track.validation}`]}
                      </p>
                      <Action
                        variant="quiet"
                        aria-label={copy['curation.details'].replace('{title}', song.title)}
                        aria-expanded={expanded === track.trackId}
                        onClick={() =>
                          setExpanded(expanded === track.trackId ? null : track.trackId)
                        }
                      >
                        {copy['curation.detailsShort']}
                      </Action>
                    </div>
                    {expanded === track.trackId && <CurationInspector trackId={track.trackId} />}
                  </li>
                </Fragment>
              );
            })}
          </ul>
          {data.nextCursor && (
            <Action variant="secondary" busy={state.loading} onClick={() => void load(true)}>
              {copy['curation.more']}
            </Action>
          )}
        </>
      )}
    </div>
  );
}
