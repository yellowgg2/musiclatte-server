import { Action } from '../design/components/Action';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { MetadataJob, MetadataSnapshot } from '@musiclatte/contracts';
import { messages, type Locale } from '../i18n';
import { useMetadataSync } from './MetadataSyncProvider';
import { MetadataEditor } from './components/MetadataEditor';
import styles from './components/MetadataJobStatus.module.css';
interface MetadataUIContext {
  locale: Locale;
  base: string;
  apiOrigin: string;
  csrfToken: string;
  canEdit: boolean;
  canLyrics: boolean;
  canHistory: boolean;
  bulkFields?: readonly string[];
  accept(job: MetadataJob): void;
  open(snapshot: MetadataSnapshot): void;
  onUnauthenticated(): void;
}
const Context = createContext<MetadataUIContext>({
  locale: 'en',
  base: '/',
  apiOrigin: '',
  csrfToken: '',
  canEdit: false,
  canLyrics: false,
  canHistory: false,
  open: () => undefined,
  accept: () => undefined,
  onUnauthenticated: () => undefined,
});
export function MetadataUIProvider({
  children,
  ...options
}: Omit<MetadataUIContext, 'open' | 'accept'> & { children: ReactNode }) {
  const sync = useMetadataSync();
  const [editor, setEditor] = useState<MetadataSnapshot>();
  const [accepted, setAccepted] = useState<MetadataJob>();
  const close = useCallback(() => setEditor(undefined), []);
  const submitted = useCallback(
    (job: MetadataJob) => {
      setAccepted(job);
      setEditor(undefined);
      sync.refresh();
    },
    [sync.refresh],
  );
  useEffect(() => {
    setEditor(undefined);
    setAccepted(undefined);
  }, [sync.client]);
  useEffect(() => {
    if (!options.canEdit) setEditor(undefined);
  }, [options.canEdit]);
  const copy = messages[options.locale];
  return (
    <Context.Provider value={{ ...options, open: setEditor, accept: submitted }}>
      {children}
      {accepted && (
        <aside className={styles.notice} role="status">
          <span>
            {copy[accepted.kind === 'restore' ? 'metadata.restorePending' : 'metadata.saving']}
          </span>
          <a
            onClick={() => setAccepted(undefined)}
            href={`${options.base}metadata-jobs/${encodeURIComponent(accepted.id)}`}
          >
            {copy['metadata.viewJob']}
          </a>
          <a onClick={() => setAccepted(undefined)} href={`${options.base}metadata-jobs`}>
            {copy['metadata.history']}
          </a>
          <Action variant="quiet" onClick={() => setAccepted(undefined)}>
            {copy['metadata.close']}
          </Action>
        </aside>
      )}
      {editor && sync.client && options.canEdit && (
        <MetadataEditor
          key={`${editor.trackId}:${editor.fileRevision}`}
          snapshot={editor}
          locale={options.locale}
          apiOrigin={options.apiOrigin}
          csrfToken={options.csrfToken}
          canLyrics={options.canLyrics}
          client={sync.client}
          onSubmitted={submitted}
          onClose={close}
          onUnauthenticated={options.onUnauthenticated}
        />
      )}
    </Context.Provider>
  );
}
export function useMetadataUI() {
  return useContext(Context);
}
