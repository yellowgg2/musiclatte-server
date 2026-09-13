import { AppShell } from '../app/AppShell';
import { StatusSurface } from '../design/components/StatusSurface';
import { messages } from '../i18n';
import { useLocale } from '../i18n/locale';
import { LanguagePicker } from '../app/LanguagePicker';
import styles from '../app/Shell.module.css';
import { AccountSummaryProvider } from '../account/AccountSummaryProvider';
import { useState } from 'react';
import type { ApiErrorCode, CapabilitiesResponse } from '@musiclatte/contracts';

const capabilities = {
  schemaVersion: 1,
  instanceId: 'shell-fixture',
  revision: 'phase-16',
  features: {
    'music.browse': { supported: true, permission: 'allowed', availability: 'available' },
    'playlists.read': { supported: true, permission: 'allowed', availability: 'available' },
    'favorites.songs': { supported: true, permission: 'allowed', availability: 'available' },
  },
} satisfies CapabilitiesResponse;

/** Development-only deterministic states for the production shell consumer. */
export function ShellFixture() {
  const [locale, onLocale] = useLocale();
  const scenario = new URLSearchParams(window.location.search).get('account') ?? 'normal';
  const username =
    scenario === 'long-name'
      ? 'fixture-listener-with-an-intentionally-long-account-name'
      : 'fixture-listener';
  const [busy, setBusy] = useState(scenario === 'logout-busy');
  const error: ApiErrorCode | null = scenario === 'logout-error' ? 'upstream_unavailable' : null;
  const fetcher: typeof fetch = async () => {
    if (scenario === 'loading') return await new Promise<Response>(() => undefined);
    if (scenario === 'error' || scenario === 'summary-error')
      return Response.json({ error: { code: 'upstream_unavailable' } }, { status: 503 });
    return Response.json({ schemaVersion: 1, favoriteSongCount: 12, playlistCount: 4 });
  };
  return (
    <AccountSummaryProvider
      scope={`shell-fixture:${username}`}
      enabled
      fetcher={fetcher}
      apiOrigin=""
      onUnauthenticated={() => undefined}
    >
      <AppShell
        base={import.meta.env.BASE_URL}
        locale={locale}
        capabilities={capabilities}
        account={{
          username,
          busy,
          error,
          onLogout: () => setBusy(true),
          defaultMobileOpen: scenario === 'mobile-open',
        }}
        player={
          scenario === 'player' ? <div data-persistent-player>Fixture player</div> : undefined
        }
      >
        <div className={styles.settings}>
          <h1>Music shell fixture</h1>
          <LanguagePicker locale={locale} onChange={onLocale} />
          <StatusSurface
            state="empty"
            title={messages[locale]['status.unavailable']}
            description={messages[locale]['status.unavailableHelp']}
          />
        </div>
      </AppShell>
    </AccountSummaryProvider>
  );
}
