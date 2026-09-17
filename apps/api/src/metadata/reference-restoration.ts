import type { SubsonicClient } from '../subsonic/client.js';
import {
  captureMetadataReferences,
  decodeMetadataReferences,
  type MetadataReferences,
} from './reference-check.js';

type ReferenceClient = Pick<
  SubsonicClient,
  'getPlaylist' | 'createPlaylist' | 'getPlaylists' | 'getStarred2' | 'starSong'
>;

const same = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

/** Restores only the authenticated account's exact pre-move references. */
export async function restoreMetadataReferencesForSuccessor(input: {
  client: ReferenceClient;
  username: string;
  baseline: MetadataReferences;
  newTrackId: string;
  predecessorTrackIds?: readonly string[];
  allowIdentityReuse?: boolean;
  signal?: AbortSignal;
}) {
  const baseline = decodeMetadataReferences(input.baseline);
  const identityReused = baseline.trackId === input.newTrackId;
  const predecessorTrackIds = [...new Set(input.predecessorTrackIds ?? [baseline.trackId])].filter(
    (trackId) => trackId !== input.newTrackId,
  );
  if (
    (identityReused && !input.allowIdentityReuse) ||
    (!identityReused && !predecessorTrackIds.includes(baseline.trackId))
  )
    throw new Error('reference_conflict');
  const predecessorSet = new Set(predecessorTrackIds);
  const migratePredecessors = (values: readonly string[]) =>
    values.map((value) => (predecessorSet.has(value) ? input.newTrackId : value));
  const withoutPredecessors = (values: readonly string[]) =>
    values.filter((value) => !predecessorSet.has(value));
  const collapsedSuccessor = (values: readonly string[]) => {
    let seen = false;
    return migratePredecessors(values).filter((value) => {
      if (value !== input.newTrackId) return true;
      if (seen) return false;
      seen = true;
      return true;
    });
  };
  const request = input.signal ? { signal: input.signal } : undefined;
  for (const entry of baseline.playlists) {
    let current = await input.client.getPlaylist(entry.id, request);
    const currentIds = current.entry.map(({ id }) => id);
    const desired = migratePredecessors(entry.songIds);
    const metadataMatches =
      current.name === entry.name &&
      current.owner === entry.owner &&
      current.owner === input.username;
    const allowed =
      same(currentIds, entry.songIds) ||
      same(currentIds, withoutPredecessors(entry.songIds)) ||
      same(currentIds, collapsedSuccessor(entry.songIds));
    if (!metadataMatches || (!allowed && !same(currentIds, desired)))
      throw new Error('reference_conflict');
    if (!same(currentIds, desired)) {
      try {
        await input.client.createPlaylist({
          playlistId: entry.id,
          name: current.name,
          songIds: desired,
          ...(input.signal ? { signal: input.signal } : {}),
        });
      } catch {
        // Exact authenticated readback below decides an uncertain write.
      }
      current = await input.client.getPlaylist(entry.id, request);
    }
    if (
      !same(
        current.entry.map(({ id }) => id),
        desired,
      )
    )
      throw new Error('reference_conflict');
  }
  let starred = (await input.client.getStarred2(request)).some(({ id }) => id === input.newTrackId);
  if (baseline.starred && !starred) {
    try {
      await input.client.starSong(input.newTrackId, request);
    } catch {
      // Exact authenticated readback below decides an uncertain write.
    }
    starred = (await input.client.getStarred2(request)).some(({ id }) => id === input.newTrackId);
  }
  if (starred !== baseline.starred) throw new Error('reference_conflict');
  const actual = await captureMetadataReferences(input.client, input.newTrackId, input.signal);
  const expected: MetadataReferences = {
    trackId: input.newTrackId,
    starred: baseline.starred,
    playlists: baseline.playlists.map((entry) => ({
      ...entry,
      songIds: migratePredecessors(entry.songIds),
    })),
  };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('reference_conflict');
  return expected;
}
