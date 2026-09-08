import type { ReactNode } from 'react';
import type { MetadataJob } from '@musiclatte/contracts';
import { messages, type Locale } from '../../i18n';
import styles from './MetadataJobStatus.module.css';
export function MetadataJobStatus({
  job,
  locale,
  actions,
}: {
  job: MetadataJob;
  locale: Locale;
  actions?: (item: MetadataJob['items'][number]) => ReactNode;
}) {
  const copy = messages[locale];
  return (
    <div>
      <p role="status">
        {job.kind === 'restore' && job.status === 'succeeded'
          ? copy['metadata.restored']
          : copy[`metadata.stage.${job.status}`]}
      </p>
      <p className={styles.secondary}>{copy['metadata.pendingHelp']}</p>
      {job.items.map((item, index) => (
        <section className={styles.status} key={item.itemId}>
          <h2>{copy['metadata.targetSong'].replace('{number}', String(index + 1))}</h2>
          <p>{copy[`metadata.stage.${item.stage}`]}</p>
          <p>{item.changedFields.map((field) => copy[`metadata.${field}`]).join(' · ')}</p>
          {item.fileSavedAt !== null && <p>{copy['metadata.fileSaved']}</p>}
          {item.reflectedAt !== null && <p>{copy['metadata.reflected']}</p>}
          {item.errorCode && (
            <>
              <p>{copy[`metadata.error.${item.errorCode}`]}</p>
              <p className={styles.secondary}>{copy['metadata.recoveryHelp']}</p>
            </>
          )}
          {actions?.(item)}
        </section>
      ))}
    </div>
  );
}
