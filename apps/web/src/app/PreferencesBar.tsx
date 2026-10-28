import { messages, type Locale } from '../i18n';
import { LanguagePicker } from './LanguagePicker';
import { ThemePicker } from './ThemePicker';
import styles from './Shell.module.css';

export function PreferencesBar({
  locale,
  onLocale,
}: {
  locale: Locale;
  onLocale: (locale: Locale) => void;
}) {
  return (
    <div
      className={styles.preferences}
      role="group"
      aria-label={messages[locale]['settings.displayPreferences']}
    >
      <LanguagePicker locale={locale} onChange={onLocale} />
      <ThemePicker locale={locale} />
    </div>
  );
}
