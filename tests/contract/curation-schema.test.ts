import { expect, it } from 'vitest';
import { decodeCurationPolicy, decodeCurationTrack, decodeFieldState } from '@musiclatte/contracts';
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
