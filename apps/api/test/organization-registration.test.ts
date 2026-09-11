import { afterEach, expect, it } from 'vitest';
import { createFakeSubsonic } from '../../../packages/test-support/src/fake-subsonic.js';
import type { RegistrationFixture } from '../../../packages/test-support/src/subsonic-fixtures.js';
import { createTestContext } from '../../../tests/support/session-storage-harness.js';
import { proof } from '../../../tests/support/subsonic-harness.js';
import { curationSnapshot } from '../src/curation/reconciliation.js';
import type { MetadataTagSnapshot } from '../src/metadata/helper-client.js';
import { createOrganizationRegistration } from '../src/metadata/organization-registration.js';
import type { OrganizationClaim } from '../src/storage/organization-repository.js';
import { createSubsonicClient } from '../src/subsonic/client.js';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const targetKey = 'jojo-music/account/ID3-managed/Artist/Album/01 - Title.mp3';
const snapshot: MetadataTagSnapshot = {
  id3Version: 4 as const,
  editable: true,
  reason: null,
  values: {
    title: 'Title',
    artist: ['Artist'],
    album: 'Album',
    albumArtist: ['Artist'],
    trackNumber: '1/10',
    year: '2026',
    genre: ['Pop'],
  },
  coverFrames: [],
  lyricsFrames: [],
  fullDigest: 'f'.repeat(64),
  audio: {
    codec: 'mp3',
    packetHash: 'e'.repeat(64),
    packetCount: 10,
    sampleRate: '44100',
    channels: 2,
    duration: '1',
  },
};
const claim: OrganizationClaim = {
  itemId: 'item',
  jobId: 'job',
  libraryId: 'library',
  workerId: 'worker',
  generation: 1,
  stage: 'moved',
  sourceKey: 'jojo-music/account/Legacy/source.mp3',
  targetKey,
  fileIdentity: 'a'.repeat(64),
  audioIdentity: curationSnapshot(snapshot).audioIdentity,
  oldTrackId: 'old-song',
  newTrackId: null,
  preimage: {
    device: '1',
    inode: '2',
    digest: 'd'.repeat(64),
    mode: 0o640,
    uid: 1000,
    gid: 1000,
    audioIdentity: curationSnapshot(snapshot).audioIdentity,
    targetParentDevice: '1',
    targetParentInode: '3',
  },
};

async function setup(candidateId = 'new-song', audioIdentity = claim.audioIdentity) {
  const c = await createTestContext();
  cleanups.push(c.cleanup);
  let now = 1_000;
  const fixture: RegistrationFixture = {
    statuses: [
      { scanning: false, count: 1 },
      { scanning: true, count: 1 },
      { scanning: false, count: 1 },
    ],
    roots: [{ id: 'root', name: 'jojo-music' }],
    directories: {
      root: [{ id: 'account', title: 'account', isDir: true }],
      account: [{ id: 'managed', title: 'ID3-managed', isDir: true }],
      managed: [{ id: 'artist', title: 'Artist', isDir: true }],
      artist: [{ id: 'album', title: 'Album', isDir: true }],
      album: [
        {
          id: candidateId,
          title: 'Title',
          artist: 'Artist',
          album: 'Album',
          track: 1,
          year: 2026,
          genre: 'Pop',
          isDir: false,
          path: targetKey,
        },
      ],
    },
  };
  const upstream = await createFakeSubsonic({ registration: fixture });
  cleanups.push(() => upstream.close());
  const calls: string[] = [];
  const scanClient = createSubsonicClient({ upstream: upstream.url, proof, timeoutMs: 100 });
  const repository = {
    transition: (input: { stage: string }) => calls.push(input.stage),
    resumeRecovery: (input: { stage: string }) => calls.push(`resume:${input.stage}`),
    rebindCurrent: (input: { newTrackId: string }) => {
      calls.push(`bind:${input.newTrackId}`);
      return { trackRef: 'track-ref' };
    },
    completeRegistration: (input: { newTrackId: string }) =>
      calls.push(`complete:${input.newTrackId}`),
  };
  const service = createOrganizationRegistration({
    database: c.db,
    clock: () => now,
    timeoutMs: 100,
    pollMs: 10,
    retryMs: 100,
    wait: async (ms, signal) => {
      signal.throwIfAborted();
      now += ms;
    },
    scanClient,
    libraries: [{ id: 'library', musicFolderId: '0', relativeRoot: 'jojo-music' }],
    repository,
    inspect: async () => ({ snapshot, audioIdentity }),
    sourceAbsent: async () => true,
    fileIdentity: () => 'b'.repeat(64),
    revision: () => 'c'.repeat(64),
    reconcile: (_trackRef, _snapshot, _revision) => calls.push('reconcile'),
  });
  return { c, calls, fixture, upstream, scanClient, repository, service };
}

it.each([
  ['new-song', 'new-song'],
  ['old-song', 'old-song'],
] as const)(
  'joins one scan and rebinds exact target for %s identity',
  async (candidate, expected) => {
    const s = await setup(candidate);
    await s.service.process(claim);
    expect(s.calls).toEqual(['scanning', `bind:${expected}`, 'reconcile', `complete:${expected}`]);
    expect(
      s.upstream.requests.filter((request) => request.pathname.endsWith('startScan')),
    ).toHaveLength(1);
  },
);

it('reuses an already-visible exact path during gonic recovery without another full scan', async () => {
  const s = await setup();
  s.c.db.connection
    .prepare(
      "UPDATE registration_cycle SET owner='reflection-worker',expires_at=2000,next_scan_at=2000 WHERE singleton=1",
    )
    .run();
  await s.service.process({ ...claim, stage: 'recovery_required' });
  expect(s.calls).toEqual(['resume:scanning', 'bind:new-song', 'reconcile', 'complete:new-song']);
  expect(
    s.upstream.requests.filter((request) => request.pathname.endsWith('startScan')),
  ).toHaveLength(0);
});

it('keeps audio mismatch in gonic-owned recovery without rebinding', async () => {
  const s = await setup('new-song', '0'.repeat(64));
  await expect(s.service.process(claim)).rejects.toThrow('audio_mismatch');
  expect(s.calls).toEqual(['scanning', 'recovery_required']);
});

it.each(['zero', 'multiple'] as const)(
  'refuses %s exact-path candidates without rebinding',
  async (mode) => {
    const s = await setup();
    if (mode === 'zero') s.fixture.directories.album = [];
    else
      s.fixture.directories.album!.push({
        ...s.fixture.directories.album![0]!,
        id: 'other-song',
      });
    await expect(s.service.process(claim)).rejects.toThrow();
    expect(s.calls).toEqual(['scanning', 'recovery_required']);
  },
);

it('does not release a scan lease owned by another worker', async () => {
  const s = await setup();
  const context = await createTestContext();
  cleanups.push(context.cleanup);
  context.db.connection
    .prepare(
      "UPDATE registration_cycle SET owner='other-owner',expires_at=2000,next_scan_at=2000 WHERE singleton=1",
    )
    .run();
  const service = createOrganizationRegistration({
    database: context.db,
    clock: () => 1_000,
    timeoutMs: 100,
    pollMs: 10,
    retryMs: 100,
    wait: async () => {},
    scanClient: s.scanClient,
    libraries: [{ id: 'library', musicFolderId: '0', relativeRoot: 'jojo-music' }],
    repository: s.repository,
    inspect: async () => ({ snapshot, audioIdentity: claim.audioIdentity }),
    sourceAbsent: async () => true,
    fileIdentity: () => 'b'.repeat(64),
    revision: () => 'c'.repeat(64),
    reconcile: () => {},
  });
  await expect(service.process(claim)).rejects.toThrow('registration_pending');
  expect(context.db.connection.prepare('SELECT owner FROM registration_cycle').get()).toEqual({
    owner: 'other-owner',
  });
});
