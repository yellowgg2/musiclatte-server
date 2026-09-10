import { IconAction } from '../design/components/IconAction';
import { messages, type Locale } from '../i18n';
import { nextRepeatMode, type RepeatMode } from './queue';
import styles from './RepeatAction.module.css';

export function RepeatAction({
  mode,
  locale,
  onCycle,
}: {
  mode: RepeatMode;
  locale: Locale;
  onCycle: () => void;
}) {
  const copy = messages[locale];
  const next = nextRepeatMode(mode);
  const label = copy['player.repeat.label']
    .replace('{current}', copy[`player.repeat.${mode}`])
    .replace('{next}', copy[`player.repeat.${next}`]);

  return (
    <IconAction
      label={label}
      pressed={mode !== 'off'}
      onClick={onCycle}
      data-repeat-mode={mode}
      className={styles.action}
    >
      <svg
        className={styles.glyph}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M17 3l4 4-4 4" />
        <path d="M21 7H8a5 5 0 0 0-5 5" />
        <path d="M7 21l-4-4 4-4" />
        <path d="M3 17h13a5 5 0 0 0 5-5" />
        {mode === 'off' && (
          <path className={styles.slash} data-repeat-marker="off" d="M5 3l14 18" />
        )}
        {mode === 'one' && (
          <text className={styles.one} data-repeat-marker="one" x="12" y="15.5">
            1
          </text>
        )}
      </svg>
    </IconAction>
  );
}
