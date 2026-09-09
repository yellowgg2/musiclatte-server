import { messages, type Locale } from '../../i18n';
import type { PlaybackPreference } from '../../player/use-playback-quality';
import { usePlayer } from '../../player/PlayerProvider';
import styles from '../../app/Shell.module.css';
export function PlaybackQualityPanel({
  locale,
  enabled,
  preference,
}: {
  locale: Locale;
  enabled: boolean;
  preference: PlaybackPreference;
}) {
  const copy = messages[locale];
  const player = usePlayer();
  return (
    <section className={styles.section} aria-labelledby="quality-heading">
      <h2 id="quality-heading">{copy['quality.title']}</h2>
      <fieldset disabled={!enabled || !preference.scope}>
        <legend>{copy['quality.preference']}</legend>
        {(['original', 'economy'] as const).map((value) => (
          <label key={value} className={styles.qualityOption}>
            <input
              type="radio"
              name="playback-quality"
              value={value}
              checked={preference.value === value}
              onChange={() => preference.set(value)}
            />
            {copy[`quality.${value}`]}
          </label>
        ))}
      </fieldset>
      <p>{copy[enabled ? 'quality.next' : 'quality.unavailable']}</p>
      {!preference.value && <p className={styles.secondary}>{copy['quality.default']}</p>}
      <p>
        {copy['quality.current']}:{' '}
        {
          copy[
            player.quality.active
              ? (`quality.${player.quality.active.effectiveQuality}` as const)
              : 'quality.server'
          ]
        }
      </p>
    </section>
  );
}
