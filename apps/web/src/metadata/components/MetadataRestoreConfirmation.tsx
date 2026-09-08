import {
  metadataFields,
  type MetadataRestorePreview,
  type MetadataField,
} from '@musiclatte/contracts';
import { messages, type Locale } from '../../i18n';
import styles from './MetadataRecovery.module.css';
export function MetadataRestoreConfirmation({
  preview,
  locale,
}: {
  preview: MetadataRestorePreview;
  locale: Locale;
}) {
  const copy = messages[locale];
  const current = {
    ...preview.current.values,
    lyrics: preview.current.lyricsFrames,
    cover: preview.currentCovers,
  };
  const original = {
    ...preview.original.values,
    lyrics: preview.original.lyricsFrames,
    cover: preview.original.covers,
  };
  const fields = metadataFields.filter(
    (field) => JSON.stringify(current[field]) !== JSON.stringify(original[field]),
  );
  const display = (field: MetadataField, source: typeof current) =>
    field === 'lyrics'
      ? source.lyrics
          .map((f) => `${f.selector.language} · ${f.selector.description}\n${f.text}`)
          .join('\n\n') || copy['metadata.empty']
      : field === 'cover'
        ? source.cover.map((f) => `${f.pictureType} · ${f.description || f.mimeType}`).join('\n') ||
          copy['metadata.empty']
        : (Array.isArray(source[field])
            ? (source[field] as string[]).join(' · ')
            : String(source[field] ?? '')) || copy['metadata.empty'];
  return (
    <div className={styles.comparison}>
      <p>
        {copy['metadata.title']}: {preview.current.values.title || copy['metadata.empty']}
      </p>
      <p>{copy['metadata.restoreIntro']}</p>
      <p>
        {copy['metadata.backupTime']}: {new Date(preview.backupCreatedAt).toLocaleString(locale)}
      </p>
      <p>
        {copy['metadata.revision']}: {preview.current.fileRevision}
      </p>
      {!fields.length && <p>{copy['metadata.noDifference']}</p>}
      {fields.map((field) => (
        <section key={field}>
          <h3>{copy[`metadata.${field}`]}</h3>
          <strong>{copy['metadata.current']}</strong>
          <p>{display(field, current)}</p>
          <strong>{copy['metadata.original']}</strong>
          <p>{display(field, original)}</p>
          {field === 'cover' && <p>{copy['metadata.changedCover']}</p>}
        </section>
      ))}
    </div>
  );
}
