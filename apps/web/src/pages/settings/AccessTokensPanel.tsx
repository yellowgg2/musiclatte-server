import { useEffect, useMemo, useRef, useState } from 'react';
import {
  accessTokenScopes,
  metadataFields,
  validateTokenName,
  validateTokenScopes,
  type AccessToken,
  type AccessTokenOptions,
  type AccessTokenScope,
  type ApiErrorCode,
  type FeatureCapability,
  type MetadataField,
} from '@musiclatte/contracts';
import { createAccessTokenClient } from '../../automation/client';
import { errorCode } from '../../auth/client';
import { Action } from '../../design/components/Action';
import { TextField } from '../../design/components/TextField';
import { StatusSurface } from '../../design/components/StatusSurface';
import { messages, type Locale } from '../../i18n';
import shell from '../../app/Shell.module.css';
import styles from './AccessTokensPanel.module.css';

function accessTokenScopeLabel(copy: (typeof messages)[Locale], scope: AccessTokenScope): string {
  return copy[`tokens.scope.${scope}`];
}

export function AccessTokensPanel({
  locale,
  fetcher,
  apiOrigin,
  csrfToken,
  unavailable,
  metadataCapability,
  organizationCapability,
  onUnauthenticated,
  onRetryCapabilities,
}: {
  locale: Locale;
  fetcher: typeof fetch;
  apiOrigin: string;
  csrfToken: string;
  unavailable: boolean;
  metadataCapability: FeatureCapability | undefined;
  organizationCapability: FeatureCapability | undefined;
  onUnauthenticated: () => void;
  onRetryCapabilities: () => void;
}) {
  const client = useMemo(
    () => createAccessTokenClient({ fetcher, apiOrigin }),
    [fetcher, apiOrigin],
  );
  const copy = messages[locale];
  const [options, setOptions] = useState<AccessTokenOptions | null>(null);
  const [tokens, setTokens] = useState<AccessToken[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<AccessTokenScope[]>(['metadata:read']);
  const [libraries, setLibraries] = useState<string[]>([]);
  const [duration, setDuration] = useState(3600000);
  const [secret, setSecret] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'ready' | 'copied' | 'failed'>('ready');
  const [error, setError] = useState<ApiErrorCode | null>(null);
  const [nameError, setNameError] = useState(false);
  const [selectionError, setSelectionError] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [revokeFailed, setRevokeFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState<'read' | 'create' | 'revoke' | null>('read');
  const [now, setNow] = useState(Date.now());
  const alive = useRef(false);
  const life = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const focusName = () => document.getElementById('token-name')?.focus();
  const secretPanel = useRef<HTMLDivElement>(null);
  const rawField = useRef<HTMLTextAreaElement>(null);
  const secretRef = useRef<string | null>(null);
  const receivedAt = useRef(Date.now());
  const callbacks = useRef({ onUnauthenticated, onRetryCapabilities });
  callbacks.current = { onUnauthenticated, onRetryCapabilities };
  function hide() {
    secretRef.current = null;
    setSecret(null);
    setCopyState('ready');
  }
  function fail(cause: unknown) {
    const code = errorCode(cause);
    setError(code);
    if (code === 'unauthenticated') callbacks.current.onUnauthenticated();
    if (code === 'forbidden') callbacks.current.onRetryCapabilities();
  }
  async function refresh(more = false) {
    if (locked.current) return;
    locked.current = true;
    setBusy('read');
    setError(null);
    try {
      const signal = life.current!.signal;
      const [policy, page] = await Promise.all([
        client.options(signal),
        client.list(signal, more ? (cursor ?? undefined) : undefined),
      ]);
      if (!alive.current || signal.aborted) return;
      receivedAt.current = Date.now();
      setOptions(policy);
      setNow(policy.now);
      setDuration((value) => Math.min(value, policy.maxTokenAgeMs));
      setLibraries((selected) => selected.filter((id) => policy.libraryIds.includes(id)));
      setTokens((previous) =>
        more
          ? [...previous, ...page.accessTokens.filter((t) => !previous.some((p) => p.id === t.id))]
          : page.accessTokens,
      );
      setCursor(page.nextCursor);
    } catch (cause) {
      if (alive.current && !life.current?.signal.aborted) fail(cause);
    } finally {
      locked.current = false;
      if (alive.current) setBusy(null);
    }
  }
  useEffect(() => {
    alive.current = true;
    life.current = new AbortController();
    void refresh();
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => {
      alive.current = false;
      life.current?.abort();
      secretRef.current = null;
      clearInterval(timer);
    };
  }, [client]);
  useEffect(() => {
    if (secret) {
      rawField.current?.focus({ preventScroll: true });
      secretPanel.current?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [secret]);
  useEffect(() => {
    if (confirm) document.getElementById('token-confirm-' + confirm)?.focus();
  }, [confirm]);
  async function create() {
    if (locked.current || unknown || unavailable || !options) return;
    let normalized: string;
    try {
      normalized = validateTokenName(name);
      setNameError(false);
    } catch {
      setNameError(true);
      focusName();
      return;
    }
    try {
      validateTokenScopes(scopes);
      if (!libraries.length) throw new Error();
      setSelectionError(false);
    } catch {
      setSelectionError(true);
      return;
    }
    locked.current = true;
    setBusy('create');
    setError(null);
    hide();
    const signal = life.current!.signal;
    try {
      const result = await client.create(
        {
          name: normalized,
          scopes,
          libraryIds: libraries,
          expiresAt:
            options.now +
            Date.now() -
            receivedAt.current +
            Math.min(duration, options.maxTokenAgeMs) -
            Math.min(1000, Math.floor(Math.min(duration, options.maxTokenAgeMs) / 100)),
        },
        csrfToken,
        signal,
      );
      if (!alive.current || signal.aborted) return;
      secretRef.current = result.token;
      setSecret(result.token);
      setTokens((previous) => [result.accessToken, ...previous]);
      setName('');
    } catch (cause) {
      if (alive.current && !signal.aborted) {
        if (errorCode(cause) === 'outcome_unknown') setUnknown(true);
        else fail(cause);
      }
    } finally {
      locked.current = false;
      if (alive.current) setBusy(null);
    }
  }
  async function revoke(id: string) {
    if (locked.current) return;
    locked.current = true;
    setBusy('revoke');
    setError(null);
    setRevokeFailed(null);
    hide();
    const signal = life.current!.signal;
    try {
      await client.revoke(id, csrfToken, signal);
      if (!alive.current || signal.aborted) return;
      setTokens((previous) =>
        previous.map((t) => (t.id === id ? { ...t, revokedAt: Date.now() } : t)),
      );
      setConfirm(null);
    } catch (cause) {
      if (alive.current && !signal.aborted) {
        setRevokeFailed(id);
        fail(cause);
      }
    } finally {
      locked.current = false;
      if (alive.current) setBusy(null);
    }
  }
  const date = (time: number) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(time);
  const durations = options
    ? [
        ...new Set(
          [3600000, 86400000, 7 * 86400000, 30 * 86400000, options.maxTokenAgeMs].filter(
            (value) => value <= options.maxTokenAgeMs,
          ),
        ),
      ].sort((a, b) => a - b)
    : [];
  const organizationAllowed =
    organizationCapability?.supported === true && organizationCapability.permission === 'allowed';
  const organizationState =
    organizationCapability?.supported !== true
      ? 'tokens.organizeUnsupported'
      : organizationCapability.permission === 'denied'
        ? 'tokens.organizeDenied'
        : organizationCapability.permission !== 'allowed'
          ? 'tokens.organizePermissionUnknown'
          : organizationCapability.availability !== 'available'
            ? 'tokens.organizeUnavailable'
            : 'tokens.organizeAvailable';
  const writableFields = (metadataCapability?.fields ?? []).filter(
    (field): field is MetadataField => metadataFields.includes(field as MetadataField),
  );
  function selectScope(scope: AccessTokenScope, checked: boolean) {
    setScopes((previous) => {
      if (scope === 'media:organize') {
        if (!checked) return previous.filter((entry) => entry !== scope);
        return accessTokenScopes.filter((entry) =>
          new Set([...previous, 'metadata:read', 'metadata:write', scope]).has(entry),
        );
      }
      if (scope === 'collections:read') {
        if (!checked) return previous.filter((entry) => entry !== scope);
        return accessTokenScopes.filter((entry) =>
          new Set([...previous, 'metadata:read', scope]).has(entry),
        );
      }
      return checked
        ? accessTokenScopes.filter((entry) => new Set([...previous, scope]).has(entry))
        : previous.filter((entry) => entry !== scope);
    });
    setSelectionError(false);
  }
  return (
    <section className={shell.section} aria-labelledby="access-tokens-heading">
      <h2 id="access-tokens-heading">{copy['tokens.title']}</h2>
      <p className={shell.secondary}>{copy['tokens.help']}</p>
      {unavailable ? (
        <StatusSurface
          state="error"
          title={copy['tokens.unavailable']}
          description={copy['tokens.unavailableHelp']}
          action={
            <Action variant="secondary" onClick={onRetryCapabilities}>
              {copy['status.retry']}
            </Action>
          }
        />
      ) : null}
      {busy === 'read' && !options ? (
        <StatusSurface
          state="loading"
          title={copy['tokens.loading']}
          description={copy['tokens.loadingHelp']}
        />
      ) : null}
      {options && (
        <form
          className={styles.form}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <TextField
            id="token-name"
            label={copy['tokens.name']}
            value={name}
            maxLength={240}
            autoComplete="off"
            disabled={!!busy || unavailable}
            {...(nameError ? { error: copy['tokens.nameError'] } : {})}
            onChange={(event) => {
              setName(event.target.value);
              setNameError(false);
            }}
          />
          {options.scopes.includes('media:organize') && (
            <section className={styles.guide} aria-labelledby="media-organization-heading">
              <div>
                <h3 id="media-organization-heading">{copy['tokens.organizationTitle']}</h3>
                <p>{copy[organizationState]}</p>
              </div>
              <Action
                type="button"
                variant="secondary"
                disabled={!!busy || unavailable || !organizationAllowed}
                onClick={() => {
                  setScopes(['metadata:read', 'metadata:write', 'media:organize']);
                  setSelectionError(false);
                }}
              >
                {copy['tokens.recommendedPreset']}
              </Action>
              <p className={styles.presetHelp}>{copy['tokens.recommendedPresetHelp']}</p>
              {writableFields.length > 0 && (
                <div className={styles.capability}>
                  <h4>{copy['tokens.supportedFields']}</h4>
                  <p className={styles.fields}>
                    {writableFields.map((field) => copy[`metadata.${field}`]).join(' · ')}
                  </p>
                  <p className={shell.secondary}>{copy['tokens.fieldsHelp']}</p>
                  <p className={shell.secondary}>{copy['tokens.curationHelp']}</p>
                </div>
              )}
            </section>
          )}
          <div className={styles.columns}>
            <fieldset disabled={!!busy || unavailable} className={styles.choices}>
              <legend>{copy['tokens.scopes']}</legend>
              {accessTokenScopes
                .filter((scope) => options.scopes.includes(scope))
                .map((scope) => {
                  const id = scope.replace(':', '-');
                  const labelId = `token-scope-${id}-label`;
                  const descriptionId = `token-scope-${id}-description`;
                  return (
                    <label key={scope} className={styles.choice}>
                      <input
                        type="checkbox"
                        checked={scopes.includes(scope)}
                        aria-labelledby={labelId}
                        aria-describedby={descriptionId}
                        disabled={
                          scope === 'metadata:read' ||
                          (scope === 'metadata:write' &&
                            (scopes.includes('lyrics:write') ||
                              scopes.includes('media:organize'))) ||
                          (scope === 'lyrics:write' && !scopes.includes('metadata:write')) ||
                          (scope === 'media:organize' && !organizationAllowed)
                        }
                        onChange={(event) => selectScope(scope, event.target.checked)}
                      />
                      <span className={styles.choiceCopy}>
                        <span id={labelId}>{copy[`tokens.scope.${scope}`]}</span>
                        <span
                          id={descriptionId}
                          className={`${styles.choiceHelp} ${shell.secondary}`}
                        >
                          {copy[`tokens.scopeDescription.${scope}`]}
                        </span>
                      </span>
                    </label>
                  );
                })}
            </fieldset>
            <fieldset
              disabled={!!busy || unavailable}
              className={styles.choices}
              aria-describedby={
                selectionError
                  ? 'token-libraries-help token-selection-error'
                  : 'token-libraries-help'
              }
            >
              <legend>{copy['tokens.libraries']}</legend>
              <p id="token-libraries-help" className={`${styles.sectionHelp} ${shell.secondary}`}>
                {copy['tokens.librariesHelp']}
              </p>
              {options.libraryIds.map((id) => (
                <label key={id} className={styles.choice}>
                  <input
                    type="checkbox"
                    checked={libraries.includes(id)}
                    aria-describedby="token-libraries-help"
                    onChange={(event) =>
                      setLibraries((previous) =>
                        event.target.checked ? [...previous, id] : previous.filter((v) => v !== id),
                      )
                    }
                  />
                  <span>{id}</span>
                </label>
              ))}
            </fieldset>
          </div>
          {selectionError && (
            <p id="token-selection-error" role="alert" className={styles.error}>
              {copy['tokens.selectionError']}
            </p>
          )}
          <label className={styles.expiry}>
            {copy['tokens.expiry']}
            <select
              value={duration}
              disabled={!!busy || unavailable}
              onChange={(event) => setDuration(Number(event.target.value))}
            >
              {durations.map((value) => (
                <option key={value} value={value}>
                  {value >= 86400000
                    ? copy['tokens.days'].replace('{count}', String(value / 86400000))
                    : copy['tokens.minutes'].replace(
                        '{count}',
                        String(Math.max(1, Math.floor(value / 60000))),
                      )}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.actions}>
            <Action
              type="submit"
              busy={busy === 'create'}
              disabled={!!busy || unknown || unavailable}
            >
              {copy['tokens.create']}
            </Action>
          </div>
        </form>
      )}
      {secret && (
        <div ref={secretPanel} className={styles.secret}>
          <p role="status">{copy['tokens.created']}</p>
          <p>{copy['tokens.once']}</p>
          <label htmlFor="issued-token">{copy['tokens.raw']}</label>
          <textarea
            ref={rawField}
            id="issued-token"
            value={secret}
            readOnly
            rows={2}
            autoComplete="off"
            spellCheck={false}
          />
          <div className={styles.actions}>
            <Action
              variant="secondary"
              onClick={() => {
                const value = secret;
                void navigator.clipboard
                  ?.writeText(value)
                  .then(() => {
                    if (alive.current && secretRef.current === value) setCopyState('copied');
                  })
                  .catch(() => {
                    if (alive.current && secretRef.current === value) setCopyState('failed');
                  });
                if (!navigator.clipboard) setCopyState('failed');
              }}
            >
              {copy['tokens.copy']}
            </Action>
            <Action variant="quiet" onClick={hide}>
              {copy['tokens.hide']}
            </Action>
          </div>
          {copyState !== 'ready' && (
            <p role="status">
              {copy[copyState === 'copied' ? 'tokens.copied' : 'tokens.copyFailed']}
            </p>
          )}
        </div>
      )}
      {unknown && (
        <StatusSurface
          state="error"
          title={copy['tokens.unknown']}
          description={copy['tokens.unknownHelp']}
          action={
            <Action
              variant="secondary"
              disabled={!!busy}
              onClick={() => {
                setUnknown(false);
                setError(null);
                focusName();
              }}
            >
              {copy['tokens.acknowledge']}
            </Action>
          }
        />
      )}
      {error && !unavailable && (
        <StatusSurface
          state="error"
          title={copy['status.error']}
          description={copy[`error.${error}`]}
          action={
            revokeFailed ? (
              <Action disabled={!!busy} onClick={() => void revoke(revokeFailed)}>
                {copy['tokens.retryRevoke']}
              </Action>
            ) : undefined
          }
        />
      )}
      <div className={styles.listHeading}>
        <h3>{copy['tokens.list']}</h3>
        <Action variant="quiet" disabled={!!busy} onClick={() => void refresh()}>
          {copy['tokens.refresh']}
        </Action>
      </div>
      {options && !tokens.length && (
        <StatusSurface
          state="empty"
          title={copy['tokens.empty']}
          description={copy['tokens.emptyHelp']}
        />
      )}
      <ul className={styles.list}>
        {tokens.map((token) => (
          <li key={token.id} className={styles.token}>
            <div className={styles.tokenHeading}>
              <h4>{token.name}</h4>
              <span>
                {
                  copy[
                    token.revokedAt !== null
                      ? 'tokens.revoked'
                      : token.expiresAt <= now
                        ? 'tokens.expired'
                        : 'tokens.active'
                  ]
                }
              </span>
            </div>
            <p className={styles.details}>
              {token.scopes.map((scope) => accessTokenScopeLabel(copy, scope)).join(' · ')}
            </p>
            <p className={styles.details}>
              {copy['tokens.libraries']}: {token.libraryIds.join(', ')}
            </p>
            <dl className={styles.dates}>
              <div>
                <dt>{copy['tokens.createdAt']}</dt>
                <dd>{date(token.createdAt)}</dd>
              </div>
              <div>
                <dt>{copy['tokens.expiresAt']}</dt>
                <dd>{date(token.expiresAt)}</dd>
              </div>
              <div>
                <dt>{copy['tokens.lastUsed']}</dt>
                <dd>{token.lastUsedAt === null ? copy['tokens.never'] : date(token.lastUsedAt)}</dd>
              </div>
            </dl>
            {token.revokedAt === null && (
              <div className={styles.actions}>
                {confirm === token.id ? (
                  <>
                    <p>{copy['tokens.confirmHelp']}</p>
                    <Action
                      id={'token-confirm-' + token.id}
                      variant="destructive"
                      busy={busy === 'revoke'}
                      disabled={!!busy}
                      onClick={() => void revoke(token.id)}
                    >
                      {copy['tokens.confirm']}
                    </Action>
                    <Action variant="quiet" disabled={!!busy} onClick={() => setConfirm(null)}>
                      {copy['tokens.cancel']}
                    </Action>
                  </>
                ) : (
                  <Action
                    variant="secondary"
                    disabled={!!busy}
                    aria-label={copy['tokens.revokeName'].replace('{name}', token.name)}
                    onClick={() => setConfirm(token.id)}
                  >
                    {copy['tokens.revoke']}
                  </Action>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {cursor && (
        <Action variant="secondary" disabled={!!busy} onClick={() => void refresh(true)}>
          {copy['tokens.more']}
        </Action>
      )}
    </section>
  );
}
