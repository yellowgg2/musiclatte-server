import { LanguagePicker } from '../../app/LanguagePicker';
import { useEffect, useMemo, useRef, useState } from 'react';
import { decodeMixInput, type MusicEntry, type SavedMix } from '@musiclatte/contracts';
import { createMixClient } from '../../mixes/client';
import { createMusicClient } from '../../music/client';
import { navigateMusic } from '../../music/navigation';
import { useMetadataSync } from '../../metadata/MetadataSyncProvider';
import { usePlayer } from '../../player/PlayerProvider';
import { MusicRow } from '../../music/components/MusicRow';
import { Action } from '../../design/components/Action';
import { TextField } from '../../design/components/TextField';
import { StatusSurface } from '../../design/components/StatusSurface';
import { SectionNav } from '../../design/components/SectionNav';
import { errorCode } from '../../auth/client';
import { messages, type Locale } from '../../i18n';
import styles from './Mixes.module.css';
import { MusicSectionNav, type MusicSectionAvailability } from './MusicSectionNav';
export function MixesPage({
  id,
  base,
  locale,
  fetcher,
  apiOrigin,
  csrfToken,
  onUnauthenticated,
  canStream,
  onLocale,
  sections,
}: {
  id?: string;
  base: string;
  locale: Locale;
  fetcher: typeof fetch;
  apiOrigin: string;
  csrfToken: string;
  onUnauthenticated(): void;
  canStream: boolean;
  onLocale?: (locale: Locale) => void;
  sections: MusicSectionAvailability;
}) {
  const copy = messages[locale];
  const player = usePlayer();
  const metadata = useMetadataSync();
  const client = useMemo(
    () => createMixClient(fetcher, apiOrigin, csrfToken),
    [fetcher, apiOrigin, csrfToken],
  );
  const music = useMemo(() => createMusicClient({ fetcher, apiOrigin }), [fetcher, apiOrigin]);
  const [mixes, setMixes] = useState<SavedMix[]>([]);
  const [saved, setSaved] = useState<SavedMix>();
  const [cursor, setCursor] = useState<string | null>(null);
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]);
  const [genres, setGenres] = useState<string[]>([]);
  const [optionsError, setOptionsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [name, setName] = useState('');
  const [root, setRoot] = useState('');
  const [genre, setGenre] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [size, setSize] = useState('50');
  const [songs, setSongs] = useState<MusicEntry[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const controller = useRef(new AbortController());
  const operation = useRef<{ fingerprint: string; id: string } | null>(null);
  function fill(mix: SavedMix) {
    setSaved(mix);
    setName(mix.name);
    setRoot(mix.conditions.musicFolderId ?? '');
    setGenre(mix.conditions.genre ?? '');
    setFrom(mix.conditions.fromYear?.toString() ?? '');
    setTo(mix.conditions.toYear?.toString() ?? '');
    setSize(String(mix.conditions.size));
  }
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setError('');
    setOptionsError(false);
    void Promise.all([client.folders(abort.signal), client.genres(abort.signal)]).then(
      ([roots, tags]) => {
        if (!abort.signal.aborted) {
          setFolders(roots);
          setGenres(tags);
        }
      },
      () => {
        if (!abort.signal.aborted) setOptionsError(true);
      },
    );
    void (
      id
        ? client.get(id, abort.signal).then((mix) => {
            if (!abort.signal.aborted) fill(mix);
          })
        : client.list(abort.signal).then((page) => {
            if (!abort.signal.aborted) {
              setMixes(page.mixes);
              setCursor(page.nextCursor);
            }
          })
    )
      .catch((reason) => {
        if (!abort.signal.aborted) {
          if (errorCode(reason) === 'unauthenticated') onUnauthenticated();
          else setError(errorCode(reason));
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [client, id, attempt, onUnauthenticated]);
  const refreshKey = JSON.stringify(
    (songs ?? []).flatMap((song) =>
      metadata.state.trackVersions.has(song.id)
        ? [[song.id, metadata.state.trackVersions.get(song.id)]]
        : [],
    ),
  );
  useEffect(() => {
    const abort = new AbortController();
    const ids = (JSON.parse(refreshKey) as [string, number][]).map(([songId]) => songId);
    void Promise.all(
      ids.map(async (songId) => {
        try {
          const fresh = await music.song(songId, abort.signal);
          if (!abort.signal.aborted)
            setSongs(
              (previous) => previous?.map((song) => (song.id === fresh.id ? fresh : song)) ?? null,
            );
        } catch (reason) {
          if (!abort.signal.aborted && errorCode(reason) === 'unauthenticated') onUnauthenticated();
        }
      }),
    );
    return () => abort.abort();
  }, [refreshKey, music, onUnauthenticated]);
  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    const signal = controller.current.signal;
    try {
      await work(signal);
    } catch (reason) {
      if (!signal.aborted) {
        const code = errorCode(reason);
        if (code === 'unauthenticated') onUnauthenticated();
        else {
          setError(code);
          if (code === 'conflict') {
            operation.current = null;
            if (id) {
              try {
                const latest = await client.get(id, signal);
                if (!signal.aborted) fill(latest);
              } catch {
                /* original conflict stays visible */
              }
            }
          }
        }
      }
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  function operationId(body: object) {
    const fingerprint = JSON.stringify(body);
    if (operation.current?.fingerprint !== fingerprint)
      operation.current = { fingerprint, id: crypto.randomUUID() };
    return operation.current.id;
  }
  function save() {
    void run(async (signal) => {
      let input;
      try {
        input = decodeMixInput({
          name,
          conditions: {
            size: Number(size),
            ...(root ? { musicFolderId: root } : {}),
            ...(genre ? { genre } : {}),
            ...(from ? { fromYear: Number(from) } : {}),
            ...(to ? { toYear: Number(to) } : {}),
          },
        });
      } catch {
        setError('invalid_request');
        return;
      }
      const body = { ...input, ...(saved ? { expectedRevision: saved.revision } : {}) };
      const result = await client.save(id, { ...body, operationId: operationId(body) }, signal);
      if (signal.aborted) return;
      operation.current = null;
      fill(result);
      setSongs(null);
      setNotice(copy['mix.saved']);
      if (!id) navigateMusic(`${base}music/mixes/${encodeURIComponent(result.id)}`);
    });
  }
  return (
    <section className={styles.page}>
      <div className={styles.topline}>
        <header className={styles.heading}>
          <h1 tabIndex={-1} data-page-heading>
            {saved?.name ?? copy['mix.title']}
          </h1>
          <p>{copy['mix.help']}</p>
        </header>
        {onLocale && <LanguagePicker locale={locale} onChange={onLocale} />}
      </div>
      {id && (
        <SectionNav
          label={copy['music.breadcrumb']}
          variant="breadcrumb"
          items={[
            { label: copy['music.all'], href: `${base}music` },
            { label: copy['mix.title'], href: `${base}music/mixes` },
            { label: saved?.name ?? copy['mix.title'], current: true },
          ]}
        />
      )}
      <MusicSectionNav base={base} locale={locale} current="mixes" available={sections} />
      {loading ? (
        <StatusSurface
          state="loading"
          title={copy['status.loading']}
          description={copy['status.loadingHelp']}
        />
      ) : (
        <>
          {!id && (
            <section aria-label={copy['mix.title']}>
              {mixes.length ? (
                <ul className={styles.list}>
                  {mixes.map((mix) => (
                    <li key={mix.id}>
                      <a href={`${base}music/mixes/${mix.id}`}>{mix.name}</a>
                      <span>
                        {mix.conditions.size} {copy['mix.songs']}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{copy['mix.empty']}</p>
              )}
              {cursor && (
                <Action
                  disabled={busy}
                  onClick={() =>
                    void run(async (signal) => {
                      const page = await client.list(signal, cursor);
                      if (!signal.aborted) {
                        setMixes((previous) => [...previous, ...page.mixes]);
                        setCursor(page.nextCursor);
                      }
                    })
                  }
                >
                  {copy['mix.more']}
                </Action>
              )}
            </section>
          )}
          <form
            className={styles.form}
            aria-label={copy['mix.conditions']}
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <TextField
              label={copy['mix.name']}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
            <label>
              {copy['mix.root']}
              <select
                value={root}
                onChange={(event) => setRoot(event.target.value)}
                disabled={optionsError}
              >
                <option value="">{copy['mix.allRoots']}</option>
                {root && !folders.some((folder) => folder.id === root) && (
                  <option value={root}>{root}</option>
                )}
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {copy['mix.genre']}
              <select
                value={genre}
                onChange={(event) => setGenre(event.target.value)}
                disabled={optionsError}
              >
                <option value="">{copy['mix.allGenres']}</option>
                {genre && !genres.includes(genre) && <option value={genre}>{genre}</option>}
                {genres.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </label>
            <TextField
              label={copy['mix.from']}
              type="number"
              min={0}
              max={9999}
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
            <TextField
              label={copy['mix.to']}
              type="number"
              min={0}
              max={9999}
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
            <TextField
              label={copy['mix.size']}
              type="number"
              min={1}
              max={500}
              value={size}
              onChange={(event) => setSize(event.target.value)}
              required
            />
            <p className={styles.help}>{copy['mix.scopeHelp']}</p>
            <div className={styles.actions}>
              <Action type="submit" busy={busy}>
                {copy['mix.save']}
              </Action>
              {id && (
                <Action
                  type="button"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  {copy['mix.delete']}
                </Action>
              )}
            </div>
          </form>
          {optionsError && (
            <p role="alert">
              {copy['mix.optionsError']}{' '}
              <Action onClick={() => setAttempt((n) => n + 1)}>{copy['status.retry']}</Action>
            </p>
          )}
          {confirmDelete && id && saved && (
            <div className={styles.actions}>
              <p>{copy['mix.deleteHelp']}</p>
              <Action
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  void run(async (signal) => {
                    const body = { expectedRevision: saved.revision, action: 'delete' };
                    await client.remove(
                      id,
                      { expectedRevision: saved.revision, operationId: operationId(body) },
                      signal,
                    );
                    if (!signal.aborted) navigateMusic(`${base}music/mixes`);
                  })
                }
              >
                {copy['mix.confirmDelete']}
              </Action>
              <Action variant="secondary" onClick={() => setConfirmDelete(false)}>
                {copy['mix.cancel']}
              </Action>
            </div>
          )}
          {id && (
            <section className={styles.resultPanel} aria-label={copy['mix.results']}>
              <div className={styles.resultActions}>
                <Action
                  variant="secondary"
                  busy={busy}
                  onClick={() =>
                    void run(async (signal) => {
                      const result = await client.songs(id, signal);
                      if (!signal.aborted) setSongs(result);
                    })
                  }
                >
                  {songs === null ? copy['mix.draw'] : copy['mix.redraw']}
                </Action>
                <div className={styles.playbackActions}>
                  <Action
                    disabled={!canStream || !songs?.length || busy}
                    onClick={() => {
                      if (songs?.length) player.activate({ song: songs[0]!, songs, source: 'mix' });
                    }}
                  >
                    {copy['mix.play']}
                  </Action>
                  <Action
                    variant="secondary"
                    disabled={!canStream || !songs?.length || busy}
                    onClick={() => {
                      if (songs?.length) {
                        player.appendSongs(songs);
                        setNotice(copy['mix.added']);
                      }
                    }}
                  >
                    {copy['mix.append']}
                  </Action>
                </div>
              </div>
              {songs?.length === 0 && <p role="status">{copy['mix.noSongs']}</p>}
              <ul className={styles.results}>
                {songs?.map((song) => (
                  <MusicRow
                    key={song.id}
                    song={song}
                    songs={songs}
                    locale={locale}
                    base={base}
                    current={player.state.current?.id === song.id}
                    playbackStatus={player.state.status}
                    coverUrl={player.coverUrl}
                    {...(canStream ? { onActivate: player.activate } : {})}
                    onPause={player.pause}
                    onResume={player.resume}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {error && (
        <div role="alert">
          <p>
            {
              copy[
                error === 'conflict'
                  ? 'mix.conflict'
                  : error === 'invalid_request'
                    ? 'mix.invalid'
                    : 'mix.error'
              ]
            }
          </p>
          <Action disabled={busy} onClick={() => setAttempt((n) => n + 1)}>
            {copy['status.retry']}
          </Action>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
