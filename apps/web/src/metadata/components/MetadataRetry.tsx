import { useEffect, useId, useRef, useState } from 'react';
import type { MetadataJob, MetadataPatch, MetadataSnapshot } from '@musiclatte/contracts';
import { Action } from '../../design/components/Action';
import { messages, type Locale } from '../../i18n';
import { ApiError } from '../../auth/client';
import { newPlaylistOperationId } from '../../playlists/operation-id';
import type { MetadataClient } from '../client';
import { retryTargets } from '../bulk';
import { patchSummary } from '../patch-summary';
import { useMetadataFocus } from '../modal-focus';
import styles from './MetadataOverlay.module.css';
type Review = {
  operationId: string;
  entries: { itemId: string; snapshot: MetadataSnapshot; patch: MetadataPatch }[];
};
export function MetadataRetry({
  job,
  locale,
  client,
  csrfToken,
  onSubmitted,
  onUnauthenticated,
}: {
  job: MetadataJob;
  locale: Locale;
  client: MetadataClient;
  csrfToken: string;
  onSubmitted: (job: MetadataJob) => void;
  onUnauthenticated: () => void;
}) {
  const copy = messages[locale];
  const candidates = retryTargets(job);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  if (done || !candidates.length) return null;
  return (
    <>
      <Action variant="secondary" onClick={() => setOpen(true)}>
        {copy['metadata.retryReview']}
      </Action>
      {open && (
        <RetryDialog
          job={job}
          locale={locale}
          client={client}
          csrfToken={csrfToken}
          onClose={() => setOpen(false)}
          onUnauthenticated={onUnauthenticated}
          onSubmitted={(result) => {
            setDone(true);
            setOpen(false);
            onSubmitted(result);
          }}
        />
      )}
    </>
  );
}
function RetryDialog({
  job,
  locale,
  client,
  csrfToken,
  onSubmitted,
  onUnauthenticated,
  onClose,
}: Parameters<typeof MetadataRetry>[0] & { onClose: () => void }) {
  const copy = messages[locale];
  const id = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const [review, setReview] = useState<Review>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const active = useRef(false);
  const lifecycle = useRef(new AbortController());
  useMetadataFocus(dialog, onClose, busy);
  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    async function prepare() {
      try {
        const entries: Review['entries'] = [];
        for (const item of retryTargets(job)) {
          const intent = await client.intent(job.id, item.itemId, controller.signal);
          if (intent.targets.length !== 1 || intent.targets[0]!.trackId !== item.currentTrackId)
            throw new Error('Intent mismatch');
          const snapshot = await client.read(item.currentTrackId, controller.signal);
          if (!snapshot.editable) throw new Error('Unavailable');
          await client.preview(
            {
              targets: [{ trackId: snapshot.trackId, expectedRevision: snapshot.fileRevision }],
              patch: intent.patch,
            },
            { csrfToken, signal: controller.signal },
          );
          entries.push({ itemId: item.itemId, snapshot, patch: intent.patch });
        }
        if (!controller.signal.aborted)
          setReview({ operationId: newPlaylistOperationId(), entries });
      } catch (reason) {
        if (controller.signal.aborted) return;
        if (reason instanceof ApiError && reason.code === 'unauthenticated') onUnauthenticated();
        else setError('metadata.retryPrepareFailed');
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }
    void prepare();
    return () => controller.abort();
  }, [job, client, csrfToken, onUnauthenticated]);
  async function submit() {
    if (!review || active.current) return;
    active.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await client.retry(
        job.id,
        {
          operationId: review.operationId,
          items: review.entries.map((entry) => ({
            itemId: entry.itemId,
            expectedRevision: entry.snapshot.fileRevision,
          })),
        },
        { csrfToken, signal: lifecycle.current.signal },
      );
      if (!lifecycle.current.signal.aborted) onSubmitted(result);
    } catch (reason) {
      if (lifecycle.current.signal.aborted) return;
      if (reason instanceof ApiError && reason.code === 'unauthenticated') onUnauthenticated();
      else {
        setUncertain(true);
        setError('metadata.uncertain');
      }
    } finally {
      active.current = false;
      if (!lifecycle.current.signal.aborted) setBusy(false);
    }
  }
  return (
    <div className={styles.backdrop}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className={styles.panel}
      >
        <header className={styles.heading}>
          <h2 id={id}>{copy['metadata.retryReview']}</h2>
          <p>{copy['metadata.retryIntro']}</p>
        </header>
        <div
          role="region"
          aria-label={copy['metadata.retryReview']}
          tabIndex={0}
          className={styles.content}
        >
          {error && <p role="alert">{copy[error as 'metadata.uncertain']}</p>}
          {review?.entries.map((entry) => (
            <section key={entry.itemId} className={styles.field}>
              <h3>{entry.snapshot.values.title || copy['metadata.empty']}</h3>
              <p className={styles.current}>
                {copy['metadata.revision']}: {entry.snapshot.fileRevision}
              </p>
              <ul className={styles.summary}>
                {patchSummary(entry.patch, locale).map((change) => (
                  <li key={change.field}>
                    <strong>{change.label}</strong>
                    <p>
                      {copy['metadata.current']}:{' '}
                      {String(
                        entry.snapshot.values[change.field as keyof typeof entry.snapshot.values] ??
                          copy['metadata.empty'],
                      )}
                    </p>
                    <p>{change.value}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p role="status">{busy ? copy[review ? 'metadata.saving' : 'metadata.checking'] : ''}</p>
        </div>
        <footer className={styles.footer}>
          <Action variant="quiet" disabled={busy} onClick={onClose}>
            {copy['metadata.cancel']}
          </Action>
          {review && (
            <Action busy={busy} onClick={() => void submit()}>
              {copy[uncertain ? 'metadata.resend' : 'metadata.retrySubmit']}
            </Action>
          )}
        </footer>
      </div>
    </div>
  );
}
