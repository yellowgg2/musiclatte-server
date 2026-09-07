import { useEffect, useRef, useState } from 'react';
import type { MetadataJob } from '@musiclatte/contracts';
import { Action } from '../../design/components/Action';
import { StatusSurface } from '../../design/components/StatusSurface';
import { messages } from '../../i18n';
import { ApiError } from '../../auth/client';
import { useMetadataSync } from '../../metadata/MetadataSyncProvider';
import { useMetadataUI } from '../../metadata/MetadataUIProvider';
import styles from './MetadataJobs.module.css';
export function MetadataJobsPage() {
  const ui = useMetadataUI();
  const sync = useMetadataSync();
  const copy = messages[ui.locale];
  const [jobs, setJobs] = useState<MetadataJob[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const request = useRef<AbortController | undefined>(undefined);
  async function load(nextCursor?: string) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (!ui.canHistory || !sync.client) return;
    setBusy(true);
    setError(false);
    try {
      const result = await sync.client.list(controller.signal, nextCursor);
      if (!controller.signal.aborted) {
        setJobs((previous) =>
          nextCursor
            ? [
                ...previous,
                ...result.jobs.filter(
                  (job) => !previous.some((existing) => existing.id === job.id),
                ),
              ]
            : result.jobs,
        );
        setCursor(result.nextCursor);
      }
    } catch (reason) {
      if (controller.signal.aborted) return;
      if (reason instanceof ApiError && reason.code === 'unauthenticated') ui.onUnauthenticated();
      else setError(true);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  useEffect(() => {
    setJobs([]);
    setCursor(null);
    void load();
    return () => request.current?.abort();
  }, [attempt, sync.client, ui.canHistory]);
  useEffect(() => {
    document.title = `${copy['metadata.history']} · Musiclatte`;
  }, [copy]);
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <h1 data-page-heading tabIndex={-1}>
          {copy['metadata.history']}
        </h1>
        <Action variant="secondary" busy={busy} onClick={() => setAttempt((value) => value + 1)}>
          {copy['metadata.reload']}
        </Action>
      </header>
      <a href={`${ui.base}music`}>{copy['metadata.backMusic']}</a>
      {!ui.canHistory ? (
        <p>{copy['metadata.unavailable']}</p>
      ) : (
        <>
          {error && (
            <StatusSurface
              state="error"
              title={copy['metadata.readFailed']}
              description={copy['metadata.retry']}
            />
          )}
          {busy && !jobs.length && <p role="status">{copy['metadata.checking']}</p>}
          {!busy && !error && !jobs.length && <p>{copy['metadata.emptyJobs']}</p>}
          <ul className={styles.list}>
            {jobs.map((job) => (
              <li key={job.id}>
                <a href={`${ui.base}metadata-jobs/${encodeURIComponent(job.id)}`}>
                  {copy['metadata.job']} ·{' '}
                  {new Intl.DateTimeFormat(ui.locale, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(job.createdAt)}
                </a>
                <p>
                  {copy[`metadata.stage.${job.status}`]} ·{' '}
                  {copy['metadata.targetCount'].replace('{count}', String(job.items.length))}
                </p>
              </li>
            ))}
          </ul>
          {cursor && (
            <Action variant="secondary" busy={busy} onClick={() => void load(cursor)}>
              {copy['metadata.more']}
            </Action>
          )}
        </>
      )}
    </div>
  );
}
