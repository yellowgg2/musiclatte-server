import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type {
  MetadataJob,
  MetadataSnapshot,
  MetadataPatch,
  MetadataRestorePreview,
} from '@musiclatte/contracts';
import type { MetadataClient } from '../client';
import { Action } from '../../design/components/Action';
import { ApiError } from '../../auth/client';
import { messages, type Locale } from '../../i18n';
import { newPlaylistOperationId } from '../../playlists/operation-id';
import { useMetadataFocus } from '../modal-focus';
import { MetadataJobStatus } from './MetadataJobStatus';
import { MetadataConflict } from './MetadataConflict';
import { MetadataRestoreConfirmation } from './MetadataRestoreConfirmation';
import overlay from './MetadataOverlay.module.css';
import styles from './MetadataRecovery.module.css';
type Props = {
  job: MetadataJob;
  locale: Locale;
  client: MetadataClient;
  csrfToken: string;
  onSubmitted: (job: MetadataJob) => void;
  onUnauthenticated: () => void;
  onRefresh: () => void;
  onEdit: (snapshot: MetadataSnapshot) => void;
  canEdit?: boolean;
};
export function MetadataRecovery(props: Props) {
  return (
    <MetadataJobStatus
      job={props.job}
      locale={props.locale}
      actions={(item) => <RecoveryItem key={item.itemId} {...props} item={item} />}
    />
  );
}
function RecoveryItem({ item, ...props }: Props & { item: MetadataJob['items'][number] }) {
  const copy = messages[props.locale];
  const [mode, setMode] = useState<'conflict' | 'restore'>();
  const close = useCallback(() => setMode(undefined), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(false);
  const operation = useRef<string>(undefined);
  const lifecycle = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    return () => controller.abort();
  }, [props.client, props.job.id, item.itemId]);
  async function recheck() {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError('');
    operation.current ??= newPlaylistOperationId();
    try {
      await props.client.recheck(
        props.job.id,
        { operationId: operation.current, itemIds: [item.itemId] },
        { csrfToken: props.csrfToken, signal: lifecycle.current.signal },
      );
      if (!lifecycle.current.signal.aborted) {
        operation.current = undefined;
        props.onRefresh();
      }
    } catch (reason) {
      if (lifecycle.current.signal.aborted) return;
      if (reason instanceof ApiError && reason.code === 'unauthenticated')
        props.onUnauthenticated();
      else
        setError(
          reason instanceof ApiError && reason.code === 'forbidden'
            ? 'metadata.recoveryDenied'
            : 'metadata.uncertain',
        );
    } finally {
      active.current = false;
      if (!lifecycle.current.signal.aborted) setBusy(false);
    }
  }
  const canRecheck = item.fileSavedAt !== null && item.recoveryActions.includes('recheck');
  const canConflict =
    props.canEdit !== false &&
    item.stage === 'conflict' &&
    item.fileSavedAt === null &&
    item.recoveryActions.includes('refresh');
  return (
    <>
      <div className={styles.actions}>
        {canRecheck && (
          <Action variant="secondary" busy={busy} onClick={() => void recheck()}>
            {copy['metadata.recheckAction']}
          </Action>
        )}
        {canConflict && (
          <Action variant="secondary" onClick={() => setMode('conflict')}>
            {copy['metadata.reloadCurrent']}
          </Action>
        )}
        {item.restoreAvailable && (
          <Action variant="secondary" onClick={() => setMode('restore')}>
            {copy['metadata.restoreReview']}
          </Action>
        )}
      </div>
      {canRecheck && <p>{copy['metadata.recheckHelp']}</p>}
      {error && <p role="alert">{copy[error as 'metadata.uncertain']}</p>}
      {mode && <RecoveryDialog {...props} item={item} mode={mode} onClose={close} />}
    </>
  );
}
function RecoveryDialog({
  item,
  mode,
  onClose,
  ...props
}: Props & {
  item: MetadataJob['items'][number];
  mode: 'conflict' | 'restore';
  onClose: () => void;
}) {
  const copy = messages[props.locale];
  const title = copy[mode === 'restore' ? 'metadata.restoreReview' : 'metadata.reloadCurrent'];
  const id = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const [review, setReview] = useState<
    { snapshot: MetadataSnapshot; patch: MetadataPatch } | MetadataRestorePreview
  >();
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const active = useRef(false);
  const lifecycle = useRef(new AbortController());
  const operation = useRef(newPlaylistOperationId());
  useMetadataFocus(dialog, onClose, busy);
  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    setBusy(true);
    setReview(undefined);
    setError('');
    setUncertain(false);
    operation.current = newPlaylistOperationId();
    async function prepare() {
      try {
        if (mode === 'restore') {
          const result = await props.client.restorePreview(
            props.job.id,
            item.itemId,
            controller.signal,
          );
          if (result.current.trackId !== item.currentTrackId) throw new Error('Identity mismatch');
          if (!controller.signal.aborted) setReview(result);
        } else {
          const intent = await props.client.intent(props.job.id, item.itemId, controller.signal);
          if (intent.targets.length !== 1 || intent.targets[0]!.trackId !== item.currentTrackId)
            throw new Error('Identity mismatch');
          const snapshot = await props.client.read(item.currentTrackId, controller.signal);
          if (!controller.signal.aborted) setReview({ snapshot, patch: intent.patch });
        }
      } catch (reason) {
        if (controller.signal.aborted) return;
        if (reason instanceof ApiError && reason.code === 'unauthenticated')
          props.onUnauthenticated();
        else
          setError(
            reason instanceof ApiError && reason.code === 'forbidden'
              ? 'metadata.recoveryDenied'
              : 'metadata.restorePreviewFailed',
          );
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }
    void prepare();
    return () => controller.abort();
  }, [
    mode,
    attempt,
    props.client,
    props.job.id,
    item.itemId,
    item.currentTrackId,
    props.onUnauthenticated,
  ]);
  async function confirm() {
    if (!review || active.current) return;
    if ('snapshot' in review) {
      if (review.snapshot.editable) {
        onClose();
        props.onEdit(review.snapshot);
      }
      return;
    }
    active.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await props.client.restore(
        props.job.id,
        {
          operationId: operation.current,
          itemId: item.itemId,
          currentExpectedRevision: review.current.fileRevision,
        },
        { csrfToken: props.csrfToken, signal: lifecycle.current.signal },
      );
      if (!lifecycle.current.signal.aborted) {
        onClose();
        props.onSubmitted(result);
      }
    } catch (reason) {
      if (lifecycle.current.signal.aborted) return;
      if (reason instanceof ApiError && reason.code === 'unauthenticated')
        props.onUnauthenticated();
      else if (reason instanceof ApiError && ['conflict', 'forbidden'].includes(reason.code)) {
        setReview(undefined);
        setError(
          reason.code === 'conflict' ? 'metadata.recoveryConflict' : 'metadata.recoveryDenied',
        );
      } else {
        setUncertain(true);
        setError('metadata.uncertain');
      }
    } finally {
      active.current = false;
      if (!lifecycle.current.signal.aborted) setBusy(false);
    }
  }
  return (
    <div className={overlay.backdrop}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className={overlay.panel}
      >
        <header className={overlay.heading}>
          <h2 id={id}>{title}</h2>
        </header>
        <div role="region" aria-label={title} tabIndex={0} className={overlay.content}>
          {error && <p role="alert">{copy[error as 'metadata.uncertain']}</p>}
          {review &&
            ('snapshot' in review ? (
              <MetadataConflict {...review} locale={props.locale} />
            ) : (
              <MetadataRestoreConfirmation preview={review} locale={props.locale} />
            ))}
          {review && 'snapshot' in review && !review.snapshot.editable && (
            <p>{copy['metadata.readonly']}</p>
          )}
          <p role="status">{busy ? copy[review ? 'metadata.saving' : 'metadata.checking'] : ''}</p>
        </div>
        <footer className={overlay.footer}>
          <Action variant="quiet" disabled={busy} onClick={onClose}>
            {copy['metadata.cancel']}
          </Action>
          {!review && !busy && (
            <Action variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
              {copy['metadata.reloadCurrent']}
            </Action>
          )}
          {review && (
            <Action
              busy={busy}
              disabled={'snapshot' in review && !review.snapshot.editable}
              onClick={() => void confirm()}
            >
              {
                copy[
                  uncertain
                    ? 'metadata.resend'
                    : mode === 'restore'
                      ? 'metadata.restoreTitle'
                      : 'metadata.editCurrent'
                ]
              }
            </Action>
          )}
        </footer>
      </div>
    </div>
  );
}
