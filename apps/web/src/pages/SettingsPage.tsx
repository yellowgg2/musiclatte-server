import { AccessTokensPanel } from './settings/AccessTokensPanel';
import { ScanSettingsPanel } from './settings/ScanSettingsPanel';
import { EngineStatusPanel } from './settings/EngineStatusPanel';
import { clientFeatures } from '../capabilities/client-features';
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
  fetcher,
  apiOrigin,
  onRetryCapabilities,
  onUnauthenticated,
}: {
  state: SessionState;
  locale: Locale;
  onLocale: (locale: Locale) => void;
  onLogout: () => void;
  fetcher: typeof fetch;
  apiOrigin: string;
  onRetryCapabilities: () => void;
  onUnauthenticated: () => void;
}) {
  const copy = messages[locale];
  const feature = state.capabilities?.features['engine.manage'];
  const manager =
    clientFeatures['engine.manage'] &&
    feature?.supported === true &&
    feature.permission === 'allowed' &&
    ['available', 'temporarily_unavailable'].includes(feature.availability);
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
      {state.session &&
        state.capabilities?.features['library.scan']?.permission === 'allowed' &&
        state.capabilities.features['library.scan']?.supported === true && (
          <ScanSettingsPanel
            key={JSON.stringify([
              state.session.username,
              state.session.csrfToken,
              state.capabilities.instanceId,
              state.capabilities.revision,
            ])}
            locale={locale}
            fetcher={fetcher}
            apiOrigin={apiOrigin}
            csrfToken={state.session.csrfToken}
            onUnauthenticated={onUnauthenticated}
            onRetryCapabilities={onRetryCapabilities}
          />
        )}
      {state.capabilities?.features['library.scan']?.permission === 'denied' && (
        <section className={styles.section}>
          <h2>{copy['scan.title']}</h2>
          <p className={styles.secondary}>{copy['scan.adminOnly']}</p>
        </section>
      )}
      {clientFeatures['automation.tokens'] &&
        state.session &&
        !state.busy &&
        state.capabilities?.features['automation.tokens']?.supported === true &&
        (state.capabilities.features['automation.tokens']?.permission === 'allowed' ? (
          <AccessTokensPanel
            key={JSON.stringify([
              state.session.username,
              state.session.csrfToken,
              state.capabilities.instanceId,
              state.capabilities.revision,
              state.capabilities.features['automation.tokens'],
            ])}
            locale={locale}
            fetcher={fetcher}
            apiOrigin={apiOrigin}
            csrfToken={state.session.csrfToken}
            unavailable={
              state.capabilities.features['automation.tokens']?.availability !== 'available'
            }
            onRetryCapabilities={onRetryCapabilities}
            onUnauthenticated={onUnauthenticated}
          />
        ) : (
          <section className={styles.section}>
            <h2>{copy['tokens.title']}</h2>
            <p>{copy['tokens.denied']}</p>
          </section>
        ))}
      {manager && state.session && (
        <EngineStatusPanel
          key={JSON.stringify([
            state.capabilities?.instanceId,
            state.capabilities?.revision,
            state.session.username,
            state.session.csrfToken,
            feature,
          ])}
          locale={locale}
          fetcher={fetcher}
          apiOrigin={apiOrigin}
          csrfToken={state.session.csrfToken}
          unavailable={feature?.availability === 'temporarily_unavailable'}
          onRetryCapabilities={onRetryCapabilities}
          onUnauthenticated={onUnauthenticated}
        />
      )}
    </div>
  );
}
