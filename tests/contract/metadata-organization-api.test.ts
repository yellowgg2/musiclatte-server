import { describe, expect, it } from 'vitest';
import {
  decodeOrganizationCandidates,
  decodeOrganizationJobResponse,
  decodeOrganizationPreview,
} from '../../packages/contracts/src/metadata-organization.js';

describe('metadata organization public contract', () => {
  const job = {
    schemaVersion: 1,
    job: {
      id: 'job',
      itemId: 'item',
      libraryId: 'library',
      trackId: 'old',
      newTrackId: null,
      stage: 'queued',
      errorCode: null,
      nextOwner: null,
    },
  };

  it('accepts strict candidate, preview, and private-data-free job DTOs', () => {
    expect(
      decodeOrganizationCandidates({
        schemaVersion: 1,
        total: 1,
        candidates: [
          {
            trackId: 'track',
            libraryId: 'library',
            title: 'Title',
            artist: ['Artist'],
            album: 'Album',
            currentRevision: 'revision',
            importSourceId: 'source',
          },
        ],
      }).total,
    ).toBe(1);
    expect(
      decodeOrganizationPreview({
        schemaVersion: 1,
        trackId: 'track',
        libraryId: 'library',
        currentRevision: 'revision',
        currentKey: 'root/account/old.mp3',
        targetKey: 'root/account/ID3-managed/Artist/Album/01 - Title.mp3',
        writeGuaranteed: false,
        status: 'ready',
        code: null,
      }).status,
    ).toBe('ready');
    expect(decodeOrganizationJobResponse(job)).toEqual(job);
    expect(JSON.stringify(job)).not.toMatch(/proof|digest|sourceEvidence|targetKey/);
  });

  it.each([
    { ...job, token: 'secret' },
    { ...job, job: { ...job.job, sourceKey: 'private/path.mp3' } },
    { ...job, job: { ...job.job, stage: 'unknown' } },
    { ...job, job: { ...job.job, newTrackId: '' } },
  ])('rejects expanded or malformed job DTO %#', (value) => {
    expect(() => decodeOrganizationJobResponse(value)).toThrow();
  });

  /** Selection DTOs preserve ordered occurrence indexes and reject private or malformed fields. */
  it('should strictly decode collection selection responses', async () => {
    const contract =
      (await import('../../packages/contracts/src/metadata-organization.js')) as Record<
        string,
        unknown
      >;
    const decodeOrganizationSelection = contract.decodeOrganizationSelection;
    expect(decodeOrganizationSelection).toBeTypeOf('function');
    if (typeof decodeOrganizationSelection !== 'function') return;
    const selection = {
      schemaVersion: 1,
      capturedAt: 1000,
      source: { kind: 'playlist', playlistId: 'pl-1', name: 'Synthetic List' },
      selectionRevision: 'a'.repeat(64),
      occurrenceCount: 3,
      uniqueTrackCount: 2,
      items: [
        {
          trackId: 'A',
          title: 'A',
          artist: null,
          album: null,
          occurrenceIndexes: [0, 2],
        },
        {
          trackId: 'B',
          title: 'B',
          artist: 'Artist',
          album: 'Album',
          occurrenceIndexes: [1],
        },
      ],
    };
    expect(decodeOrganizationSelection(selection)).toEqual(selection);
    for (const invalid of [
      { ...selection, path: '/private/music.mp3' },
      { ...selection, occurrenceCount: 2 },
      { ...selection, uniqueTrackCount: 3 },
      { ...selection, selectionRevision: 'not-opaque' },
      {
        ...selection,
        items: [selection.items[0], { ...selection.items[1], trackId: 'A' }],
      },
      {
        ...selection,
        items: [{ ...selection.items[0], occurrenceIndexes: [2, 0] }, selection.items[1]],
      },
    ])
      expect(() => decodeOrganizationSelection(invalid)).toThrow();
  });
});
