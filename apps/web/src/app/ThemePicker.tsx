import { useTheme } from '../design/theme';
import { messages, type Locale } from '../i18n';
import styles from './Shell.module.css';

export function ThemePicker({ locale }: { locale: Locale }) {
  const [theme, onTheme] = useTheme();
  const copy = messages[locale];
  return (
    <label className={styles.language}>
      {copy['settings.theme']}
      <select
        value={theme}
        onChange={(event) => onTheme(event.target.value === 'dark' ? 'dark' : 'light')}
      >
        <option value="light">{copy['settings.themeLight']}</option>
        <option value="dark">{copy['settings.themeDark']}</option>
      </select>
    </label>
  );
}
