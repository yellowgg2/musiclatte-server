import { PlaybackQualityPanel } from './settings/PlaybackQualityPanel';
import type { PlaybackPreference } from '../player/use-playback-quality';
import { AccessTokensPanel } from './settings/AccessTokensPanel';
import { ScanSettingsPanel } from './settings/ScanSettingsPanel';
import { EngineStatusPanel } from './settings/EngineStatusPanel';
import { clientFeatures } from '../capabilities/client-features';
import type { SessionState } from '../auth/session-store';
import { messages, type Locale } from '../i18n';
import styles from '../app/Shell.module.css';
export function SettingsPage({
  playbackQuality,
  state,
  locale,
  fetcher,
  apiOrigin,
  onRetryCapabilities,
  onUnauthenticated,
}: {
  playbackQuality?: { enabled: boolean; preference: PlaybackPreference };
  state: SessionState;
  locale: Locale;
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
      {playbackQuality && <PlaybackQualityPanel locale={locale} {...playbackQuality} />}
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
            metadataCapability={state.capabilities.features['metadata.write']}
            organizationCapability={state.capabilities.features['metadata.organization']}
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
