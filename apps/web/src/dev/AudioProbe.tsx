import { mediaRoutes } from '@musiclatte/contracts';
import { LanguagePicker } from '../app/LanguagePicker';
import { messages } from '../i18n';
import { useLocale } from '../i18n/locale';

export const MUSICLATTE_AUDIO_PROBE = 'MUSICLATTE_AUDIO_PROBE';

function parameter(name: string, fallback: string): string {
  const value = new URLSearchParams(window.location.search).get(name);
  return value && value.length <= 2_048 ? value : fallback;
}

/** Development-only native media transport surface; never rendered by a production route. */
export function AudioProbe() {
  const [locale, onLocale] = useLocale();
  const copy = messages[locale];
  const songId = parameter('songId', 'probe-song');
  const coverId = parameter('coverId', 'probe-cover');
  return (
    <main data-probe={MUSICLATTE_AUDIO_PROBE}>
      <LanguagePicker locale={locale} onChange={onLocale} />
      <h1>{copy['probe.title']}</h1>
      <p>{copy['probe.instructions']}</p>
      <audio
        controls
        preload="metadata"
        aria-label={copy['probe.audioLabel']}
        src={mediaRoutes.songStream(songId)}
      />
      <img src={mediaRoutes.cover(coverId)} alt={copy['probe.coverAlt']} width="128" height="128" />
    </main>
  );
}
