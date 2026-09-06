import { useEffect, useRef, useState } from 'react';
import type { PlaylistDetail, PlaylistSummary } from '@musiclatte/contracts';
import { ApiError } from '../../auth/client';
import { Action } from '../../design/components/Action';
import { formatCount, messages, type Locale } from '../../i18n';
import { createPlaylistClient } from '../../playlists/client';
import { PlaylistForm } from '../../playlists/components/PlaylistForm';
import { useModalFocus } from '../../playlists/components/modal-focus';
import { newPlaylistOperationId } from '../../playlists/operation-id';
import { useSelection } from '../SelectionProvider';
import { appendSelectedSongs, type AppendContinuation } from '../batches';
import type { SelectionItem } from '../model';
import styles from './SelectionBar.module.css';

export function SelectionBar({
  locale,
  scopeLabel,
  pageItems,
  fetcher,
  apiOrigin,
  csrfToken,
  canWrite,
  onUnauthenticated,
  onPlaylistUpdated,
}: {
  locale: Locale;
  scopeLabel: string;
  pageItems: readonly SelectionItem[];
  fetcher: typeof fetch;
  apiOrigin: string;
  csrfToken: string;
  canWrite: boolean;
  onUnauthenticated: () => void;
  onPlaylistUpdated?: (playlist: PlaylistDetail) => void;
}) {
  const { state, dispatch } = useSelection();
  const [picker, setPicker] = useState(false);
  const copy = messages[locale];
  if (!state.active)
    return (
      <div className={styles.entry}>
        <Action variant="secondary" onClick={() => dispatch({ type: 'enter' })}>
          {copy['selection.enter']}
        </Action>
      </div>
    );

  const countKey = state.items.length === 1 ? 'selection.count.one' : 'selection.count.many';
  return (
    <>
      <section className={styles.bar} aria-label={copy['selection.actions']} data-selection-bar>
        <p role="status">
          <strong>
            {copy[countKey].replace('{count}', formatCount(state.items.length, locale))}
          </strong>
          <span>{scopeLabel}</span>
        </p>
        <div className={styles.actions}>
          <Action
            variant="quiet"
            onClick={() => dispatch({ type: 'select-page', items: [...pageItems] })}
          >
            {copy['selection.selectPage']}
          </Action>
          <Action disabled={!canWrite || state.items.length === 0} onClick={() => setPicker(true)}>
            {copy['selection.add']}
          </Action>
          <Action variant="quiet" onClick={() => dispatch({ type: 'finish' })}>
            {copy['selection.cancel']}
          </Action>
        </div>
      </section>
      {picker && (
        <PlaylistPicker
          locale={locale}
          fetcher={fetcher}
          apiOrigin={apiOrigin}
          csrfToken={csrfToken}
          onUnauthenticated={onUnauthenticated}
          onDismiss={() => setPicker(false)}
          {...(onPlaylistUpdated ? { onPlaylistUpdated } : {})}
        />
      )}
    </>
  );
}

function PlaylistPicker({
  locale,
  fetcher,
  apiOrigin,
  csrfToken,
  onUnauthenticated,
  onDismiss,
  onPlaylistUpdated,
}: {
  locale: Locale;
  fetcher: typeof fetch;
  apiOrigin: string;
  csrfToken: string;
  onUnauthenticated: () => void;
  onDismiss: () => void;
  onPlaylistUpdated?: (playlist: PlaylistDetail) => void;
}) {
  const copy = messages[locale];
  const { state, dispatch } = useSelection();
  const client = useRef(createPlaylistClient({ fetcher, apiOrigin })).current;
  const dialog = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | undefined>(undefined);
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [totalApplied, setTotalApplied] = useState(0);
  const [continuation, setContinuation] = useState<{
    playlist: PlaylistDetail;
    value: AppendContinuation;
  }>();
  useModalFocus(dialog, onDismiss, busy);

  useEffect(() => {
    const currentController = new AbortController();
    controller.current = currentController;
    const signal = currentController.signal;
    void client.read({ kind: 'list' }, signal).then(
      (data) => {
        if (data.kind !== 'list') return;
        if (!signal.aborted) {
          setPlaylists(data.playlists.filter((playlist) => playlist.editable));
          setLoading(false);
        }
      },
      (failure) => {
        if (signal.aborted) return;
        if (failure instanceof ApiError && failure.code === 'unauthenticated') onUnauthenticated();
        setError(copy['selection.targetsError']);
        setLoading(false);
      },
    );
    return () => currentController.abort();
  }, [client, copy, onUnauthenticated]);

  async function addTo(playlist: PlaylistDetail, resume?: AppendContinuation) {
    setBusy(true);
    setError('');
    const result = await appendSelectedSongs({
      songIds: state.items.map(({ id }) => id),
      expectedRevision: playlist.revision,
      operationId: newPlaylistOperationId,
      ...(resume ? { continuation: resume } : {}),
      append: async ({ expectedRevision, songIds, operationId }) => {
        const response = await client.append(playlist.id, expectedRevision, songIds, {
          csrfToken,
          operationId,
          signal: controller.current?.signal ?? AbortSignal.abort(),
        });
        onPlaylistUpdated?.(response.playlist);
        return { revision: response.playlist.revision };
      },
    });
    dispatch({ type: 'remove-applied', ids: result.appliedIds });
    const appliedCount = totalApplied + result.appliedIds.length;
    setTotalApplied(appliedCount);
    if (result.status === 'complete') {
      dispatch({ type: 'finish' });
      onDismiss();
      return;
    }
    if (result.error instanceof ApiError && result.error.code === 'unauthenticated')
      onUnauthenticated();
    setContinuation({
      playlist: { ...playlist, revision: result.revision },
      value: result.continuation,
    });
    setError(
      copy['selection.partial']
        .replace('{applied}', formatCount(appliedCount, locale))
        .replace('{failed}', formatCount(result.failedIds.length, locale))
        .replace('{unattempted}', formatCount(result.unattemptedIds.length, locale)),
    );
    setBusy(false);
  }

  async function selectTarget(target: PlaylistSummary) {
    setBusy(true);
    setError('');
    try {
      const data = await client.read(
        { kind: 'detail', id: target.id },
        controller.current?.signal ?? AbortSignal.abort(),
      );
      if (data.kind !== 'detail' || !data.playlist.editable) {
        setError(copy['selection.targetChanged']);
        setBusy(false);
        return;
      }
      await addTo(data.playlist);
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === 'unauthenticated') onUnauthenticated();
      else setError(copy['selection.targetChanged']);
      setBusy(false);
    }
  }

  if (creating)
    return (
      <PlaylistForm
        mode="create"
        locale={locale}
        onDismiss={() => setCreating(false)}
        onSubmit={async (name, operationId, signal) => {
          const created = await client.create(name, { csrfToken, operationId, signal });
          setCreating(false);
          await addTo(created.playlist);
          return false;
        }}
      />
    );

  return (
    <div className={styles.backdrop}>
      <div
        ref={dialog}
        className={styles.picker}
        role="dialog"
        aria-modal="true"
        aria-labelledby="selection-picker-title"
      >
        <div className={styles.pickerHeading}>
          <div>
            <h2 id="selection-picker-title">{copy['selection.add']}</h2>
            <p>{copy['selection.pickerHelp']}</p>
          </div>
          <Action variant="quiet" disabled={busy} onClick={onDismiss}>
            {copy['selection.cancel']}
          </Action>
        </div>
        {loading && <p role="status">{copy['selection.targetsLoading']}</p>}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {!loading && playlists.length === 0 && !error && <p>{copy['selection.noTargets']}</p>}
        {!loading && playlists.length > 0 && (
          <div
            className={styles.targetScroller}
            tabIndex={0}
            aria-label={copy['selection.targets']}
          >
            {playlists.map((playlist) => (
              <button key={playlist.id} disabled={busy} onClick={() => void selectTarget(playlist)}>
                <strong>{playlist.name}</strong>
                <span>
                  {copy['selection.targetCount'].replace(
                    '{count}',
                    formatCount(playlist.songCount, locale),
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className={styles.pickerActions}>
          {continuation && (
            <Action
              disabled={busy}
              onClick={() => void addTo(continuation.playlist, continuation.value)}
            >
              {copy['selection.retry']}
            </Action>
          )}
          <Action variant="secondary" disabled={busy} onClick={() => setCreating(true)}>
            {copy['selection.createNew']}
          </Action>
        </div>
      </div>
    </div>
  );
}
