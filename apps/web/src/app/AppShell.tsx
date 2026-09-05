import type { ReactNode } from 'react';
import type { CapabilitiesResponse } from '@musiclatte/contracts';
import { availableEntries } from '../capabilities/client-features';
import { messages, type Locale } from '../i18n';
import styles from './Shell.module.css';
export function AppShell({
  locale,
  base,
  capabilities,
  children,
}: {
  locale: Locale;
  base: string;
  capabilities: CapabilitiesResponse | null;
  children: ReactNode;
}) {
  const copy = messages[locale];
  // Both direct route guards and the navigation registry stay closed until a consumer exists.
  const entries = availableEntries(capabilities);
  return (
    <div className={styles.shell} data-available-features={entries.join(' ')}>
      <a className={styles.skip} href="#main">
        {copy['shell.skip']}
      </a>
      <header className={styles.shellBrand}>
        <span className={styles.brand}>
          <img
            src={`${base}icons/musiclatte-192.png`}
            width="32"
            height="32"
            alt=""
            className={styles.brandIcon}
          />
          Musiclatte
        </span>
      </header>
      <nav aria-label={copy['shell.navigation']} className={styles.navigation}>
        {entries.includes('music.browse') && (
          <a
            href={`${base}music`}
            aria-current={window.location.pathname.startsWith(`${base}music`) ? 'page' : undefined}
          >
            <svg
              viewBox="0 0 24 24"
              width="22"
              height="22"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
            >
              <path d="M9 17V5l11-2v12M9 9l11-2" />
              <ellipse cx="6" cy="18" rx="3" ry="2" />
              <ellipse cx="17" cy="16" rx="3" ry="2" />
            </svg>
            {copy['music.title']}
          </a>
        )}

        <a
          href={`${base}settings`}
          aria-current={window.location.pathname.startsWith(`${base}settings`) ? 'page' : undefined}
        >
          <svg
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden="true"
          >
            <path d="M4 7h16M4 17h16" />
            <circle cx="9" cy="7" r="3" fill="var(--color-selection)" />
            <circle cx="15" cy="17" r="3" fill="var(--color-selection)" />
          </svg>
          {copy['shell.settings']}
        </a>
      </nav>
      <main id="main" tabIndex={-1} className={styles.content}>
        {children}
      </main>
    </div>
  );
}
