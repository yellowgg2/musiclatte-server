/** Synthetic source-shaped payloads; no real library data or credential-bearing URLs. */
export function listeningFixture(operation: string) {
  const payloads: Record<string, unknown> = {
    getGenres: { genres: { genre: [{ value: 'Jazz', songCount: 2, albumCount: 1 }] } },
    getArtistInfo2: {
      artistInfo2: {
        biography: 'Synthetic biography',
        similarArtist: [{ id: 'ar-2', name: 'Synthetic artist' }],
      },
    },
    getOpenSubsonicExtensions: {
      openSubsonicExtensions: [{ name: 'transcodeOffset', versions: [1] }],
    },
    scrobble: {},
  };
  return {
    'subsonic-response': { status: 'ok', version: '1.15.0', ...Object(payloads[operation]) },
  };
}

import type { CapabilitiesResponse } from '@musiclatte/contracts';
/** Frozen pre-P7 decoder and recognized keys for forward compatibility. */
const featureKeys = [
  'music.browse',
  'music.stream',
  'library.randomSongs',
  'library.scan',
  'playlists.read',
  'playlists.write',
  'favorites.songs',
  'library.recentDownloads',
  'imports.youtube',
  'engine.manage',
  'metadata.write',
  'metadata.lyrics.write',
  'metadata.curation',
  'automation.tokens',
] as const;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid private schema');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid private schema');
  return value;
}
export function decodePreListeningCapabilities(value: unknown): CapabilitiesResponse {
  const v = record(value);
  const source = record(v.features);
  if (v.schemaVersion !== 1 || !Object.hasOwn(source, 'music.browse'))
    throw new Error('Invalid private schema');
  const features: CapabilitiesResponse['features'] = {};
  for (const key of featureKeys) {
    if (!Object.hasOwn(source, key)) continue;
    const f = record(source[key]);
    const { supported, permission, availability } = f;
    if (supported !== true && supported !== false && supported !== null)
      throw new Error('Invalid private schema');
    if (permission !== 'allowed' && permission !== 'denied' && permission !== 'unknown')
      throw new Error('Invalid private schema');
    if (
      availability !== 'available' &&
      availability !== 'temporarily_unavailable' &&
      availability !== 'unknown'
    )
      throw new Error('Invalid private schema');
    features[key] = { supported, permission, availability };
    for (const descriptor of ['formats', 'fields', 'bulkFields'] as const) {
      if (!Object.hasOwn(f, descriptor)) continue;
      const entries = f[descriptor];
      if (
        !Array.isArray(entries) ||
        entries.length > 64 ||
        new Set(entries).size !== entries.length ||
        entries.some((entry) => typeof entry !== 'string' || !entry.trim() || entry.length > 64)
      )
        throw new Error('Invalid private schema');
      features[key][descriptor] = [...entries];
    }
  }
  return { schemaVersion: 1, instanceId: text(v.instanceId), revision: text(v.revision), features };
}
