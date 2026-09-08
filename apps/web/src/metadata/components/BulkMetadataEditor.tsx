import { useEffect, useId, useRef, useState } from 'react';
import type { MetadataJob, MetadataSnapshot } from '@musiclatte/contracts';
import { Action } from '../../design/components/Action';
import { messages, type Locale } from '../../i18n';
import { ApiError } from '../../auth/client';
import type { MetadataClient } from '../client';
import { uniqueTargets } from '../bulk';
import { useMetadataFocus } from '../modal-focus';
import { MetadataEditor } from './MetadataEditor';
import styles from './MetadataOverlay.module.css';
type Target = { id: string; snapshot?: MetadataSnapshot; libraryId?: string; reason?: string };
export function BulkMetadataEditor({
  ids,
  occurrenceCount,
  fields,
  locale,
  client,
  csrfToken,
  apiOrigin,
  onClose,
  onSubmitted,
  onUnauthenticated,
}: {
  ids: readonly string[];
  occurrenceCount: number;
  fields: readonly string[];
  locale: Locale;
  client: MetadataClient;
  csrfToken: string;
  apiOrigin: string;
  onClose: () => void;
  onSubmitted: (job: MetadataJob) => void;
  onUnauthenticated: () => void;
}) {
  const copy = messages[locale];
  const [targets, setTargets] = useState<Target[]>();
  const [excluded, setExcluded] = useState(false);
  const [library, setLibrary] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify(ids);
  useEffect(() => {
    const controller = new AbortController();
    setTargets(undefined);
    setExcluded(false);
    setLibrary(undefined);
    async function read() {
      const result: Target[] = [];
      let unique: string[];
      try {
        unique = uniqueTargets(ids);
      } catch {
        setTargets([{ id: '', reason: 'limit' }]);
        return;
      }
      for (const id of unique) {
        if (controller.signal.aborted) return;
        try {
          const snapshot = await client.read(id, controller.signal);
          if (!snapshot.editable) {
            result.push({ id, snapshot, reason: snapshot.reason ?? 'read_only' });
            continue;
          }
          const scope = await client.preview(
            {
              targets: [{ trackId: id, expectedRevision: snapshot.fileRevision }],
              patch: {
                title: snapshot.values.title
                  ? { op: 'set', value: snapshot.values.title }
                  : { op: 'clear' },
              },
            },
            { csrfToken, signal: controller.signal },
          );
          result.push({ id, snapshot, libraryId: scope.libraryId });
        } catch (error) {
          if (controller.signal.aborted) return;
          if (error instanceof ApiError && error.code === 'unauthenticated') {
            onUnauthenticated();
            return;
          }
          result.push({ id, reason: 'file_unavailable' });
        }
      }
      if (!controller.signal.aborted) setTargets(result);
    }
    void read();
    return () => controller.abort();
  }, [key, client, csrfToken, onUnauthenticated, attempt]);
  const blocked = targets?.filter((item) => item.reason) ?? [];
  const groups = [
    ...new Set(targets?.flatMap((item) => (item.libraryId ? [item.libraryId] : [])) ?? []),
  ];
  const selected =
    targets
      ?.filter((item) => item.libraryId === library && item.snapshot)
      .map((item) => item.snapshot!) ?? [];
  if (library && selected.length)
    return (
      <MetadataEditor
        snapshot={selected[0]!}
        bulk={{
          snapshots: selected,
          occurrenceCount,
          fields,
          excluded: targets!
            .filter((item) => item.libraryId !== library)
            .map((item) => item.snapshot?.values.title || item.id),
        }}
        locale={locale}
        client={client}
        csrfToken={csrfToken}
        apiOrigin={apiOrigin}
        canLyrics={false}
        onClose={onClose}
        onSubmitted={onSubmitted}
        onUnauthenticated={onUnauthenticated}
      />
    );
  return (
    <TargetPicker locale={locale} onClose={onClose}>
      {!targets ? (
        <p role="status">{copy['metadata.checking']}</p>
      ) : (
        <>
          <p>
            {copy['metadata.occurrences']
              .replace('{count}', String(occurrenceCount))
              .replace('{files}', String(targets.filter((item) => !item.reason).length))}
          </p>
          {blocked.length > 0 && (
            <>
              <ul className={styles.summary}>
                {blocked.map((item) => (
                  <li key={item.id}>
                    {item.snapshot?.values.title ||
                      copy['metadata.targetSong'].replace(
                        '{number}',
                        String(targets.indexOf(item) + 1),
                      )}{' '}
                    —{' '}
                    {item.reason === 'limit'
                      ? copy['metadata.bulkLimit']
                      : (copy[`metadata.error.${item.reason as 'read_only'}`] ??
                        copy['metadata.readFailed'])}
                  </li>
                ))}
              </ul>
              {!excluded && blocked.every((item) => item.reason !== 'limit') && (
                <Action variant="secondary" onClick={() => setExcluded(true)}>
                  {copy['metadata.exclude']}
                </Action>
              )}
              <Action variant="quiet" onClick={() => setAttempt((value) => value + 1)}>
                {copy['metadata.reload']}
              </Action>
            </>
          )}
          {groups.length > 1 && <p>{copy['metadata.libraryGroups']}</p>}
          {groups.map((id, index) => (
            <section key={id} className={styles.field}>
              <ul className={styles.summary}>
                {targets
                  .filter((item) => item.libraryId === id)
                  .map((item) => (
                    <li key={item.id}>{item.snapshot?.values.title || copy['metadata.empty']}</li>
                  ))}
              </ul>
              <Action disabled={blocked.length > 0 && !excluded} onClick={() => setLibrary(id)}>
                {copy['metadata.editGroup']
                  .replace('{group}', String(index + 1))
                  .replace(
                    '{count}',
                    String(targets.filter((item) => item.libraryId === id).length),
                  )}
              </Action>
            </section>
          ))}
        </>
      )}
    </TargetPicker>
  );
}
function TargetPicker({
  locale,
  onClose,
  children,
}: {
  locale: Locale;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const id = useId();
  const copy = messages[locale];
  useMetadataFocus(dialog, onClose, false);
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
          <h2 id={id}>{copy['metadata.bulkEditor']}</h2>
          <p>{copy['metadata.bulkLimit']}</p>
        </header>
        <div
          role="region"
          aria-label={copy['metadata.bulkEditor']}
          tabIndex={0}
          className={styles.content}
        >
          {children}
        </div>
        <footer className={styles.footer}>
          <Action variant="quiet" onClick={onClose}>
            {copy['metadata.cancel']}
          </Action>
        </footer>
      </div>
    </div>
  );
}
