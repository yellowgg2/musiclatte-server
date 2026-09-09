import { useEffect, useState } from 'react';
import {
  curationFields,
  type CurationTrack,
  type CurationDetail,
  type ApiErrorCode,
} from '@musiclatte/contracts';
import { messages, type Locale } from '../../i18n';
import { errorCode } from '../../auth/client';
import { Action } from '../../design/components/Action';
import { useMetadataSync } from '../MetadataSyncProvider';
import { useMetadataUI } from '../MetadataUIProvider';
import styles from '../../pages/music/CurationPage.module.css';
export function CurationStatus({
  track,
  locale,
  detail,
}: {
  track: CurationTrack;
  locale: Locale;
  detail?: CurationDetail;
}) {
  const copy = messages[locale];
  const date = (value: number) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(value);
  return (
    <section className={styles.status} aria-label={copy['curation.status']}>
      <strong>{copy[`curation.state.${track.curationStatus}`]}</strong>
      <span>{copy[`curation.validation.${track.validation}`]}</span>
      <p>{copy['curation.independent']}</p>
      <dl className={styles.fields}>
        {curationFields.map((field) => (
          <div key={field}>
            <dt>
              {copy[`metadata.${field}`]} ·{' '}
              {
                copy[
                  field === 'title' || field === 'artist'
                    ? 'curation.required'
                    : 'curation.optional'
                ]
              }
            </dt>
            <dd>
              {copy[`curation.field.${track.fieldStates[field].status}`]}
              {track.fieldStates[field].lastAttemptAt !== null && (
                <p>
                  {copy['curation.attempt']} {date(track.fieldStates[field].lastAttemptAt!)}
                </p>
              )}
              {track.fieldStates[field].reason && (
                <p>
                  {copy['curation.reason']}: {track.fieldStates[field].reason}
                </p>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {track.lastVerifiedAt !== null && (
        <p>
          {copy['curation.verifiedAt']} {date(track.lastVerifiedAt)}
        </p>
      )}
      {detail?.activeClaim && (
        <p role="status">
          {
            copy[
              detail.activeClaim.purpose === 'optional_enrichment'
                ? 'curation.optionalActive'
                : 'curation.requiredActive'
            ]
          }
        </p>
      )}
      {!!detail?.activeWork.length && <p role="status">{copy['curation.workPending']}</p>}
      {track.receipt && (
        <details>
          <summary>{copy['curation.receipt']}</summary>
          <p>
            {copy['curation.completedBy']}:{' '}
            {track.receipt.completedBy.clientLabel ?? track.receipt.completedBy.username}
          </p>
          <p>{date(track.receipt.completedAt)}</p>
          {track.receipt.sourceNotes && <p>{track.receipt.sourceNotes}</p>}
        </details>
      )}
    </section>
  );
}
export function CurationInspector({ trackId }: { trackId: string }) {
  const sync = useMetadataSync();
  const ui = useMetadataUI();
  const copy = messages[ui.locale];
  const [detail, setDetail] = useState<CurationDetail | null>(null);
  const [error, setError] = useState<ApiErrorCode | null>(null);
  const [attempt, retry] = useState(0);
  useEffect(() => {
    setDetail(null);
    setError(null);
    if (!ui.canCuration || !sync.curationClient) return;
    const controller = new AbortController();
    void sync.curationClient.detail(trackId, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setDetail(value);
      },
      (cause) => {
        if (controller.signal.aborted) return;
        const code = errorCode(cause);
        setError(code);
        if (code === 'unauthenticated') ui.onUnauthenticated();
      },
    );
    return () => controller.abort();
  }, [
    sync.curationClient,
    sync.state.version,
    trackId,
    attempt,
    ui.canCuration,
    ui.onUnauthenticated,
  ]);
  if (!ui.canCuration) return null;
  return detail ? (
    <CurationStatus track={detail.track} detail={detail} locale={ui.locale} />
  ) : (
    <section className={styles.status}>
      <p role={error ? 'alert' : 'status'}>
        {error ? copy[`error.${error}`] : copy['curation.loading']}
      </p>
      {error && (
        <Action variant="quiet" onClick={() => retry((v) => v + 1)}>
          {copy['status.retry']}
        </Action>
      )}
    </section>
  );
}
