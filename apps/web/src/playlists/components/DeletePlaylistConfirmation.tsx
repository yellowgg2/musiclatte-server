import { useCallback, useRef, useState } from 'react';
import { ApiError } from '../../auth/client';
import { Action } from '../../design/components/Action';
import { messages, type Locale } from '../../i18n';
import { newPlaylistOperationId } from '../operation-id';
import { useModalFocus } from './modal-focus';
import styles from './PlaylistOverlay.module.css';

export function DeletePlaylistConfirmation({
  name,
  locale,
  onDelete,
  onDismiss,
  onRefresh,
}: {
  name: string;
  locale: Locale;
  onDelete: (operationId: string, signal: AbortSignal) => Promise<void>;
  onDismiss: () => void;
  onRefresh: () => void;
}) {
  const copy = messages[locale];
  const dialog = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | undefined>(undefined);
  const intent = useRef<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [requestError, setRequestError] = useState('');
  const dismiss = useCallback(() => {
    controller.current?.abort();
    onDismiss();
  }, [onDismiss]);
  useModalFocus(dialog, dismiss, busy);

  async function remove() {
    setBusy(true);
    setRequestError('');
    const nextController = new AbortController();
    controller.current = nextController;
    intent.current ??= newPlaylistOperationId();
    try {
      await onDelete(intent.current, nextController.signal);
    } catch (error) {
      if (nextController.signal.aborted) return;
      const code = error instanceof ApiError ? error.code : 'internal_error';
      setRequestError(
        code === 'conflict'
          ? copy['playlists.conflict']
          : code === 'outcome_unknown'
            ? copy['playlists.outcomeUnknown']
            : copy[`error.${code}`],
      );
    } finally {
      if (!nextController.signal.aborted) setBusy(false);
    }
  }

  return (
    <div className={styles.backdrop}>
      <div
        ref={dialog}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-playlist-title"
        aria-describedby="delete-playlist-impact"
      >
        <div className={styles.heading}>
          <h2 id="delete-playlist-title">{copy['playlists.delete']}</h2>
          <p>{copy['playlists.deleteQuestion']}</p>
        </div>
        <p className={styles.target}>
          <strong>{name}</strong>
        </p>
        <p id="delete-playlist-impact" className={styles.impact}>
          {copy['playlists.deleteImpact']}
        </p>
        {requestError && (
          <p className={styles.error} role="alert">
            {requestError}
          </p>
        )}
        <div className={styles.actions}>
          <Action variant="quiet" disabled={busy} onClick={dismiss}>
            {copy['playlists.cancel']}
          </Action>
          {requestError && (
            <Action variant="secondary" disabled={busy} onClick={onRefresh}>
              {copy['playlists.refresh']}
            </Action>
          )}
          <Action variant="destructive" busy={busy} onClick={() => void remove()}>
            {copy['playlists.delete']}
          </Action>
        </div>
      </div>
    </div>
  );
}
