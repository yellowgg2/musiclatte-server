export const featureKeys = ['music.browse', 'music.stream', 'library.randomSongs', 'library.scan', 'playlists.read', 'playlists.write', 'favorites.songs', 'library.recentDownloads', 'imports.youtube', 'engine.manage', 'metadata.write', 'metadata.lyrics.write', 'metadata.curation', 'automation.tokens'] as const;
export type FeatureKey = typeof featureKeys[number];
export interface FeatureCapability { supported: boolean | null; permission: 'allowed' | 'denied' | 'unknown'; availability: 'available' | 'temporarily_unavailable' | 'unknown' }
export interface CapabilitiesResponse { schemaVersion: 1; instanceId: string; revision: string; features: Partial<Record<FeatureKey, FeatureCapability>> }
export interface DiscoveryResponse { protocol: 'musiclatte-server'; schemaVersion: 1; instanceId: string; apiBase: '/api/v1'; authSchemes: ('cookie' | 'bearer')[] }
const string = { type: 'string', minLength: 1 } as const;
export const featureCapabilitySchema = { type: 'object', required: ['supported', 'permission', 'availability'], properties: { supported: { type: ['boolean', 'null'] }, permission: { enum: ['allowed', 'denied', 'unknown'] }, availability: { enum: ['available', 'temporarily_unavailable', 'unknown'] } } } as const;
export const capabilitiesSchema = { type: 'object', required: ['schemaVersion', 'instanceId', 'revision', 'features'], properties: { schemaVersion: { const: 1 }, instanceId: string, revision: string, features: { type: 'object', required: ['music.browse'], properties: Object.fromEntries(featureKeys.map(key => [key, featureCapabilitySchema])) } } } as const;
export const discoverySchema = { type: 'object', required: ['protocol', 'schemaVersion', 'instanceId', 'apiBase', 'authSchemes'], properties: { protocol: { const: 'musiclatte-server' }, schemaVersion: { const: 1 }, instanceId: string, apiBase: { const: '/api/v1' }, authSchemes: { type: 'array', minItems: 1, uniqueItems: true, items: { enum: ['cookie', 'bearer'] } } } } as const;
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid private schema'); return value as Record<string, unknown>; }
function text(value: unknown): string { if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid private schema'); return value; }
export function decodeDiscovery(value: unknown): DiscoveryResponse {
  const v = record(value);
  if (v.protocol !== 'musiclatte-server' || v.schemaVersion !== 1 || v.apiBase !== '/api/v1' || !Array.isArray(v.authSchemes) || !v.authSchemes.length || new Set(v.authSchemes).size !== v.authSchemes.length || !v.authSchemes.every(x => x === 'cookie' || x === 'bearer')) throw new Error('Invalid private schema');
  return { protocol: 'musiclatte-server', schemaVersion: 1, instanceId: text(v.instanceId), apiBase: '/api/v1', authSchemes: v.authSchemes };
}
export function decodeCapabilities(value: unknown): CapabilitiesResponse {
  const v = record(value); const source = record(v.features);
  if (v.schemaVersion !== 1 || !Object.hasOwn(source, 'music.browse')) throw new Error('Invalid private schema');
  const features: CapabilitiesResponse['features'] = {};
  for (const key of featureKeys) {
    if (!Object.hasOwn(source, key)) continue;
    const f = record(source[key]); const { supported, permission, availability } = f;
    if (supported !== true && supported !== false && supported !== null) throw new Error('Invalid private schema');
    if (permission !== 'allowed' && permission !== 'denied' && permission !== 'unknown') throw new Error('Invalid private schema');
    if (availability !== 'available' && availability !== 'temporarily_unavailable' && availability !== 'unknown') throw new Error('Invalid private schema');
    features[key] = { supported, permission, availability };
  }
  return { schemaVersion: 1, instanceId: text(v.instanceId), revision: text(v.revision), features };
}
/** Extension discovery failure does not redefine the standard Subsonic connection. */
export function discoveryOutcome(status: number, body: unknown): { extension: 'available' | 'absent' | 'unknown'; standard: 'preserve' } {
  if (status === 404 || status === 410) return { extension: 'absent', standard: 'preserve' };
  if (status === 200) { try { decodeDiscovery(body); return { extension: 'available', standard: 'preserve' }; } catch { /* optional extension only */ } }
  return { extension: 'unknown', standard: 'preserve' };
}
