import type {
  MusicEntry,
  OrganizationSelection,
  OrganizationSelectionSource,
} from '@musiclatte/contracts';
import { ApiError } from '../auth/session-service.js';

const maximumSelectionSize = 1000;

export function createOrganizationSelection(input: {
  capturedAt: number;
  source: OrganizationSelectionSource;
  songs: readonly Pick<MusicEntry, 'id' | 'title' | 'artist' | 'album' | 'isDir'>[];
  actorCredentialFingerprint: unknown;
  revision(value: unknown): string;
}): OrganizationSelection {
  if (input.songs.length > maximumSelectionSize) throw new ApiError(422, 'selection_too_large');
  const items: OrganizationSelection['items'] = [];
  const indexes = new Map<string, number>();
  input.songs.forEach((song, occurrenceIndex) => {
    const existing = indexes.get(song.id);
    if (existing !== undefined) {
      items[existing]!.occurrenceIndexes.push(occurrenceIndex);
      return;
    }
    indexes.set(song.id, items.length);
    items.push({
      trackId: song.id,
      title: song.title,
      artist: song.artist ?? null,
      album: song.album ?? null,
      occurrenceIndexes: [occurrenceIndex],
    });
  });
  if (items.length > maximumSelectionSize) throw new ApiError(422, 'selection_too_large');
  const selectionRevision = input.revision([
    input.actorCredentialFingerprint,
    input.source,
    items.map(({ trackId, occurrenceIndexes }) => [trackId, occurrenceIndexes]),
  ]);
  return {
    schemaVersion: 1,
    capturedAt: input.capturedAt,
    source: input.source,
    selectionRevision,
    occurrenceCount: input.songs.length,
    uniqueTrackCount: items.length,
    items,
  };
}
