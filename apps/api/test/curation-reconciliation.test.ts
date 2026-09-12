import { expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  mkdirSync,
  realpathSync,
  readFileSync,
  writeFileSync,
  statSync,
  utimesSync,
  copyFileSync,
  renameSync,
} from 'node:fs';
import { createTestContext } from '../../../tests/support/session-storage-harness.js';
import { createMetadataFixture } from '../../../packages/test-support/src/metadata-fixtures.js';
import { createCurationRepository } from '../src/storage/curation-repository.js';
import { createMetadataHelper } from '../src/metadata/helper-client.js';
import { createMetadataFileAccess } from '../src/metadata/file-access.js';
import { createMediaFence } from '../src/metadata/media-fence.js';
import { curationSnapshot } from '../src/curation/reconciliation.js';
const cache = join(homedir(), '.cache/musiclatte-toolchain');
const python = process.env.METADATA_TEST_PYTHON ?? join(cache, 'metadata-python/bin/python');
const ffmpeg = process.env.METADATA_TEST_FFMPEG ?? join(cache, 'ffmpeg-9.0.1/ffmpeg');
const ffprobe = process.env.METADATA_TEST_FFPROBE ?? join(cache, 'ffmpeg-9.0.1/ffprobe');

/** Scalar and array metadata fields receive independent presence and fingerprint projections. */
it('should project every metadata field into curation state', () => {
  const projected = curationSnapshot({
    id3Version: 4,
    editable: true,
    reason: null,
    values: {
      title: ' Synthetic ',
      artist: [' Artist '],
      album: ' Album ',
      albumArtist: [' Album Artist '],
      trackNumber: '10/15',
      year: '2026',
      genre: [' Electronic ', ''],
    },
    coverFrames: [],
    lyricsFrames: [],
    fullDigest: 'full',
    audio: {
      codec: 'mp3',
      sampleRate: '44100',
      channels: 2,
      duration: '1',
      packetHash: 'packets',
      packetCount: 1,
    },
  });
  expect(projected.fields).toEqual({
    title: true,
    artist: true,
    album: true,
    albumArtist: true,
    trackNumber: true,
    year: true,
    genre: true,
    cover: false,
    lyrics: false,
  });
  expect(Object.keys(projected.fingerprints)).toEqual([
    'title',
    'artist',
    'album',
    'albumArtist',
    'trackNumber',
    'year',
    'genre',
    'cover',
    'lyrics',
  ]);
});

it('reconciles real MP3 bytes, preserves optional-only receipts and detects changes with unchanged size/mtime', async () => {
  const { createCurationReconciler } = await import('../src/curation/reconciliation.js');
  const c = await createTestContext();
  try {
    const root = realpathSync(c.root);
    const musicRoot = join(root, 'music');
    mkdirSync(musicRoot);
    const library = join(musicRoot, 'library');
    mkdirSync(library);
    const locks = join(root, 'locks');
    mkdirSync(locks, { mode: 0o700 });
    await createMetadataFixture({ root: library, python, ffmpeg, version: 4 });
    const file = join(library, 'source.mp3');
    const original = readFileSync(file);
    const accessOptions = { musicRoot, python, timeoutMs: 10000, maxFileBytes: 10 * 1024 * 1024 };
    const helper = createMetadataHelper({
      ...accessOptions,
      helperPath: resolve('apps/api/helpers/metadata.py'),
      ffmpeg,
      ffprobe,
    });
    const repo = createCurationRepository({
      database: c.db,
      clock: () => 1000,
      cursorKey: new Uint8Array(32),
      limits: {
        claimLeaseMs: 1000,
        maxTargets: 10,
        snapshotMaxAgeMs: 1000,
        snapshotMaxItems: 100,
        snapshotMaxCount: 10,
      },
    });
    const id = repo.discover({ libraryId: 'lib', trackId: 'song', format: 'unsupported' });
    let currentPath = 'library/source.mp3';
    const reconciler = createCurationReconciler({
      database: c.db,
      repository: repo,
      clock: () => 1000,
      signingKey: new Uint8Array(32),
      libraries: [{ id: 'lib', relativeRoot: 'library' }],
      source: {
        recentSong: async (trackId: string) => ({
          song: { id: trackId, isDir: false, title: 'Synthetic' },
          path: currentPath,
        }),
      },
      helper,
      fileAccess: createMetadataFileAccess({
        ...accessOptions,
        helperPath: resolve('apps/api/helpers/file_access.py'),
      }),
      fence: createMediaFence({
        root: locks,
        python,
        helperPath: resolve('apps/api/helpers/media_fence.py'),
        timeoutMs: 20000,
      }),
    });
    await reconciler.reconcile(id);
    expect(repo.get(id)).toMatchObject({
      format: 'mp3',
      curationStatus: 'unreviewed',
      validation: 'verified',
    });
    const receipt = repo.complete(
      id,
      { username: 'fixture', credentialKind: 'session', tokenId: null, clientLabel: null },
      null,
    );
    copyFileSync(file, join(library, 'edit.metadata-pending'));
    let snapshot = await helper.read({ key: 'library/source.mp3' });
    await helper.prepare({
      candidateKey: 'library/edit.metadata-pending',
      expectedDigest: snapshot.fullDigest,
      patch: { album: { op: 'set', value: 'Optional synthetic album' } },
    });
    renameSync(join(library, 'edit.metadata-pending'), file);
    await reconciler.reconcile(id);
    expect(repo.get(id)).toMatchObject({
      curationStatus: 'completed',
      receipt: { id: receipt.id, verifiedRevision: receipt.verifiedRevision },
    });
    snapshot = await helper.read({ key: 'library/source.mp3' });
    const before = statSync(file);
    copyFileSync(file, join(library, 'edit.metadata-pending'));
    await helper.prepare({
      candidateKey: 'library/edit.metadata-pending',
      expectedDigest: snapshot.fullDigest,
      patch: { title: { op: 'set', value: 'Synthetic changed title' } },
    });
    renameSync(join(library, 'edit.metadata-pending'), file);
    utimesSync(file, before.atime, before.mtime);
    expect(statSync(file).size).toBe(before.size);
    await reconciler.reconcile(id);
    expect(repo.get(id)?.curationStatus).toBe('needs_review');
    writeFileSync(file, original);
    await reconciler.reconcile(id);
    expect(repo.get(id)?.curationStatus).toBe('needs_review');
    const replacement = join(root, 'replacement');
    mkdirSync(replacement);
    await createMetadataFixture({
      root: replacement,
      python,
      ffmpeg,
      version: 4,
      durationSeconds: 0.5,
    });
    repo.complete(
      id,
      { username: 'fixture', credentialKind: 'session', tokenId: null, clientLabel: null },
      null,
    );
    copyFileSync(join(replacement, 'source.mp3'), file);
    await reconciler.reconcile(id);
    expect(repo.get(id)?.curationStatus).toBe('needs_review');
    const newId = repo.discover({
      libraryId: 'lib',
      trackId: 'new-song-id',
      format: 'unsupported',
    });
    c.db.connection.exec(
      "INSERT INTO curation_inventory_runs(library_id,generation,status,last_discovery_at,checkpoint_json) VALUES('lib','generation','discovering',1000,'{}')",
    );
    c.db.connection.exec(
      "INSERT INTO curation_inventory_queue(library_id,generation,opaque_id,kind,status) VALUES('lib','generation','new-song-id','track','pending')",
    );
    await reconciler.reconcile(newId);
    expect(repo.get(newId)?.curationStatus).toBe('unreviewed');
    expect(repo.rowFor(id)?.tombstoned).toBe(1);
    expect(repo.get(id)?.receipt).not.toBeNull();
    currentPath = 'library/unsupported.flac';
    const unsupported = repo.discover({
      libraryId: 'lib',
      trackId: 'unsupported',
      format: 'unsupported',
    });
    await expect(reconciler.reconcile(unsupported)).rejects.toThrow('unsupported_format');
    expect(repo.get(unsupported)).toMatchObject({
      format: 'unsupported',
      validation: 'unknown',
      lyricsState: 'unknown',
    });
  } finally {
    c.cleanup();
  }
});
