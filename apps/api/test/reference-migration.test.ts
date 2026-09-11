import { expect, it } from 'vitest';
import {
  createReferenceMigration,
  migrateReferenceSequence,
  withoutReference,
} from '../src/metadata/reference-migration.js';
import type { OrganizationClaim } from '../src/storage/organization-repository.js';
import type { SubsonicClient } from '../src/subsonic/client.js';
import type { MetadataReferences } from '../src/metadata/reference-check.js';

const oldId = 'old';
const newId = 'new';
const baseline = {
  trackId: oldId,
  starred: true,
  playlists: [
    {
      id: 'playlist-a',
      name: 'Kept name',
      owner: 'owner',
      songIds: [oldId, 'B', oldId],
    },
    {
      id: 'playlist-b',
      name: 'Second',
      owner: 'owner',
      songIds: ['A', oldId],
    },
  ],
};
const claim: OrganizationClaim = {
  itemId: 'item',
  jobId: 'job',
  libraryId: 'library',
  workerId: 'worker',
  generation: 1,
  stage: 'rebound',
  sourceKey: 'source.mp3',
  targetKey: 'target.mp3',
  fileIdentity: 'a'.repeat(64),
  audioIdentity: 'b'.repeat(64),
  oldTrackId: oldId,
  newTrackId: newId,
  preimage: null,
};

it('preserves every duplicate occurrence and order in pure transformations', () => {
  expect(migrateReferenceSequence([oldId, 'B', oldId], oldId, newId)).toEqual([newId, 'B', newId]);
  expect(withoutReference([oldId, 'B', oldId], oldId)).toEqual(['B']);
});

function setup(
  currentA = ['B'],
  options: {
    throwAfterPlaylistWrite?: boolean;
    authorizeError?: string;
    playlistReadError?: string;
    baseline?: MetadataReferences;
  } = {},
) {
  const referenceBaseline = options.baseline ?? baseline;
  const playlists = new Map(
    referenceBaseline.playlists.map((entry) => [
      entry.id,
      {
        ...entry,
        songIds:
          entry.id === 'playlist-a'
            ? [...currentA]
            : migrateReferenceSequence(entry.songIds, oldId, newId),
      },
    ]),
  );
  let starred = false;
  const writes: string[] = [];
  const completed = new Set<string>(['playlist:playlist-b']);
  const transitions: string[] = [];
  const migration = createReferenceMigration({
    repository: {
      readBaseline: () => referenceBaseline,
      transition: (input) => transitions.push(input.stage),
      resumeRecovery: (input) => transitions.push(`resume:${input.stage}`),
      referenceCheckpoints: () =>
        [...completed].map((key) => {
          const [kind, referenceId] = key.split(':');
          return { kind: kind!, referenceId: referenceId!, status: 'completed', errorCode: null };
        }),
      putReferenceCheckpoint: (input) =>
        writes.push(`checkpoint:${input.kind}:${input.referenceId}`),
      completeReferenceCheckpoint: (input) => {
        completed.add(`${input.kind}:${input.referenceId}`);
        writes.push(`complete:${input.kind}:${input.referenceId}`);
      },
      failReferenceCheckpoint: (input) => writes.push(`failed:${input.kind}:${input.referenceId}`),
    },
    authorize: async () => {
      if (options.authorizeError) throw new Error(options.authorizeError);
      return {
        username: 'owner',
        client: {
          getPlaylist: async (id: string) => {
            if (options.playlistReadError) throw new Error(options.playlistReadError);
            const playlist = playlists.get(id)!;
            return {
              id,
              name: playlist.name,
              owner: playlist.owner,
              songCount: playlist.songIds.length,
              created: '2026-01-01T00:00:00Z',
              changed: '2026-01-01T00:00:00Z',
              duration: 0,
              public: false,
              entry: playlist.songIds.map((id) => ({ id, title: id, isDir: false })),
            };
          },
          createPlaylist: async (input: { playlistId?: string; songIds: string[] }) => {
            const playlist = playlists.get(input.playlistId!)!;
            playlist.songIds = [...input.songIds];
            writes.push(`playlist:${input.playlistId}`);
            if (options.throwAfterPlaylistWrite) throw new Error('timeout');
            return {};
          },
          getPlaylists: async () =>
            [...playlists.values()].map((playlist) => ({
              ...playlist,
              songCount: playlist.songIds.length,
              created: '2026-01-01T00:00:00Z',
              changed: '2026-01-01T00:00:00Z',
              duration: 0,
              public: false,
            })),
          getStarred2: async () => (starred ? [{ id: newId, title: 'new', isDir: false }] : []),
          starSong: async () => {
            starred = true;
            writes.push('star');
          },
        } as unknown as SubsonicClient,
      };
    },
  });
  return { playlists, writes, transitions, migration };
}

it('restores scan-removed occurrences, reconciles already desired work, and verifies star', async () => {
  const s = setup();
  await s.migration.process(claim);
  expect(s.playlists.get('playlist-a')!.songIds).toEqual([newId, 'B', newId]);
  expect(s.writes).toEqual([
    'checkpoint:playlist:playlist-a',
    'playlist:playlist-a',
    'complete:playlist:playlist-a',
    'checkpoint:star:star',
    'star',
    'complete:star:star',
  ]);
  expect(s.transitions).toEqual(['migrating_references', 'verifying', 'succeeded']);
});

it('refuses an unrelated concurrent playlist edit without writing it', async () => {
  const s = setup(['B', 'user-added']);
  await expect(s.migration.process(claim)).rejects.toThrow('reference_conflict');
  expect(s.writes).toEqual(['checkpoint:playlist:playlist-a', 'failed:playlist:playlist-a']);
  expect(s.transitions).toEqual(['migrating_references', 'recovery_required']);
});

it('reconciles an uncertain playlist write from exact readback', async () => {
  const s = setup(['B'], { throwAfterPlaylistWrite: true });
  await s.migration.process(claim);
  expect(s.playlists.get('playlist-a')!.songIds).toEqual([newId, 'B', newId]);
  expect(s.transitions).toEqual(['migrating_references', 'verifying', 'succeeded']);
});

it('records recovery without touching references when accepted authority is no longer valid', async () => {
  const s = setup(['B'], { authorizeError: 'permission_changed' });
  await expect(s.migration.process(claim)).rejects.toThrow('permission_changed');
  expect(s.writes).toEqual([]);
  expect(s.transitions).toEqual(['migrating_references', 'recovery_required']);
});

it('keeps a failed deleted or read-only playlist checkpoint auditable', async () => {
  const s = setup(['B'], { playlistReadError: 'playlist_unavailable' });
  await expect(s.migration.process(claim)).rejects.toThrow('playlist_unavailable');
  expect(s.writes).toEqual(['checkpoint:playlist:playlist-a']);
  expect(s.transitions).toEqual(['migrating_references', 'recovery_required']);
});

it('verifies an unstarred baseline with zero playlists without adding a star', async () => {
  const s = setup([], {
    baseline: { trackId: oldId, starred: false, playlists: [] },
  });
  await s.migration.process(claim);
  expect(s.writes).toEqual(['checkpoint:star:star', 'complete:star:star']);
  expect(s.transitions).toEqual(['migrating_references', 'verifying', 'succeeded']);
});
