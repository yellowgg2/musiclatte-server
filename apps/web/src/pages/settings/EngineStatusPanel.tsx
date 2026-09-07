import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ApiErrorCode,
  EngineActionRequest,
  EngineStatusResponse,
} from '@musiclatte/contracts';
import { createEngineClient } from '../../engine/client';
import { errorCode } from '../../auth/client';
import { Action } from '../../design/components/Action';
import { StatusSurface } from '../../design/components/StatusSurface';
import { messages, type Locale } from '../../i18n';
import shell from '../../app/Shell.module.css';
import styles from './EngineStatusPanel.module.css';
type Pending = {
  action: EngineActionRequest['action'];
  before: EngineStatusResponse;
  started: number;
  sawChecking: boolean;
};
export function EngineStatusPanel({
  locale,
  fetcher,
  apiOrigin,
  csrfToken,
  unavailable,
  onRetryCapabilities,
  onUnauthenticated,
}: {
  locale: Locale;
  fetcher: typeof fetch;
  apiOrigin: string;
  csrfToken: string;
  unavailable: boolean;
  onRetryCapabilities: () => void;
  onUnauthenticated: () => void;
}) {
  const client = useMemo(() => createEngineClient({ fetcher, apiOrigin }), [fetcher, apiOrigin]);
  const [value, setValue] = useState<EngineStatusResponse | null>(null);
  const [error, setError] = useState<ApiErrorCode | null>(null);
  const [busy, setBusy] = useState<EngineActionRequest['action'] | null>(null);
  const [accepted, setAccepted] = useState<EngineActionRequest['action'] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const life = useRef<AbortController | null>(null);
  const pending = useRef<Pending | null>(null);
  const locked = useRef(false);
  const readBlocked = useRef(false);
  const actionGroup = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const readGeneration = useRef(0);
  const latest = useRef(value);
  const callbacks = useRef({ onRetryCapabilities, onUnauthenticated });
  callbacks.current = { onRetryCapabilities, onUnauthenticated };
  const copy = messages[locale];
  function fail(reason: unknown) {
    readBlocked.current = true;
    const code = errorCode(reason);
    if (code === 'unauthenticated') callbacks.current.onUnauthenticated();
    else {
      setError(code);
      if (code === 'forbidden' || code === 'csrf_rejected') callbacks.current.onRetryCapabilities();
    }
  }
  async function read(controller: AbortController, explicit = false) {
    if (locked.current || (readBlocked.current && !explicit)) return;
    if (explicit) readBlocked.current = false;
    const generation = ++readGeneration.current;
    if (explicit) setRefreshing(true);
    try {
      const result = await client.read(controller.signal);
      if (controller.signal.aborted || generation !== readGeneration.current) return;
      latest.current = result;
      setValue(result);
      setError(null);
      const action = pending.current;
      if (action) {
        action.sawChecking ||= result.status === 'checking';
        const complete =
          action.action === 'restore_previous'
            ? result.activeVersion === action.before.previousVersion
            : result.status !== 'checking' &&
              (action.sawChecking ||
                result.lastCheckedAt !== action.before.lastCheckedAt ||
                result.status !== action.before.status ||
                result.activeVersion !== action.before.activeVersion ||
                result.candidateVersion !== action.before.candidateVersion);
        if (complete) {
          pending.current = null;
          setAccepted(null);
        } else if (Date.now() - action.started >= 30000) {
          pending.current = null;
          readBlocked.current = true;
          setError('outcome_unknown');
        }
      }
    } catch (reason) {
      if (!controller.signal.aborted && generation === readGeneration.current) fail(reason);
    } finally {
      if (!controller.signal.aborted && generation === readGeneration.current) setRefreshing(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    // Poll sequentially: slow reads cannot overlap and responses cannot overtake an action.
    let timer: ReturnType<typeof setTimeout>;
    const poll = async (initial = false) => {
      if (initial || document.visibilityState !== 'hidden') await read(controller);
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 2000);
    };
    void poll(true);
    return () => {
      controller.abort();
      clearTimeout(timer);
      readGeneration.current++;
    };
  }, [client]);
  useEffect(() => {
    if (!busy && !accepted && trigger.current && document.activeElement === actionGroup.current) {
      trigger.current.focus({ preventScroll: true });
      trigger.current = null;
    }
  }, [busy, accepted]);
  async function action(action: EngineActionRequest['action']) {
    const controller = life.current;
    const before = latest.current;
    if (
      !controller ||
      controller.signal.aborted ||
      !before ||
      locked.current ||
      pending.current ||
      error ||
      before.status === 'checking'
    )
      return;
    if (
      action === 'restore_previous' &&
      (!before.previousVersion || before.recoverability !== 'available')
    )
      return;
    trigger.current =
      document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
    actionGroup.current?.focus({ preventScroll: true });
    locked.current = true;
    readGeneration.current++;
    setRefreshing(false);
    setBusy(action);
    try {
      await client.action(action, { csrfToken, signal: controller.signal });
      if (controller.signal.aborted) return;
      pending.current = { action, before, started: Date.now(), sawChecking: false };
      setAccepted(action);
      // A 202 projection is only acknowledgement; an independent read owns observed status.
    } catch (reason) {
      if (!controller.signal.aborted) fail(reason);
    } finally {
      if (!controller.signal.aborted) {
        locked.current = false;
        setBusy(null);
      }
    }
  }
  function retry() {
    if (!life.current || locked.current) return;
    pending.current = null;
    setAccepted(null);
    callbacks.current.onRetryCapabilities();
    void read(life.current, true);
  }
  const blocked = !!busy || !!pending.current || !!error || !value || value.status === 'checking';
  function date(instant: number | null) {
    if (instant === null) return copy['engine.never'];
    const date = new Date(instant);
    return Number.isNaN(date.getTime())
      ? copy['engine.unknown']
      : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }
  return (
    <section className={`${shell.section} ${styles.panel}`} aria-labelledby="engine-heading">
      <header className={styles.heading}>
        <h2 id="engine-heading">{copy['engine.title']}</h2>
        <p className={shell.secondary}>{copy['engine.description']}</p>
      </header>
      {!value && !error && (
        <StatusSurface
          state="loading"
          title={copy['engine.loading']}
          description={copy['status.loadingHelp']}
        />
      )}
      {value && (
        <>
          <dl className={styles.facts}>
            <div>
              <dt>{copy['engine.active']}</dt>
              <dd className={styles.version}>{value.activeVersion ?? copy['engine.none']}</dd>
            </div>
            <div>
              <dt>{copy['engine.status']}</dt>
              <dd role="status" aria-atomic="true">
                {copy[`engine.state.${value.status}`]}
              </dd>
            </div>
            <div>
              <dt>{copy['engine.lastChecked']}</dt>
              <dd>{date(value.lastCheckedAt)}</dd>
            </div>
            <div>
              <dt>{copy['engine.lastSuccess']}</dt>
              <dd>{date(value.lastSuccessfulCheckAt)}</dd>
            </div>
            <div>
              <dt>{copy['engine.candidate']}</dt>
              <dd>{value.candidateVersion ?? copy['engine.none']}</dd>
            </div>
            <div>
              <dt>{copy['engine.previous']}</dt>
              <dd>{value.previousVersion ?? copy['engine.none']}</dd>
            </div>
          </dl>
          {['candidate_pending_validation', 'update_failed', 'validation_failed'].includes(
            value.status,
          ) && (
            <p className={styles.help}>
              {
                copy[
                  `engine.help.${value.status as 'candidate_pending_validation' | 'update_failed' | 'validation_failed'}`
                ]
              }
            </p>
          )}
        </>
      )}
      {unavailable && !error && (
        <div className={styles.recovery}>
          <p>{copy['engine.unavailable']}</p>
          <p className={shell.secondary}>{copy['engine.unavailableHelp']}</p>
          <Action variant="secondary" busy={refreshing} onClick={retry}>
            {copy['status.retry']}
          </Action>
        </div>
      )}
      {error && (
        <StatusSurface
          state="error"
          title={copy['engine.error']}
          description={copy[`error.${error}`]}
          action={
            <Action variant="secondary" busy={refreshing} onClick={retry}>
              {copy['status.retry']}
            </Action>
          }
        />
      )}
      <div
        className={styles.actions}
        role="group"
        aria-label={copy['engine.actions']}
        tabIndex={-1}
        ref={actionGroup}
      >
        <Action
          variant="secondary"
          busy={busy === 'check_now'}
          disabled={blocked || !value?.activeVersion}
          aria-describedby="engine-action-help"
          onClick={() => void action('check_now')}
        >
          {copy['engine.check']}
        </Action>
        <Action
          variant="secondary"
          busy={busy === 'restore_previous'}
          disabled={blocked || !value?.previousVersion || value.recoverability !== 'available'}
          aria-describedby="engine-restore-help engine-action-help"
          onClick={() => void action('restore_previous')}
        >
          {copy['engine.restore']}
        </Action>
      </div>
      <p id="engine-action-help" className={styles.help} role="status" aria-atomic="true">
        {busy
          ? copy['engine.sending']
          : accepted
            ? copy[accepted === 'check_now' ? 'engine.checkAccepted' : 'engine.restoreAccepted']
            : value?.status === 'checking'
              ? copy['engine.checkingHelp']
              : copy['engine.checkHelp']}
      </p>
      <p id="engine-restore-help" className={styles.help}>
        {!value?.previousVersion
          ? copy['engine.noPrevious']
          : value.recoverability === 'temporarily_unavailable'
            ? copy['engine.restoreUnavailable']
            : copy['engine.restoreHelp']}
      </p>
    </section>
  );
}
