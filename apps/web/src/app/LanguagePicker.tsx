import { messages, type Locale } from '../i18n';
import styles from './Shell.module.css';
export function LanguagePicker({
  locale,
  onChange,
}: {
  locale: Locale;
  onChange: (locale: Locale) => void;
}) {
  return (
    <label className={styles.language}>
      {messages[locale]['settings.language']}
      <select value={locale} onChange={(event) => onChange(event.target.value as Locale)}>
        <option value="ko" lang="ko">
          한국어
        </option>
        <option value="en" lang="en">
          English
        </option>
      </select>
    </label>
  );
}
