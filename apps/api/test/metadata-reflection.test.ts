import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
async function moduleUnderTest() {
  const path = resolve('apps/api/src/metadata/reflection.ts');
  expect(existsSync(path)).toBe(true);
  return import(path);
}
const snapshot = {
  id3Version: 4,
  editable: true,
  reason: null,
  fullDigest: 'a'.repeat(64),
  values: {
    title: 'Synthetic title',
    artist: ['Synthetic artist'],
    album: 'Synthetic album',
    albumArtist: ['Synthetic album artist'],
    trackNumber: '2/12',
    year: '2028-02-29',
    genre: ['Synthetic'],
  },
  coverFrames: [
    {
      pictureType: 3,
      description: 'front',
      digest: 'b'.repeat(64),
      frameId: 'c'.repeat(64),
      mimeType: 'image/png',
    },
  ],
  audio: {
    codec: 'mp3' as const,
    sampleRate: '44100',
    channels: 1,
    duration: '1',
    packetHash: 'd'.repeat(64),
    packetCount: 2,
  },
  lyricsFrames: [],
};
const song = {
  id: 'song-a',
  isDir: false,
  title: 'Synthetic title',
  artist: 'Synthetic artist',
  album: 'Synthetic album',
  track: 2,
  year: 2028,
  genre: 'Synthetic',
  coverArt: 'cover-a',
};
describe('metadata reflection', () => {
  it('should distinguish file verification from standard index projection and stale covers', async () => {
    const { compareMetadataProjection } = await moduleUnderTest();
    const result = compareMetadataProjection(snapshot, song, {
      filename: 'source.mp3',
      coverMatches: true,
    });
    expect(result.status).toBe('verified');
    expect(result.unsupportedProjection).toEqual(['albumArtist', 'lyrics']);
    expect(result.indexVerifiedFields).toContain('genre');
    expect(
      compareMetadataProjection(
        snapshot,
        { ...song, album: 'Different folder album' },
        { filename: 'source.mp3', coverMatches: true },
      ).status,
    ).toBe('reflection_mismatch');
    expect(
      compareMetadataProjection(snapshot, song, { filename: 'source.mp3', coverMatches: false })
        .status,
    ).toBe('reflection_mismatch');
  });
  it('should refuse missing standard projection evidence and handle explicit empty tags using the profile', async () => {
    const { compareMetadataProjection } = await moduleUnderTest();
    expect(
      compareMetadataProjection(
        snapshot,
        { ...song, genre: undefined },
        { filename: 'source.mp3', coverMatches: true },
      ).status,
    ).toBe('reflection_mismatch');
    const cleared = {
      ...snapshot,
      values: {
        ...snapshot.values,
        title: null,
        artist: [],
        album: null,
        trackNumber: null,
        year: null,
        genre: [],
      },
      coverFrames: [],
    };
    const fallback = {
      id: 'song-a',
      isDir: false,
      title: 'source.mp3',
      artist: 'Synthetic album artist',
    };
    expect(
      compareMetadataProjection(cleared, fallback, { filename: 'source.mp3', coverMatches: true })
        .status,
    ).toBe('verified');
  });
  it('should compare exact ordered occurrences and star state without rewriting references', async () => {
    await moduleUnderTest();
    const { compareMetadataReferences } = await import('../src/metadata/reference-check.js');
    const before = {
      trackId: 'song-a',
      starred: true,
      playlists: [{ id: 'list', songIds: ['song-a', 'song-b', 'song-a'] }],
    };
    expect(compareMetadataReferences(before, structuredClone(before))).toBe(true);
    expect(compareMetadataReferences(before, { ...before, trackId: 'replacement-id' })).toBe(false);
    expect(compareMetadataReferences(before, { ...before, starred: false })).toBe(false);
    expect(
      compareMetadataReferences(before, {
        ...before,
        playlists: [{ id: 'list', songIds: ['song-a', 'song-a', 'song-b'] }],
      }),
    ).toBe(false);
  });
});

import { createTestContext, proof } from '../../../tests/support/session-storage-harness.js';
import { createMetadataRepository } from '../src/storage/metadata-repository.js';
import { createSubsonicClient } from '../src/subsonic/client.js';
import { createScanCoordinator } from '../src/subsonic/scan-coordinator.js';
import type { MetadataTagSnapshot } from '../src/metadata/helper-client.js';
import type { SubsonicClient } from '../src/subsonic/client.js';
const reflectionScenarios = [
  'verified',
  'mixed',
  'id-change',
  'stale-cover',
  'file-change',
  'lost-scan-lease',
  'refreshed-cover',
  'cache-failure',
  'lease-during-snapshot',
];
/** Refresh is fenced by file revision and scan ownership; failed refresh cannot succeed. */
it.each(reflectionScenarios)(
  'should persist honest reflection state and fence a real ledger for %s',
  async (scenario) => {
    const c = await createTestContext();
    try {
      const { createMetadataReflector } = await import('../src/metadata/reflection.js');
      c.sessions.create(proof);
      const actorSessionId = String(
        c.db.connection.prepare('SELECT id_hash FROM sessions').get()!.id_hash,
      );
      c.mediaLinks.create({
        id: 'media',
        libraryId: 'library',
        relativeFileKey: 'channel/source.mp3',
        gonicSongId: 'song-a',
      });
      let now = 1000;
      const repo = createMetadataRepository({ database: c.db, clock: () => now });
      repo.createOrReplay({
        id: 'job',
        identityKey: '1'.repeat(64),
        libraryId: 'library',
        operationIdHash: '2'.repeat(64),
        requestHash: '3'.repeat(64),
        items: [
          {
            id: 'item',
            mediaLinkId: 'media',
            fileIdentity: '4'.repeat(64),
            bindingRevision: 1,
            trackId: 'song-a',
            expectedRevision: 'before',
            expectedDigest: '5'.repeat(64),
            actorSessionId,
            policyRevision: 1,
            patch: { title: { op: 'set', value: 'Synthetic title' } },
          },
        ],
      });
      const claim = repo.claimNext({ workerId: 'metadata', leaseDurationMs: 10000 })!;
      repo.recordReferences(claim, { trackId: 'song-a', starred: false, playlists: [] });
      repo.recordBackup({
        ...claim,
        backup: {
          id: 'backup',
          relativeKey: 'backup.bin',
          preimageDigest: '5'.repeat(64),
          size: 10,
          mode: 0o600,
          ownerProfile: { uid: 1000, gid: 1000 },
        },
      });
      repo.transition({ ...claim, stage: 'backed_up' });
      repo.transition({ ...claim, stage: 'prepared' });
      repo.transition({
        ...claim,
        stage: 'file_saved',
        resultDigest: 'a'.repeat(64),
        resultRevision: 'after',
      });
      const other = createScanCoordinator({
        database: c.db,
        clock: () => now,
        timeoutMs: 100,
        retryMs: 10,
      });
      let starts = 0;
      let observedDigest = snapshot.fullDigest;
      const client = {
        ...createSubsonicClient({
          upstream: 'http://127.0.0.1:1',
          proof: { ...proof, t: '0123456789abcdef0123456789abcdef' },
          timeoutMs: 100,
        }),
        getScanStatus: async () => ({ scanning: false, count: 2 }),
        startScan: async () => {
          starts++;
          expect(other.acquire('import-other')).toBe(false);
          if (scenario === 'lost-scan-lease')
            c.db.connection.prepare("UPDATE registration_cycle SET owner='new-owner'").run();
        },
        indexes: async () => ({
          index: [{ name: 'C', artist: [{ id: 'directory', name: 'channel', album: [] }] }],
        }),
        registrationDirectory: async () => ({
          id: 'directory',
          name: 'channel',
          child: [
            {
              id: scenario === 'id-change' ? 'replacement' : 'song-a',
              isDir: false,
              path: 'channel/source.mp3',
              name: 'source.mp3',
            },
          ],
        }),
        getSong: async () => ({
          ...song,
          ...(scenario === 'mixed' ? { album: 'Another album' } : {}),
        }),
        getPlaylists: async () => [],
        getStarred2: async () => [],
      } as SubsonicClient;
      let coverRefreshed = false;
      let reads = 0;
      const reflector = createMetadataReflector({
        database: c.db,
        repository: repo,
        scanClient: client,
        libraries: [{ id: 'library', relativeRoot: 'channel', musicFolderId: '0' }],
        accountClient: async () => client,
        fileSnapshot: async () => {
          if (++reads === 2 && scenario === 'lease-during-snapshot')
            c.db.connection.prepare("UPDATE registration_cycle SET owner='new-owner'").run();
          return {
            ...snapshot,
            fullDigest: scenario === 'file-change' ? 'f'.repeat(64) : observedDigest,
          } as MetadataTagSnapshot;
        },
        refreshCoverCache: async () => {
          if (scenario === 'cache-failure') throw new Error('cache unavailable');
          coverRefreshed = true;
        },
        coverMatches: async () =>
          scenario === 'refreshed-cover' ? coverRefreshed : scenario !== 'stale-cover',
        clock: () => now,
        timeoutMs: 100,
        pollMs: 10,
        retryMs: 10,
        wait: async (ms) => {
          now += ms;
        },
      });
      await reflector.reflect(claim, repo.readWork(claim));
      const item = repo.getJob('job', '1'.repeat(64))!.items[0]!;
      expect(item.stage).toBe(
        scenario === 'verified' || scenario === 'refreshed-cover'
          ? 'succeeded'
          : scenario === 'file-change'
            ? 'recovery_required'
            : 'reflecting',
      );
      if (scenario === 'cache-failure') expect(item.errorCode).toBe('reflection_unavailable');
      if (
        ['file-change', 'id-change', 'lost-scan-lease', 'lease-during-snapshot'].includes(scenario)
      )
        expect(coverRefreshed).toBe(false);
      if (scenario === 'mixed' || scenario === 'stale-cover')
        expect(item.errorCode).toBe('reflection_mismatch');
      if (scenario === 'id-change') expect(item.errorCode).toBe('reference_conflict');
      expect(c.mediaLinks.get('media')!.gonicSongId).toBe('song-a');
      expect(c.db.connection.prepare('SELECT count(*) AS n FROM download_events').get()!.n).toBe(0);
      if (scenario === 'lost-scan-lease')
        expect(c.db.connection.prepare('SELECT owner FROM registration_cycle').get()!.owner).toBe(
          'new-owner',
        );
      expect(starts).toBe(scenario === 'file-change' ? 0 : 1);
      if (scenario === 'mixed') {
        expect(
          repo.claimNext({
            workerId: 'early-reflector',
            leaseDurationMs: 10000,
            reflectionOnly: true,
          }),
        ).toBeNull();
        repo.createRestore({
          parentJobId: 'job',
          itemId: 'item',
          request: {
            id: 'restore-job',
            identityKey: '1'.repeat(64),
            libraryId: 'library',
            operationIdHash: '6'.repeat(64),
            requestHash: '7'.repeat(64),
            items: [
              {
                id: 'restore-item',
                mediaLinkId: 'media',
                fileIdentity: '4'.repeat(64),
                bindingRevision: 1,
                trackId: 'song-a',
                expectedRevision: 'after',
                expectedDigest: 'a'.repeat(64),
                actorSessionId,
                policyRevision: 1,
                patch: {},
              },
            ],
          },
        });
        const restoredClaim = repo.claimNext({
          workerId: 'restore-worker',
          leaseDurationMs: 10000,
        })!;
        expect(restoredClaim.itemId).toBe('restore-item');
        expect(() => reflector.retryReflection('item', 'f'.repeat(64))).toThrow('conflict');
        repo.recordBackup({
          ...restoredClaim,
          backup: {
            id: 'restore-backup',
            relativeKey: 'restore.bin',
            preimageDigest: 'a'.repeat(64),
            size: 10,
            mode: 0o600,
            ownerProfile: { uid: 1000, gid: 1000 },
          },
        });
        repo.transition({ ...restoredClaim, stage: 'backed_up' });
        repo.transition({ ...restoredClaim, stage: 'prepared' });
        repo.transition({
          ...restoredClaim,
          stage: 'file_saved',
          resultDigest: '5'.repeat(64),
          resultRevision: 'restored',
        });
        repo.transition({ ...restoredClaim, stage: 'reflecting' });
        repo.transition({ ...restoredClaim, stage: 'succeeded' });
        reflector.retryReflection('item', '1'.repeat(64));
        const old = repo.claimNext({
          workerId: 'old-reflector',
          leaseDurationMs: 10000,
          reflectionOnly: true,
        })!;
        observedDigest = '5'.repeat(64);
        now += 11;
        await reflector.reflect(old, repo.readWork(old));
        expect(repo.getJob('job', '1'.repeat(64))!.items[0]!.stage).toBe('conflict');
      }
      expect(c.db.connection.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      c.cleanup();
    }
  },
);

/** Shared scan cooldown must not repeatedly reschedule later saved files behind an older mismatch. */
it('should leave queued reflection work untouched until the shared scan slot is available', async () => {
  const { vi } = await import('vitest');
  const { createMetadataReflector } = await import('../src/metadata/reflection');
  const c = await createTestContext();
  try {
    let now = 1000;
    const coordinator = createScanCoordinator({
      database: c.db,
      clock: () => now,
      timeoutMs: 100,
      retryMs: 30,
    });
    expect(coordinator.acquire('earlier-mismatch')).toBe(true);
    coordinator.release('earlier-mismatch', true);
    const claimNext = vi.fn(() => null);
    const reflector = createMetadataReflector({
      database: c.db,
      repository: { claimNext } as never,
      clock: () => now,
      timeoutMs: 100,
      pollMs: 10,
      retryMs: 30,
      scanClient: {} as never,
      libraries: [],
      accountClient: async () => ({}) as never,
      fileSnapshot: async () => snapshot as MetadataTagSnapshot,
      coverMatches: async () => true,
    });
    expect(await reflector.runOnce()).toBe(false);
    expect(claimNext).not.toHaveBeenCalled();
    now += 30;
    await reflector.runOnce();
    expect(claimNext).toHaveBeenCalledOnce();
  } finally {
    await c.cleanup();
  }
});
