import { useCallback, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../../auth/client';
import { Action } from '../../design/components/Action';
import { TextField } from '../../design/components/TextField';
import { messages, type Locale } from '../../i18n';
import { newPlaylistOperationId } from '../operation-id';
import { useModalFocus } from './modal-focus';
import styles from './PlaylistOverlay.module.css';

export type PlaylistFormMode = 'create' | 'rename';

export function PlaylistForm({
  mode,
  initialName = '',
  locale,
  onSubmit,
  onDismiss,
  onRefresh,
}: {
  mode: PlaylistFormMode;
  initialName?: string;
  locale: Locale;
  onSubmit: (name: string, operationId: string, signal: AbortSignal) => Promise<void | boolean>;
  onDismiss: () => void;
  onRefresh?: () => void;
}) {
  const copy = messages[locale];
  const dialog = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | undefined>(undefined);
  const intent = useRef<string | undefined>(undefined);
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState('');
  const [requestError, setRequestError] = useState('');
  const dismiss = useCallback(() => {
    controller.current?.abort();
    onDismiss();
  }, [onDismiss]);
  useModalFocus(dialog, dismiss, busy);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const normalized = name.trim();
    if (!normalized) {
      setFieldError(copy['playlists.nameRequired']);
      return;
    }
    if ([...normalized].length > 255) {
      setFieldError(copy['playlists.nameTooLong']);
      return;
    }
    setFieldError('');
    setRequestError('');
    setBusy(true);
    const nextController = new AbortController();
    controller.current = nextController;
    intent.current ??= newPlaylistOperationId();
    try {
      const dismissAfterSubmit = await onSubmit(normalized, intent.current, nextController.signal);
      if (dismissAfterSubmit !== false) dismiss();
    } catch (error) {
      if (nextController.signal.aborted) return;
      const code = error instanceof ApiError ? error.code : 'internal_error';
      if (code === 'invalid_request') setFieldError(copy['playlists.nameInvalid']);
      else
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
        aria-labelledby="playlist-form-title"
      >
        <div className={styles.heading}>
          <h2 id="playlist-form-title">
            {copy[mode === 'create' ? 'playlists.createTitle' : 'playlists.rename']}
          </h2>
          <p className={styles.description}>{copy['playlists.nameHelp']}</p>
        </div>
        <form className={styles.form} onSubmit={(event) => void submit(event)}>
          <TextField
            label={copy['playlists.nameLabel']}
            name="playlist-name"
            autoComplete="off"
            value={name}
            disabled={busy}
            {...(fieldError ? { error: fieldError } : {})}
            onChange={(event) => {
              setName(event.currentTarget.value);
              setFieldError('');
              setRequestError('');
              intent.current = undefined;
            }}
          />
          {requestError && (
            <p className={styles.error} role="alert">
              {requestError}
            </p>
          )}
          <div className={styles.actions}>
            <Action variant="quiet" disabled={busy} onClick={dismiss}>
              {copy['playlists.cancel']}
            </Action>
            {requestError && onRefresh && (
              <Action variant="secondary" disabled={busy} onClick={onRefresh}>
                {copy['playlists.refresh']}
              </Action>
            )}
            <Action type="submit" busy={busy}>
              {copy[mode === 'create' ? 'playlists.create' : 'playlists.saveName']}
            </Action>
          </div>
        </form>
      </div>
    </div>
  );
}
