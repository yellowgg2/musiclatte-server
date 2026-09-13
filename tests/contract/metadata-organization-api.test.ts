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

  /** Bulk status DTOs preserve target identity and order while rejecting malformed or private fields. */
  it('should strictly decode bounded organization status requests and responses', async () => {
    const contract =
      (await import('../../packages/contracts/src/metadata-organization.js')) as Record<
        string,
        unknown
      >;
    const decodeRequest = contract.decodeOrganizationStatusRequest;
    const decodeResponse = contract.decodeOrganizationStatusResponse;
    expect(decodeRequest).toBeTypeOf('function');
    expect(decodeResponse).toBeTypeOf('function');
    if (typeof decodeRequest !== 'function' || typeof decodeResponse !== 'function') return;

    const targets = [
      { kind: 'track', trackId: 'track-1' },
      { kind: 'media_link', mediaLinkId: 'media-1' },
    ];
    const request = { schemaVersion: 1, targets };
    const response = {
      schemaVersion: 1,
      capturedAt: 1000,
      items: [
        {
          target: targets[0],
          state: 'organized',
          reason: 'verified',
          stage: 'succeeded',
          changedAt: 900,
        },
        {
          target: targets[1],
          state: 'unknown',
          reason: 'identity_unavailable',
          stage: null,
          changedAt: null,
        },
      ],
    };
    expect(decodeRequest(request)).toEqual(request);
    expect(decodeResponse(response)).toEqual(response);
    expect(decodeResponse(response).items.map((item: { target: unknown }) => item.target)).toEqual(
      targets,
    );

    for (const invalid of [
      { ...request, privatePath: '/music/private.mp3' },
      { schemaVersion: 2, targets },
      { schemaVersion: 1, targets: [] },
      {
        schemaVersion: 1,
        targets: Array.from({ length: 101 }, (_, index) => ({
          kind: 'track',
          trackId: `track-${index}`,
        })),
      },
      { schemaVersion: 1, targets: [targets[0], targets[0]] },
      { schemaVersion: 1, targets: [{ kind: 'track', trackId: '' }] },
      { schemaVersion: 1, targets: [{ kind: 'other', trackId: 'track-1' }] },
    ])
      expect(() => decodeRequest(invalid)).toThrow();

    for (const invalid of [
      { ...response, actorTokenId: 'private' },
      { ...response, schemaVersion: 2 },
      { ...response, capturedAt: -1 },
      { ...response, items: [{ ...response.items[0], state: 'other' }, response.items[1]] },
      { ...response, items: [{ ...response.items[0], reason: 'raw_error' }, response.items[1]] },
      {
        ...response,
        items: [{ ...response.items[0], sourceKey: 'private/path.mp3' }, response.items[1]],
      },
      { ...response, items: [{ ...response.items[0], changedAt: -1 }, response.items[1]] },
    ])
      expect(() => decodeResponse(invalid)).toThrow();
  });

  /** Every internal lifecycle stage and succeeded freshness case maps to one bounded public state. */
  it('should exhaustively map organization facts without treating moved as organized', async () => {
    const contract =
      (await import('../../packages/contracts/src/metadata-organization.js')) as Record<
        string,
        unknown
      >;
    const mapState = contract.mapOrganizationState;
    const stages = contract.organizationStages;
    expect(mapState).toBeTypeOf('function');
    expect(stages).toBeInstanceOf(Array);
    if (typeof mapState !== 'function' || !Array.isArray(stages)) return;

    const current = {
      identityAvailable: true,
      verificationComplete: true,
      pathMetadataChanged: false,
      bindingMatches: true,
      policyMatches: true,
    };
    const expectedByStage = new Map([
      ['queued', ['processing', 'job_active']],
      ['validating', ['processing', 'job_active']],
      ['references_captured', ['processing', 'job_active']],
      ['moving', ['processing', 'job_active']],
      ['moved', ['processing', 'job_active']],
      ['scanning', ['processing', 'job_active']],
      ['rebound', ['processing', 'job_active']],
      ['migrating_references', ['processing', 'job_active']],
      ['verifying', ['processing', 'job_active']],
      ['succeeded', ['organized', 'verified']],
      ['failed', ['attention', 'job_failed']],
      ['conflict', ['attention', 'job_conflict']],
      ['recovery_required', ['attention', 'recovery_required']],
    ]);
    expect(stages).toHaveLength(expectedByStage.size);
    for (const stage of stages)
      expect(mapState({ ...current, stage })).toEqual({
        state: expectedByStage.get(stage)?.[0],
        reason: expectedByStage.get(stage)?.[1],
      });

    expect(mapState({ ...current, stage: null })).toEqual({
      state: 'needs_organization',
      reason: 'never_organized',
    });
    expect(mapState({ ...current, stage: 'succeeded', pathMetadataChanged: true })).toEqual({
      state: 'needs_organization',
      reason: 'path_metadata_changed',
    });
    expect(mapState({ ...current, stage: 'succeeded', bindingMatches: false })).toEqual({
      state: 'needs_organization',
      reason: 'path_binding_changed',
    });
    expect(mapState({ ...current, stage: 'succeeded', policyMatches: false })).toEqual({
      state: 'needs_organization',
      reason: 'policy_changed',
    });
    expect(mapState({ ...current, stage: 'succeeded', verificationComplete: false })).toEqual({
      state: 'unknown',
      reason: 'verification_missing',
    });
    expect(mapState({ ...current, stage: 'succeeded', identityAvailable: false })).toEqual({
      state: 'unknown',
      reason: 'identity_unavailable',
    });
  });
});
