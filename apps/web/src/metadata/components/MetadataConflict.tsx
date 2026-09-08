import type { MetadataPatch, MetadataSnapshot } from '@musiclatte/contracts';
import { messages, type Locale } from '../../i18n';
import { patchSummary } from '../patch-summary';
import styles from './MetadataRecovery.module.css';
export function MetadataConflict({
  snapshot,
  patch,
  locale,
}: {
  snapshot: MetadataSnapshot;
  patch: MetadataPatch;
  locale: Locale;
}) {
  const copy = messages[locale];
  return (
    <div className={styles.comparison}>
      <p>{copy['metadata.conflictIntro']}</p>
      <p>
        {copy['metadata.revision']}: {snapshot.fileRevision}
      </p>
      {patchSummary(patch, locale).map((change) => (
        <section key={change.field}>
          <h3>{change.label}</h3>
          <strong>{copy['metadata.current']}</strong>
          <p>
            {change.field === 'lyrics'
              ? snapshot.lyricsFrames
                  .map((f) => `${f.selector.language} · ${f.selector.description}\n${f.text}`)
                  .join('\n\n') || copy['metadata.empty']
              : change.field === 'cover'
                ? snapshot.coverFrames.map((f) => f.description || f.mimeType).join(' · ') ||
                  copy['metadata.empty']
                : String(
                    snapshot.values[change.field as keyof typeof snapshot.values] ??
                      copy['metadata.empty'],
                  )}
          </p>
          <strong>{copy['metadata.submitted']}</strong>
          <p>{change.value}</p>
        </section>
      ))}
    </div>
  );
}
