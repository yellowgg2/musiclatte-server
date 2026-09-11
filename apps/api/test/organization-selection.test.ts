import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

async function loadSelectionModule() {
  return import(resolve('apps/api/src/metadata/organization-selection.ts')).catch(() => ({}));
}

describe('organization collection selection', () => {
  /** First-occurrence ordering keeps every duplicate position without repeating track mutations. */
  it('should freeze duplicate occurrences into one ordered item per track', async () => {
    const module = await loadSelectionModule();
    expect(module).toHaveProperty('createOrganizationSelection');
    if (!('createOrganizationSelection' in module)) return;
    const revision = (value: unknown) =>
      createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const input = {
      capturedAt: 1000,
      source: { kind: 'playlist' as const, playlistId: 'pl-1', name: 'Synthetic List' },
      songs: [
        { id: 'A', title: 'First A', artist: 'Artist A', album: 'Album A', isDir: false },
        { id: 'B', title: 'B', isDir: false },
        { id: 'A', title: 'Second A', artist: 'Changed', isDir: false },
      ],
      actorCredentialFingerprint: 'credential',
      revision,
    };
    const result = module.createOrganizationSelection(input);
    expect(result).toEqual({
      schemaVersion: 1,
      capturedAt: 1000,
      source: input.source,
      selectionRevision: result.selectionRevision,
      occurrenceCount: 3,
      uniqueTrackCount: 2,
      items: [
        {
          trackId: 'A',
          title: 'First A',
          artist: 'Artist A',
          album: 'Album A',
          occurrenceIndexes: [0, 2],
        },
        {
          trackId: 'B',
          title: 'B',
          artist: null,
          album: null,
          occurrenceIndexes: [1],
        },
      ],
    });
    expect(module.createOrganizationSelection(input).selectionRevision).toBe(
      result.selectionRevision,
    );
    expect(
      module.createOrganizationSelection({
        ...input,
        songs: [input.songs[1]!, input.songs[0]!, input.songs[2]!],
      }).selectionRevision,
    ).not.toBe(result.selectionRevision);
  });

  /** Empty collections are valid, while the hard bound rejects instead of truncating. */
  it('should accept zero and 1000 items but reject 1001 occurrences', async () => {
    const module = await loadSelectionModule();
    expect(module).toHaveProperty('createOrganizationSelection');
    if (!('createOrganizationSelection' in module)) return;
    const base = {
      capturedAt: 1000,
      source: { kind: 'favorites' as const },
      actorCredentialFingerprint: 'credential',
      revision: () => 'a'.repeat(64),
    };
    expect(module.createOrganizationSelection({ ...base, songs: [] })).toMatchObject({
      occurrenceCount: 0,
      uniqueTrackCount: 0,
      items: [],
    });
    expect(
      module.createOrganizationSelection({
        ...base,
        songs: Array.from({ length: 1000 }, (_, index) => ({
          id: `track-${index}`,
          title: `Track ${index}`,
          isDir: false,
        })),
      }).occurrenceCount,
    ).toBe(1000);
    expect(() =>
      module.createOrganizationSelection({
        ...base,
        songs: Array.from({ length: 1001 }, (_, index) => ({
          id: `track-${index}`,
          title: `Track ${index}`,
          isDir: false,
        })),
      }),
    ).toThrow('selection_too_large');
  });
});
