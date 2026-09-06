import type { FeatureCapability, FeatureKey, CapabilitiesResponse } from '@musiclatte/contracts';
/** S08 enables browsing; transport and future product consumers remain closed. */
export const clientFeatures = {
  'music.browse': true,
  'music.stream': true,
  'library.randomSongs': true,
  'library.scan': false,
  'playlists.read': true,
  'playlists.write': true,
  'favorites.songs': true,
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
