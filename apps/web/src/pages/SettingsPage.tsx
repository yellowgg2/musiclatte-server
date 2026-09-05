import type { SessionState } from '../auth/session-store';
import { Action } from '../design/components/Action';
import { StatusSurface } from '../design/components/StatusSurface';
import { LanguagePicker } from '../app/LanguagePicker';
import { messages, type Locale } from '../i18n';
import styles from '../app/Shell.module.css';
export function SettingsPage({
  state,
  locale,
  onLocale,
  onLogout,
}: {
  state: SessionState;
  locale: Locale;
  onLocale: (locale: Locale) => void;
  onLogout: () => void;
}) {
  const copy = messages[locale];
  return (
    <div className={styles.settings}>
      <header className={styles.pageHeading}>
        <h1 tabIndex={-1} data-page-heading>
          {copy['shell.settings']}
        </h1>
        <p>{copy['settings.description']}</p>
      </header>
      <section className={styles.section} aria-labelledby="account-heading">
        <h2 id="account-heading">{copy['settings.account']}</h2>
        <div className={styles.accountRow}>
          <div className={styles.accountIdentity}>
            <span className={styles.avatar} aria-hidden="true">
              {state.session?.username.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <p className={styles.secondary}>{copy['settings.signedIn']}</p>
              <p className={styles.username}>{state.session?.username}</p>
            </div>
          </div>
          <Action variant="secondary" busy={state.busy} onClick={onLogout}>
            {copy[state.busy ? 'settings.loggingOut' : 'settings.logout']}
          </Action>
        </div>
        {state.error && (
          <StatusSurface
            state="error"
            title={copy['status.error']}
            description={copy[`error.${state.error}`]}
          />
        )}
      </section>
      <section className={styles.section}>
        <LanguagePicker locale={locale} onChange={onLocale} />
        <p className={styles.secondary}>{copy['settings.languageHelp']}</p>
      </section>
    </div>
  );
}
