import type { ApiErrorCode, CapabilitiesResponse } from '@musiclatte/contracts';
import { useEffect, useId, useRef, useState } from 'react';
import { featureState } from '../capabilities/client-features';
import { Action } from '../design/components/Action';
import { formatCount, messages, type Locale } from '../i18n';
import { useAccountSummary } from '../account/AccountSummaryProvider';
import styles from './AccountDock.module.css';

export interface AccountDockProps {
  locale: Locale;
  base: string;
  capabilities: CapabilitiesResponse | null;
  username: string;
  busy: boolean;
  error: ApiErrorCode | null;
  onLogout: () => void;
  defaultMobileOpen?: boolean;
}

function focusable(dialog: HTMLElement): HTMLElement[] {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

export function AccountDock({
  locale,
  base,
  capabilities,
  username,
  busy,
  error,
  onLogout,
  defaultMobileOpen = false,
}: AccountDockProps) {
  const copy = messages[locale];
  const { state, refresh } = useAccountSummary();
  const [open, setOpen] = useState(defaultMobileOpen);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const previousUsername = useRef(username);
  const dialogId = useId();
  const titleId = useId();
  const favoritesAvailable =
    featureState(capabilities?.features['favorites.songs']) === 'available';
  const playlistsAvailable = featureState(capabilities?.features['playlists.read']) === 'available';

  useEffect(() => {
    if (previousUsername.current === username) return;
    previousUsername.current = username;
    setOpen(false);
  }, [username]);

  useEffect(() => {
    if (!open) return;
    dialog.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (busy) return;
        setOpen(false);
        trigger.current?.focus();
        return;
      }
      if (event.key !== 'Tab' || !dialog.current) return;
      const targets = focusable(dialog.current);
      if (targets.length === 0) {
        event.preventDefault();
        return;
      }
      const first = targets[0]!;
      const last = targets.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [busy, open]);

  const dismiss = () => {
    if (busy) return;
    setOpen(false);
    trigger.current?.focus();
  };
  const label = copy['account.openMenu'].replace('{username}', username);
  const identity = (
    <div className={styles.identity}>
      <span className={styles.avatar} aria-hidden="true">
        {username.slice(0, 1).toLocaleUpperCase(locale)}
      </span>
      <div className={styles.identityCopy}>
        <span className={styles.signedIn}>{copy['account.signedIn']}</span>
        <strong className={styles.username}>{username}</strong>
      </div>
    </div>
  );
  const details = (
    <>
      <div className={styles.counts}>
        {favoritesAvailable && state.summary && (
          <a href={`${base}music/favorites`} onClick={() => setOpen(false)}>
            {copy['account.favoriteCount'].replace(
              '{count}',
              formatCount(state.summary.favoriteSongCount, locale),
            )}
          </a>
        )}
        {playlistsAvailable && state.summary && (
          <a href={`${base}playlists`} onClick={() => setOpen(false)}>
            {copy['account.playlistCount'].replace(
              '{count}',
              formatCount(state.summary.playlistCount, locale),
            )}
          </a>
        )}
        {state.status === 'loading' && !state.summary && (
          <span role="status" className={styles.summaryStatus}>
            {copy['account.summaryLoading']}
          </span>
        )}
      </div>
      {state.status === 'error' && (
        <div className={styles.summaryError} role="status">
          <span>{copy['account.summaryUnavailable']}</span>
          <Action variant="quiet" onClick={refresh}>
            {copy['account.retrySummary']}
          </Action>
        </div>
      )}
      {error && (
        <p className={styles.logoutError} role="alert">
          {copy[`error.${error}`]}
        </p>
      )}
      <Action variant="secondary" busy={busy} onClick={onLogout}>
        {copy[busy ? 'settings.loggingOut' : 'settings.logout']}
      </Action>
    </>
  );

  return (
    <>
      <section className={styles.desktop} aria-label={copy['account.current']}>
        {identity}
        {details}
      </section>
      <button
        ref={trigger}
        className={styles.mobileTrigger}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={dialogId}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">{username.slice(0, 1).toLocaleUpperCase(locale)}</span>
      </button>
      {open && (
        <div
          className={styles.backdrop}
          onMouseDown={(event) => event.target === event.currentTarget && dismiss()}
        >
          <div
            ref={dialog}
            id={dialogId}
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
          >
            <div className={styles.dialogHeading}>
              <h2 id={titleId}>{copy['account.current']}</h2>
              <button
                type="button"
                aria-label={copy['account.closeMenu']}
                disabled={busy}
                onClick={dismiss}
              >
                ×
              </button>
            </div>
            {identity}
            {details}
          </div>
        </div>
      )}
    </>
  );
}
