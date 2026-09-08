import { MetadataRecovery } from '../../metadata/components/MetadataRecovery';
import { MetadataRetry } from '../../metadata/components/MetadataRetry';
import { useEffect, useState } from 'react';
import type { MetadataJob } from '@musiclatte/contracts';
import { Action } from '../../design/components/Action';
import { StatusSurface } from '../../design/components/StatusSurface';
import { messages } from '../../i18n';
import { ApiError } from '../../auth/client';
import { useMetadataSync } from '../../metadata/MetadataSyncProvider';
import { useMetadataUI } from '../../metadata/MetadataUIProvider';
import { MetadataJobStatus } from '../../metadata/components/MetadataJobStatus';
import styles from './MetadataJobs.module.css';
export function MetadataJobPage({ jobId }: { jobId: string }) {
  const ui = useMetadataUI();
  const sync = useMetadataSync();
  const copy = messages[ui.locale];
  const [job, setJob] = useState<MetadataJob>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setJob(undefined);
    setError(false);
    if (!ui.canHistory || !sync.client) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (document.visibilityState !== 'visible') {
        timer = setTimeout(() => void poll(), 3000);
        return;
      }
      try {
        const result = await sync.client!.detail(jobId, controller.signal);
        if (controller.signal.aborted) return;
        setJob(result);
        setError(false);
        if (['queued', 'running', 'reflecting'].includes(result.status))
          timer = setTimeout(() => void poll(), 3000);
        else sync.refresh();
      } catch (reason) {
        if (controller.signal.aborted) return;
        if (reason instanceof ApiError && reason.code === 'unauthenticated') ui.onUnauthenticated();
        else setError(true);
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [jobId, attempt, sync.client, ui.canHistory, ui.onUnauthenticated, sync.refresh]);
  useEffect(() => {
    document.title = `${copy['metadata.job']} · Musiclatte`;
  }, [copy]);
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <h1 data-page-heading tabIndex={-1}>
          {copy['metadata.job']}
        </h1>
        <Action variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
          {copy['metadata.reload']}
        </Action>
      </header>
      <div className={styles.links}>
        <a href={`${ui.base}metadata-jobs`}>{copy['metadata.history']}</a>
        <a href={`${ui.base}music`}>{copy['metadata.backMusic']}</a>
      </div>
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
          {!job && !error && <p role="status">{copy['metadata.checking']}</p>}
          {job && ui.canEdit && sync.client && (
            <MetadataRetry
              key={job.id}
              job={job}
              locale={ui.locale}
              client={sync.client}
              csrfToken={ui.csrfToken}
              onSubmitted={ui.accept}
              onUnauthenticated={ui.onUnauthenticated}
            />
          )}
          {job &&
            (sync.client ? (
              <MetadataRecovery
                job={job}
                locale={ui.locale}
                client={sync.client}
                csrfToken={ui.csrfToken}
                onSubmitted={ui.accept}
                onUnauthenticated={ui.onUnauthenticated}
                onRefresh={() => setAttempt((n) => n + 1)}
                onEdit={ui.open}
                canEdit={ui.canEdit}
              />
            ) : (
              <MetadataJobStatus job={job} locale={ui.locale} />
            ))}
        </>
      )}
    </div>
  );
}
