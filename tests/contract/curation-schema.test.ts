import { expect, it } from 'vitest';
import {
  curationFields,
  decodeCurationPolicy,
  decodeCurationTrack,
  decodeFieldState,
  metadataFields,
} from '@musiclatte/contracts';
import { createCurationPolicy } from '../../apps/api/src/curation/policy.js';
import { createCurationRepository } from '../../apps/api/src/storage/curation-repository.js';
import { createTestContext } from '../support/session-storage-harness.js';

it('decodes actual stored projections and rejects invented completion, secrets and field states', async () => {
  const c = await createTestContext();
  try {
    const limits = {
      claimLeaseMs: 1000,
      maxTargets: 10,
      snapshotMaxAgeMs: 1000,
      snapshotMaxItems: 100,
      snapshotMaxCount: 10,
    };
    const policy = createCurationPolicy(limits);
    expect(decodeCurationPolicy(JSON.parse(JSON.stringify(policy)))).toEqual(policy);
    expect(() =>
      decodeCurationPolicy({
        ...policy,
        supportedFieldsByFormat: {
          mp3: policy.supportedFieldsByFormat.mp3,
          unsupported: ['lyrics'],
        },
      }),
    ).toThrow();
    const repo = createCurationRepository({
      database: c.db,
      clock: () => 1000,
      cursorKey: new Uint8Array(32),
      limits,
    });
    const id = repo.discover({
      libraryId: 'synthetic-library',
      trackId: 'opaque-track',
      format: 'mp3',
      fileIdentity: '/private/must-not-escape',
    });
    const track = repo.get(id)!;
    expect(decodeCurationTrack(JSON.parse(JSON.stringify(track)))).toEqual(track);
    const legacyFields = Object.fromEntries(
      Object.entries(track.fieldStates).filter(([field]) =>
        ['title', 'artist', 'album', 'cover', 'lyrics'].includes(field),
      ),
    );
    expect(
      decodeCurationTrack({ ...JSON.parse(JSON.stringify(track)), fieldStates: legacyFields })
        .fieldStates.albumArtist.status,
    ).toBe('unknown');
    expect(JSON.stringify(track)).not.toContain('/private');
    expect(() => decodeCurationTrack({ ...track, curationStatus: 'completed' })).toThrow();
    expect(() => decodeCurationTrack({ ...track, digest: 'secret' })).toThrow();
    expect(() => decodeCurationTrack({ ...track, lyricsState: 'missing' })).toThrow();
    expect(() => decodeFieldState({ ...track.fieldStates.lyrics, status: 'present' })).toThrow();
    expect(() =>
      decodeFieldState({
        ...track.fieldStates.lyrics,
        status: 'unavailable',
        evidenceRevision: 'r1',
      }),
    ).toThrow();
  } finally {
    c.cleanup();
  }
});

/** The curation contract advertises every field the canonical metadata writer accepts. */
it('should keep curation policy fields aligned with the metadata writer', () => {
  const policy = createCurationPolicy({
    claimLeaseMs: 1000,
    maxTargets: 10,
    snapshotMaxAgeMs: 1000,
    snapshotMaxItems: 100,
    snapshotMaxCount: 10,
  });
  expect(curationFields).toEqual(metadataFields);
  expect(policy.supportedFieldsByFormat.mp3).toEqual(metadataFields);
  expect(policy.requiredFields).toEqual(['title', 'artist']);
  expect(policy.optionalFields).toEqual([
    'album',
    'albumArtist',
    'trackNumber',
    'year',
    'genre',
    'cover',
    'lyrics',
  ]);
  expect(Object.keys(policy.allowedAttemptStatusesByField)).toEqual(policy.optionalFields);
});
