import { useEffect, useState, useSyncExternalStore } from 'react';
import { createSessionClient } from '../auth/client';
import { createSessionStore } from '../auth/session-store';
import { isSettingsPath, safeReturnPath } from '../auth/guards';
import { useLocale } from '../i18n/locale';
import { messages } from '../i18n';
import { LoginPage } from '../pages/LoginPage';
import { SettingsPage } from '../pages/SettingsPage';
import { AppShell } from './AppShell';
import { LanguagePicker } from './LanguagePicker';
import { StatusSurface } from '../design/components/StatusSurface';
import { Action } from '../design/components/Action';
import styles from './Shell.module.css';
import '../design/global.css';
export function Router({
  fetcher = fetch,
  base = '/',
  apiOrigin = '',
}: {
  fetcher?: typeof fetch;
  base?: string;
  apiOrigin?: string;
}) {
  const [store] = useState(() => createSessionStore(createSessionClient({ fetcher, apiOrigin })));
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [locale, onLocale] = useLocale();
  const [path, setPath] = useState(window.location.pathname);
  const copy = messages[locale];
  useEffect(() => {
    void store.restore();
    const refresh = () => {
      if (document.visibilityState === 'visible') void store.restore();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      store.dispose();
    };
  }, [store]);
  useEffect(() => {
    const changed = () => setPath(window.location.pathname);
    const clicked = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = event.target instanceof Element ? event.target.closest('a') : null;
      if (
        !anchor ||
        anchor.target ||
        anchor.hasAttribute('download') ||
        anchor.getAttribute('href')?.startsWith('#')
      )
        return;
      const url = new URL(anchor.href);
      if (url.origin !== window.location.origin || !url.pathname.startsWith(base)) return;
      event.preventDefault();
      window.history.pushState(null, '', url.pathname + url.search + url.hash);
      changed();
    };
    window.addEventListener('popstate', changed);
    document.addEventListener('click', clicked);
    return () => {
      window.removeEventListener('popstate', changed);
      document.removeEventListener('click', clicked);
    };
  }, [base]);
  useEffect(() => {
    let next: string | undefined;
    if (state.status === 'signed-out' && path !== `${base}login`)
      next = `${base}login?returnTo=${encodeURIComponent(safeReturnPath(path, base))}`;
    if (
      state.status === 'signed-in' &&
      (path === `${base}login` || path === base || path === base.slice(0, -1))
    )
      next = safeReturnPath(new URLSearchParams(window.location.search).get('returnTo'), base);
    if (next) {
      window.history.replaceState(null, '', next);
      setPath(window.location.pathname);
    }
  }, [state.status, path, base]);
  useEffect(() => {
    document.title = `${state.status === 'signed-in' ? copy['shell.settings'] : copy['login.title']} · Musiclatte`;
  }, [state.status, copy]);
  useEffect(() => {
    const heading = document.querySelector<HTMLElement>('[data-page-heading]');
    if (heading) heading.focus();
    else if (state.status === 'signed-out')
      document.querySelector<HTMLInputElement>('[name="username"]')?.focus();
  }, [state.status, path]);
  if (state.status === 'loading' || state.status === 'error')
    return (
      <main className={styles.boot}>
        <LanguagePicker locale={locale} onChange={onLocale} />
        <StatusSurface
          state={state.status === 'loading' ? 'loading' : 'error'}
          title={
            copy[
              state.error === 'forbidden'
                ? 'status.denied'
                : state.status === 'loading'
                  ? 'status.loading'
                  : 'status.error'
            ]
          }
          description={state.error ? copy[`error.${state.error}`] : copy['status.loadingHelp']}
          action={
            state.status === 'error' ? (
              <Action onClick={() => void store.restore()}>{copy['status.retry']}</Action>
            ) : undefined
          }
        />
      </main>
    );
  if (!state.session)
    return (
      <LoginPage
        base={base}
        state={state}
        locale={locale}
        onLocale={onLocale}
        onLogin={store.login}
      />
    );
  return (
    <AppShell locale={locale} base={base} capabilities={state.capabilities}>
      {isSettingsPath(path, base) || path === `${base}login` || path === base ? (
        <SettingsPage
          state={state}
          locale={locale}
          onLocale={onLocale}
          onLogout={() => void store.logout()}
        />
      ) : (
        <div className={styles.settings}>
          <h1 tabIndex={-1} data-page-heading>
            {copy['status.unavailable']}
          </h1>
          <p>{copy['status.unavailableHelp']}</p>
          <a href={`${base}settings`}>{copy['status.back']}</a>
        </div>
      )}
    </AppShell>
  );
}
