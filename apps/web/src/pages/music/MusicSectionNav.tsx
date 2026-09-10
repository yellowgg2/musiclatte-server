import { SectionNav } from '../../design/components/SectionNav';
import { messages, type Locale } from '../../i18n';

export interface MusicSectionAvailability {
  listening: boolean;
  mixes: boolean;
  curation: boolean;
  recent: boolean;
  favorites: boolean;
}

export type MusicSection =
  'music' | 'history' | 'top' | 'mixes' | 'curation' | 'recent' | 'favorites';

export function MusicSectionNav({
  base,
  locale,
  current,
  available,
}: {
  base: string;
  locale: Locale;
  current: MusicSection;
  available: MusicSectionAvailability;
}) {
  const copy = messages[locale];
  const item = (section: MusicSection, label: string, path: string) => ({
    label,
    href: `${base}${path}`,
    current: current === section,
  });
  return (
    <SectionNav
      label={copy['music.title']}
      variant="tabs"
      items={[
        item('music', copy['music.all'], 'music'),
        ...(available.listening
          ? [
              item('history', copy['listening.history'], 'music/history'),
              item('top', copy['listening.top'], 'music/top'),
            ]
          : []),
        ...(available.mixes ? [item('mixes', copy['mix.title'], 'music/mixes')] : []),
        ...(available.curation ? [item('curation', copy['curation.title'], 'music/curation')] : []),
        ...(available.recent ? [item('recent', copy['recent.title'], 'music/recent')] : []),
        ...(available.favorites
          ? [item('favorites', copy['favorites.title'], 'music/favorites')]
          : []),
      ]}
    />
  );
}
