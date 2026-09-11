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
});
