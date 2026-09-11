import type { SubsonicClient } from '../subsonic/client.js';
export interface MetadataReferences {
  trackId: string;
  starred: boolean;
  playlists: { id: string; name?: string; owner?: string; songIds: string[] }[];
}
export function decodeMetadataReferences(value: unknown): MetadataReferences {
  const v = value as MetadataReferences;
  const id = (x: unknown) => typeof x === 'string' && x.length > 0 && x.length <= 2048;
  if (
    !v ||
    Object.keys(v).length !== 3 ||
    !id(v.trackId) ||
    typeof v.starred !== 'boolean' ||
    !Array.isArray(v.playlists) ||
    v.playlists.length > 1000 ||
    !v.playlists.every((p) => {
      if (!p || ![2, 4].includes(Object.keys(p).length) || !id(p.id) || !Array.isArray(p.songIds))
        return false;
      if (p.songIds.some((songId) => !id(songId))) return false;
      const detailed = p.name !== undefined || p.owner !== undefined;
      return detailed ? id(p.name) && id(p.owner) : true;
    }) ||
    new Set(v.playlists.map((p) => p.id)).size !== v.playlists.length ||
    v.playlists.reduce((n, p) => n + p.songIds.length, 0) > 100000
  )
    throw new Error('reference_conflict');
  return v;
}
/** Scope is the authenticated account's visible playlists only. No foreign-account claim. */
export async function captureMetadataReferences(
  client: SubsonicClient,
  trackId: string,
  signal?: AbortSignal,
): Promise<MetadataReferences> {
  const options = signal ? { signal } : {};
  const lists = await client.getPlaylists(options);
  if (lists.length > 1000) throw new Error('reference_conflict');
  const playlists: MetadataReferences['playlists'] = [];
  let entries = 0;
  for (const list of lists) {
    const detail = await client.getPlaylist(list.id, options);
    entries += detail.entry.length;
    if (entries > 100000) throw new Error('reference_conflict');
    if (detail.entry.some((entry) => entry.id === trackId))
      playlists.push({
        id: detail.id,
        name: detail.name,
        owner: detail.owner,
        songIds: detail.entry.map((entry) => entry.id),
      });
  }
  return {
    trackId,
    starred: (await client.getStarred2(options)).some((song) => song.id === trackId),
    playlists: playlists.sort((a, b) => a.id.localeCompare(b.id)),
  };
}
export function compareMetadataReferences(
  before: MetadataReferences,
  after: MetadataReferences,
): boolean {
  const ordered = (value: MetadataReferences) =>
    [...value.playlists].sort((a, b) => a.id.localeCompare(b.id));
  return (
    before.trackId === after.trackId &&
    before.starred === after.starred &&
    JSON.stringify(ordered(before)) === JSON.stringify(ordered(after))
  );
}
