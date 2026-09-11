import { MetadataAction } from '../../metadata/components/MetadataAction';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ApiErrorCode,
  RecentDownloadFilter,
  RecentDownloadResponse,
} from '@musiclatte/contracts';
import { LanguagePicker } from '../../app/LanguagePicker';
import { errorCode } from '../../auth/client';
import { Action } from '../../design/components/Action';
import { Artwork } from '../../design/components/Artwork';
import { TextField } from '../../design/components/TextField';
import { StatusSurface } from '../../design/components/StatusSurface';
import { formatCount, messages, type Locale } from '../../i18n';
import { MusicRow } from '../../music/components/MusicRow';
import {
  SongList,
  SongViewHeading,
  songLayout,
  useSongView,
} from '../../music/components/SongView';
import { usePlayer } from '../../player/PlayerProvider';
import { createRecentClient } from '../../recent/client';
import { appendRecent, localDateRange } from '../../recent/model';
import { SelectionBar } from '../../selection/components/SelectionBar';
import { useSelection } from '../../selection/SelectionProvider';
import { selectionScopeKey } from '../../selection/model';
import { useMetadataSync } from '../../metadata/MetadataSyncProvider';
import fields from '../../design/components/TextField.module.css';
import styles from './RecentDownloads.module.css';
import { MusicSectionNav, type MusicSectionAvailability } from './MusicSectionNav';

type RequestKind = 'initial' | 'refresh' | 'period' | 'more' | 'metadata';
export function RecentDownloadsPage({
  base,
  locale,
  onLocale,
  fetcher,
  apiOrigin,
  onUnauthenticated,
  canStream,
  canWritePlaylists,
  csrfToken,
  unavailable = false,
  onCapabilityRetry,
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
  unavailable?: boolean;
  onCapabilityRetry: () => void;
  sections: MusicSectionAvailability;
}) {
  const [songView, setSongView] = useSongView();
  const copy = messages[locale];
  const player = usePlayer();
  const metadata = useMetadataSync();
  const metadataRequested = useRef('');
  const selection = useSelection();
  const client = useMemo(() => createRecentClient({ fetcher, apiOrigin }), [fetcher, apiOrigin]);
  const [data, setData] = useState<RecentDownloadResponse>();
  const dataRef = useRef(data);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiErrorCode>();
  const [hasNew, setHasNew] = useState(false);
  const active = useRef<AbortController | undefined>(undefined);
  const probe = useRef<AbortController | undefined>(undefined);
  const scope = useRef<string | undefined>(undefined);
  const range = useRef<RecentDownloadFilter | undefined>(undefined);
  const failedRequest = useRef<{ kind: RequestKind; filter?: RecentDownloadFilter }>({
    kind: 'initial',
  });
  const moreTarget = useRef<HTMLDivElement>(null);
  const pageTarget = useRef<HTMLDivElement>(null);
  const headingTarget = useRef<HTMLHeadingElement>(null);
  const live = useRef(true);
  const unavailableRef = useRef(unavailable);
  unavailableRef.current = unavailable;
  const requestRef = useRef(request);
  requestRef.current = request;

  async function request(kind: RequestKind, filter?: RecentDownloadFilter) {
    if (active.current || unavailable) return;
    probe.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    failedRequest.current = { kind, ...(filter ? { filter } : {}) };
    setLoading(true);
    setError(undefined);
    const previous = dataRef.current;
    try {
      const query =
        kind === 'more' && previous?.nextCursor
          ? { cursor: previous.nextCursor }
          : ((kind === 'period' ? filter : range.current) ?? {});
      const page = await client.list(controller.signal, query);
      if (!live.current || controller.signal.aborted) return;
      let next = kind === 'more' && previous ? appendRecent(previous, page) : page;
      if (kind === 'metadata' && previous) {
        for (
          let pages = 0;
          next.nextCursor &&
          next.items.length < previous.items.length &&
          pages < Math.ceil(previous.items.length / 50) + 1;
          pages++
        ) {
          const more = await client.list(controller.signal, { cursor: next.nextCursor });
          if (!live.current || controller.signal.aborted) return;
          next = appendRecent(next, more);
        }
      }
      const key = selectionScopeKey({ kind: 'recent', ...next.filter, asOf: next.asOf });
      if (kind === 'period' || !scope.current) selection.dispatch({ type: 'scope', key });
      else
        selection.dispatch({
          type: 'rebase',
          key,
          order: next.items
            .flatMap((item) => (item.state === 'ready' ? [item.song] : []))
            .map((song, order) => ({ id: song.id, order })),
        });
      // A formerly ready item that is now explicitly unavailable cannot be submitted.
      const unavailableIds =
        previous?.items.flatMap((old) =>
          old.state === 'ready' &&
          next.items.some((item) => item.eventId === old.eventId && item.state !== 'ready')
            ? [old.song.id]
            : [],
        ) ?? [];
      if (unavailableIds.length)
        selection.dispatch({ type: 'remove-applied', ids: unavailableIds });
      if (kind === 'metadata' && previous) {
        const ids = new Set(
          next.items.flatMap((item) => (item.state === 'ready' ? [item.song.id] : [])),
        );
        selection.dispatch({
          type: 'remove-applied',
          ids: previous.items.flatMap((item) =>
            item.state === 'ready' && !ids.has(item.song.id) ? [item.song.id] : [],
          ),
        });
      }
      scope.current = key;
      if (kind === 'period') range.current = filter;
      dataRef.current = next;
      setData(next);
      if (kind === 'refresh' && hasNew) headingTarget.current?.focus();
      setHasNew(false);
    } catch (failure) {
      if (!live.current || controller.signal.aborted) return;
      const code = errorCode(failure);
      if (code === 'unauthenticated') onUnauthenticated();
      else setError(code);
    } finally {
      if (active.current === controller) {
        active.current = undefined;
        if (live.current) setLoading(false);
      }
    }
  }
  useEffect(() => {
    headingTarget.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (selection.state.active)
      pageTarget.current?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus();
  }, [selection.state.active]);
  useEffect(() => {
    live.current = true;
    void requestRef.current('initial');
    const check = async () => {
      if (
        document.visibilityState !== 'visible' ||
        active.current ||
        probe.current ||
        !dataRef.current ||
        unavailableRef.current
      )
        return;
      const controller = new AbortController();
      probe.current = controller;
      try {
        const page = await client.list(controller.signal, { ...range.current, limit: '1' });
        if (!controller.signal.aborted && live.current && page.items[0])
          setHasNew(page.items[0].eventId !== dataRef.current?.items[0]?.eventId);
      } catch (failure) {
        if (!controller.signal.aborted && live.current && errorCode(failure) === 'unauthenticated')
          onUnauthenticated();
      } finally {
        if (probe.current === controller) probe.current = undefined;
      }
    };
    const timer = window.setInterval(() => void check(), 30000);
    window.addEventListener('focus', check);
    return () => {
      live.current = false;
      active.current?.abort();
      active.current = undefined;
      probe.current?.abort();
      probe.current = undefined;
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
      if (scope.current) selection.dispatch({ type: 'leave', key: scope.current });
    };
  }, [client, selection.dispatch, onUnauthenticated, metadata.client]);
  useEffect(() => {
    if (!unavailable && !dataRef.current) void requestRef.current('initial');
  }, [unavailable]);
  useEffect(() => {
    if (failedRequest.current.kind === 'more')
      moreTarget.current?.scrollIntoView?.({ block: 'end' });
  }, [data]);
  useEffect(() => {
    document.title = `${copy['recent.title']} · Musiclatte`;
  }, [copy]);
  const songs = data?.items.flatMap((item) => (item.state === 'ready' ? [item.song] : [])) ?? [];
  const metadataKey = JSON.stringify(
    songs.flatMap((song) =>
      metadata.state.trackVersions.has(song.id)
        ? [[song.id, metadata.state.trackVersions.get(song.id)]]
        : [],
    ),
  );
  useEffect(() => {
    if (
      loading ||
      unavailable ||
      !data ||
      metadataKey === '[]' ||
      metadataRequested.current === metadataKey
    )
      return;
    metadataRequested.current = metadataKey;
    void requestRef.current('metadata');
  }, [metadataKey, loading, unavailable, data]);
  const source = `recent:${data?.asOf ?? ''}`;
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(value),
    );
  const blocked = error === 'forbidden' || error === 'not_found';
  return (
    <div className={styles.page} ref={pageTarget}>
      <div className={styles.topline}>
        <header className={styles.heading}>
          <h1 ref={headingTarget} tabIndex={-1} data-page-heading>
            {copy['recent.title']}
          </h1>
          <p>{copy['recent.description']}</p>
        </header>
        <LanguagePicker locale={locale} onChange={onLocale} />
      </div>
      <MusicSectionNav base={base} locale={locale} current="recent" available={sections} />
      <section className={styles.controlPanel} aria-label={copy['recent.controls']}>
        <RecentPeriodControl
          locale={locale}
          busy={loading || unavailable}
          onApply={(filter) => void request('period', filter)}
        />
        {data && (
          <p className={styles.scope}>
            {copy['recent.range']
              .replace('{from}', date(data.filter.from))
              .replace('{to}', date(data.filter.to))}
            <br />
            {copy['recent.snapshot'].replace('{date}', date(data.asOf))}
          </p>
        )}
        <div className={styles.actions}>
          <Action
            variant="quiet"
            busy={loading}
            onClick={() => (unavailable ? onCapabilityRetry() : void request('refresh'))}
          >
            {copy['recent.refresh']}
          </Action>
          {songs.length > 0 && !blocked && !selection.state.active && (
            <Action variant="secondary" onClick={() => selection.dispatch({ type: 'enter' })}>
              {copy['selection.enter']}
            </Action>
          )}
          {songs.length > 0 && canStream && !blocked && (
            <Action
              onClick={() => player.activate({ song: songs[0]!, songs, source, position: 0 })}
            >
              {copy['recent.play']}
            </Action>
          )}
        </div>
      </section>
      {hasNew && (
        <StatusSurface
          state="empty"
          title={copy['recent.new']}
          description={copy['recent.newHelp']}
          action={<Action onClick={() => void request('refresh')}>{copy['recent.showNew']}</Action>}
        />
      )}
      {loading && <p role="status">{copy['recent.loading']}</p>}
      {(error || unavailable) && (
        <StatusSurface
          state="error"
          title={copy[blocked ? 'recent.denied' : 'recent.error']}
          description={copy[blocked ? 'recent.deniedHelp' : 'recent.errorHelp']}
          action={
            blocked ? (
              <a href={`${base}music`}>{copy['recent.back']}</a>
            ) : (
              <Action
                variant="secondary"
                onClick={() =>
                  unavailableRef.current
                    ? onCapabilityRetry()
                    : void request(failedRequest.current.kind, failedRequest.current.filter)
                }
              >
                {copy['status.retry']}
              </Action>
            )
          }
        />
      )}
      {data && !data.items.length && !loading && !error && (
        <StatusSurface
          state="empty"
          title={copy['recent.empty']}
          description={copy['recent.emptyHelp']}
          action={<a href={`${base}music`}>{copy['recent.back']}</a>}
        />
      )}
      {data && !blocked && data.items.length > 0 && (
        <section className={styles.section}>
          <SongViewHeading locale={locale} view={songView} onChange={setSongView}>
            {copy['recent.order']} <span>{formatCount(data.items.length, locale)}</span>
          </SongViewHeading>
          <SongList className={styles.list} aria-label={copy['recent.order']} view={songView}>
            {data.items.map((item) => {
              if (item.state !== 'ready')
                return (
                  <li key={item.eventId} className={styles.unready}>
                    <span className={styles.artwork}>
                      <Artwork alt="" />
                    </span>
                    <div>
                      <strong>{copy[`recent.${item.state}`]}</strong>
                      <p>{copy[`recent.${item.state}Help`]}</p>
                      <time dateTime={item.downloadCompletedAt}>
                        {date(item.downloadCompletedAt)}
                      </time>
                      <Action
                        variant="quiet"
                        disabled={loading}
                        onClick={() => void request('refresh')}
                      >
                        {copy['recent.checkAgain']}
                      </Action>
                    </div>
                  </li>
                );
              const song = item.song;
              const position = songs.indexOf(song);
              return (
                <MusicRow
                  key={item.eventId}
                  song={song}
                  layout={songLayout(songView)}
                  songs={songs}
                  base={base}
                  locale={locale}
                  coverUrl={player.coverUrl}
                  current={
                    player.state.queue?.source === source &&
                    player.state.queue.position === position
                  }
                  playbackStatus={player.state.status}
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
                        selected: selection.state.items.some((i) => i.id === song.id),
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
                      <time className={styles.date} dateTime={item.downloadCompletedAt}>
                        {date(item.downloadCompletedAt)}
                      </time>
                    </>
                  }
                />
              );
            })}
          </SongList>
          <div ref={moreTarget}>
            <Action
              variant="secondary"
              aria-disabled={loading || !data.nextCursor}
              aria-busy={loading}
              onClick={() => {
                if (data.nextCursor) void request('more');
              }}
            >
              {copy['recent.more']}
            </Action>
            {!data.nextCursor && (
              <p role="status" className={styles.scope}>
                {copy['recent.allLoaded']}
              </p>
            )}
          </div>
        </section>
      )}
      {!blocked && selection.state.active && (
        <SelectionBar
          locale={locale}
          scopeLabel={copy['recent.selection']}
          pageItems={songs.map((song, order) => ({ id: song.id, order }))}
          fetcher={fetcher}
          apiOrigin={apiOrigin}
          csrfToken={csrfToken}
          canWrite={canWritePlaylists && !unavailable}
          onUnauthenticated={onUnauthenticated}
        />
      )}
    </div>
  );
}

function RecentPeriodControl({
  locale,
  busy,
  onApply,
}: {
  locale: Locale;
  busy: boolean;
  onApply: (filter?: RecentDownloadFilter) => void;
}) {
  const copy = messages[locale];
  const [period, setPeriod] = useState('7d');
  const [from, setFrom] = useState('');
  const [through, setThrough] = useState('');
  const [invalid, setInvalid] = useState(false);
  return (
    <form
      className={styles.period}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        try {
          const filter = localDateRange(from, through);
          setInvalid(false);
          onApply(filter);
        } catch {
          setInvalid(true);
          document.getElementById(!from ? 'recent-from' : 'recent-through')?.focus();
        }
      }}
    >
      <div className={fields.field}>
        <label className={fields.label} htmlFor="recent-period">
          {copy['recent.period']}
        </label>
        <select
          id="recent-period"
          className={fields.input}
          value={period}
          disabled={busy}
          onChange={(event) => {
            const value = event.target.value;
            setPeriod(value);
            setInvalid(false);
            if (value === '7d') onApply();
          }}
        >
          <option value="7d">{copy['recent.sevenDays']}</option>
          <option value="custom">{copy['recent.custom']}</option>
        </select>
      </div>
      {period === 'custom' && (
        <>
          <TextField
            id="recent-from"
            type="date"
            label={copy['recent.from']}
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setInvalid(false);
            }}
            disabled={busy}
            {...(invalid && !from ? { error: copy['recent.invalid'] } : {})}
          />
          <TextField
            id="recent-through"
            type="date"
            label={copy['recent.through']}
            value={through}
            onChange={(event) => {
              setThrough(event.target.value);
              setInvalid(false);
            }}
            disabled={busy}
            {...(invalid && from ? { error: copy['recent.invalid'] } : {})}
          />
          <Action type="submit" busy={busy}>
            {copy['recent.apply']}
          </Action>
        </>
      )}
    </form>
  );
}
