import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ImportItem, ImportJob } from '@musiclatte/contracts';
import { Action } from '../../design/components/Action';
import { StatusSurface } from '../../design/components/StatusSurface';
import { LanguagePicker } from '../../app/LanguagePicker';
import { messages, type Locale } from '../../i18n';
import { createImportClient } from '../../imports/client';
import { activeImport, createImportStore } from '../../imports/state';
import { parseImportInput } from '../../imports/input';
import styles from './Import.module.css';
import fieldStyles from '../../design/components/TextField.module.css';

type Store = ReturnType<typeof createImportStore>;
function ObservedStage({ item, locale }: { item: ImportItem; locale: Locale }) {
  const copy = messages[locale];
  const icon =
    item.stage === 'ready'
      ? '✓'
      : item.stage === 'failed'
        ? '!'
        : item.stage === 'cancelled'
          ? '−'
          : item.stage === 'duplicate'
            ? '↪'
            : '◷';
  return (
    <div className={styles.stage} data-stage={item.stage}>
      <span aria-hidden="true">{icon}</span>
      <span>{copy[`imports.stage.${item.stage}`]}</span>
    </div>
  );
}
function ImportJobItem({
  job,
  locale,
  store,
  disabled,
}: {
  job: ImportJob;
  locale: Locale;
  store: Store;
  disabled: boolean;
}) {
  const copy = messages[locale];
  const [confirm, setConfirm] = useState(false);
  const article = useRef<HTMLElement>(null);
  useEffect(() => {
    if (confirm)
      article.current?.querySelector<HTMLButtonElement>('[data-confirm-cancel]')?.focus();
  }, [confirm]);
  function close() {
    setConfirm(false);
    queueMicrotask(() =>
      article.current?.querySelector<HTMLButtonElement>('[data-cancel-import]')?.focus(),
    );
  }
  return (
    <article ref={article} className={styles.job} aria-labelledby={`import-${job.id}`}>
      <header className={styles.jobHeader}>
        <div>
          <h3 id={`import-${job.id}`} tabIndex={-1}>
            {copy['imports.job']} ·{' '}
            {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
              job.createdAt,
            )}
          </h3>
          <p className={styles.secondary}>{copy[`imports.job.${job.status}`]}</p>
        </div>
        {['queued', 'running'].includes(job.status) &&
          job.cancelRequestedAt === null &&
          !confirm && (
            <Action
              data-cancel-import
              variant="quiet"
              disabled={disabled}
              onClick={() => setConfirm(true)}
            >
              {copy['imports.cancel']}
            </Action>
          )}
      </header>
      {job.retryOfJobId && (
        <p>
          <a
            href={`#import-${job.retryOfJobId}`}
            onClick={() => document.getElementById(`import-${job.retryOfJobId}`)?.focus()}
          >
            {copy['imports.original']}
          </a>
        </p>
      )}
      {job.cancelRequestedAt !== null && job.status !== 'cancelled' && (
        <p className={styles.notice}>{copy['imports.cancelling']}</p>
      )}
      {confirm && (
        <div
          className={styles.confirm}
          role="group"
          aria-label={copy['imports.cancel']}
          onKeyDown={(event) => {
            if (event.key === 'Escape') close();
          }}
        >
          <p>{copy['imports.cancelHelp']}</p>
          <div className={styles.actions}>
            <Action
              data-confirm-cancel
              variant="destructive"
              disabled={disabled}
              onClick={() => {
                setConfirm(false);
                void store.cancel(job.id);
              }}
            >
              {copy['imports.confirmCancel']}
            </Action>
            <Action variant="secondary" onClick={close}>
              {copy['imports.keep']}
            </Action>
          </div>
        </div>
      )}
      <ul className={styles.items}>
        {job.items.map((item) => (
          <li key={item.id}>
            <div className={styles.itemCopy}>
              <p className={styles.itemTitle}>{item.title ?? item.sourceId}</p>
              {item.channel && <p className={styles.secondary}>{item.channel}</p>}
              <ObservedStage item={item} locale={locale} />
              {item.stage === 'registering' && (
                <p className={styles.secondary}>{copy['imports.registeringHelp']}</p>
              )}
              {item.failureCode && (
                <p className={styles.failure}>{copy[`imports.failure.${item.failureCode}`]}</p>
              )}
            </div>
            {item.stage === 'failed' && (
              <Action
                variant="secondary"
                disabled={disabled}
                onClick={() => void store.retry(job.id, item.id)}
                aria-label={copy['imports.retryItem'].replace(
                  '{title}',
                  item.title ?? item.sourceId,
                )}
              >
                {copy['imports.retry']}
              </Action>
            )}
          </li>
        ))}
      </ul>
    </article>
  );
}
export function ImportPage({
  locale,
  onLocale,
  fetcher,
  apiOrigin,
  csrfToken,
  onUnauthenticated,
}: {
  locale: Locale;
  onLocale: (locale: Locale) => void;
  fetcher: typeof fetch;
  apiOrigin: string;
  csrfToken: string;
  onUnauthenticated: () => void;
}) {
  const [store] = useState(() =>
    createImportStore(createImportClient({ fetcher, apiOrigin }), csrfToken, onUnauthenticated),
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const copy = messages[locale];
  const [input, setInput] = useState('');
  const [library, setLibrary] = useState('');
  const [invalid, setInvalid] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const seen = useRef(0);
  useEffect(() => {
    store.start();
    document.querySelector<HTMLElement>('[data-page-heading]')?.focus({ preventScroll: true });
    return () => store.dispose();
  }, [store]);
  useEffect(() => {
    document.title = `${copy['imports.title']} · Musiclatte`;
  }, [copy]);
  useEffect(() => {
    if (state.revision === seen.current) return;
    seen.current = state.revision;
    if (state.resultKind === 'create') setInput('');
    document.getElementById(`import-${state.resultId}`)?.focus();
  }, [state.revision, state.resultId, state.resultKind]);
  const selected = state.libraries.some((l) => l.id === library)
    ? library
    : (state.libraries[0]?.id ?? '');
  const locked = state.busy || state.pending !== null;
  const active = state.jobs.filter(activeImport);
  const history = state.jobs.filter((job) => !activeImport(job));
  function submit() {
    let urls: string[];
    try {
      urls = parseImportInput(input);
    } catch {
      setInvalid(true);
      field.current?.focus();
      return;
    }
    setInvalid(false);
    void store.create(selected, urls);
  }
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <h1 tabIndex={-1} data-page-heading>
            {copy['imports.title']}
          </h1>
          <p>{copy['imports.intro']}</p>
        </div>
        <LanguagePicker locale={locale} onChange={onLocale} />
      </header>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <p className={styles.secondary}>{copy['imports.rights']}</p>
        {state.libraries.length > 1 && (
          <label className={fieldStyles.field}>
            <span className={fieldStyles.label}>{copy['imports.library']}</span>
            <select
              className={fieldStyles.input}
              value={selected}
              disabled={locked}
              onChange={(event) => setLibrary(event.target.value)}
            >
              {state.libraries.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.id}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className={fieldStyles.field}>
          <label className={fieldStyles.label} htmlFor="import-urls">
            {copy['imports.urls']}
          </label>
          <textarea
            ref={field}
            id="import-urls"
            className={`${fieldStyles.input} ${styles.textarea}`}
            rows={4}
            value={input}
            disabled={locked}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={invalid || undefined}
            aria-describedby={`import-help${invalid ? ' import-error' : ''}`}
            onChange={(event) => {
              setInput(event.target.value);
              setInvalid(false);
            }}
            onKeyDown={(event) => {
              if (
                (event.ctrlKey || event.metaKey) &&
                event.key === 'Enter' &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <p id="import-help" className={fieldStyles.help}>
            {copy['imports.urlHelp']}
          </p>
          {invalid && (
            <p id="import-error" className={fieldStyles.error} role="alert">
              {copy['imports.invalid']}
            </p>
          )}
        </div>
        <div>
          <Action
            type="submit"
            busy={state.busy && state.pending?.kind === 'create'}
            disabled={locked || !selected || !!state.error}
          >
            {copy['imports.submit']}
          </Action>
        </div>
      </form>
      {state.loading && (
        <StatusSurface
          state="loading"
          title={copy['imports.loading']}
          description={copy['imports.loadingHelp']}
        />
      )}
      {state.error && (
        <StatusSurface
          state="error"
          title={copy['imports.refreshError']}
          description={copy[`error.${state.error}`]}
          action={<Action onClick={() => void store.refresh()}>{copy['status.retry']}</Action>}
        />
      )}
      {state.requestError && (
        <StatusSurface
          state="error"
          title={copy['imports.requestError']}
          description={copy[`error.${state.requestError}`]}
          action={
            <div className={styles.actions}>
              <Action onClick={() => void store.retryRequest()} busy={state.busy}>
                {copy['imports.retryRequest']}
              </Action>
              <Action
                variant="secondary"
                onClick={() => store.discardRequest()}
                disabled={state.busy}
              >
                {copy['imports.dismissRequest']}
              </Action>
            </div>
          }
        />
      )}
      <p className={styles.result} role="status">
        {state.revision > 0
          ? copy[state.resultKind === 'cancel' ? 'imports.cancelAccepted' : 'imports.accepted']
          : ''}
      </p>
      {!state.loading && !state.error && state.jobs.length === 0 && (
        <StatusSurface
          state="empty"
          title={copy['imports.empty']}
          description={copy['imports.emptyHelp']}
        />
      )}
      <div className={styles.section}>
        {[
          ...(active.length ? [<h2 key="active-heading">{copy['imports.active']}</h2>] : []),
          ...active.map((job) => (
            <ImportJobItem key={job.id} job={job} locale={locale} store={store} disabled={locked} />
          )),
          ...(history.length ? [<h2 key="history-heading">{copy['imports.history']}</h2>] : []),
          ...history.map((job) => (
            <ImportJobItem key={job.id} job={job} locale={locale} store={store} disabled={locked} />
          )),
        ]}
      </div>
      {state.nextCursor && (
        <Action variant="secondary" onClick={() => void store.more()} disabled={state.busy}>
          {copy['imports.more']}
        </Action>
      )}
    </div>
  );
}
