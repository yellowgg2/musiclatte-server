import type { FeatureCapability, FeatureKey, CapabilitiesResponse } from '@musiclatte/contracts';
/** S06 has no music/playlist/import consumer. First owners explicitly opt in later. */
export const clientFeatures = {
  'music.browse': false,
  'music.stream': false,
  'library.randomSongs': false,
  'library.scan': false,
  'playlists.read': false,
  'playlists.write': false,
  'favorites.songs': false,
  'library.recentDownloads': false,
  'imports.youtube': false,
  'engine.manage': false,
  'metadata.write': false,
  'metadata.lyrics.write': false,
  'metadata.curation': false,
  'automation.tokens': false,
} satisfies Record<FeatureKey, boolean>;
export function featureState(feature: FeatureCapability | undefined) {
  if (feature?.supported === false) return 'unsupported';
  if (feature?.permission === 'denied') return 'denied';
  if (feature?.availability === 'temporarily_unavailable') return 'unavailable';
  if (
    feature?.supported === true &&
    feature.permission === 'allowed' &&
    feature.availability === 'available'
  )
    return 'available';
  return 'unknown';
}
export function availableEntries(
  capabilities: CapabilitiesResponse | null,
  implemented: Record<FeatureKey, boolean> = clientFeatures,
): FeatureKey[] {
  return (Object.keys(implemented) as FeatureKey[]).filter(
    (key) => implemented[key] && featureState(capabilities?.features[key]) === 'available',
  );
}
