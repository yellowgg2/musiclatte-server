import { AppShell } from '../app/AppShell';
import { StatusSurface } from '../design/components/StatusSurface';
import { messages } from '../i18n';
import { useLocale } from '../i18n/locale';
import { LanguagePicker } from '../app/LanguagePicker';
import styles from '../app/Shell.module.css';
/** Development-only layout consumer. No music routes or product capability opt-in. */
export function ShellFixture() {
  const [locale, onLocale] = useLocale();
  return (
    <AppShell base={import.meta.env.BASE_URL} locale={locale} capabilities={null}>
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
  );
}
