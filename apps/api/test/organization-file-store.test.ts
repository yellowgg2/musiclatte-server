import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createMediaFence } from '../src/metadata/media-fence.js';
import { createOrganizationFileStore } from '../src/metadata/organization-file-store.js';

const roots: string[] = [];
const python = join(homedir(), '.cache/musiclatte-toolchain/metadata-python/bin/python');
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup(
  assertAvailable?: (
    fileIdentity: string,
    options?: { allowOrganizationAlbumProjection: boolean },
  ) => void,
) {
  const created = mkdtempSync(join(tmpdir(), 'musiclatte-move-'));
  roots.push(created);
  const root = realpathSync(created);
  const musicRoot = join(root, 'music');
  const lockRoot = join(root, 'locks');
  mkdirSync(musicRoot, { mode: 0o700 });
  mkdirSync(lockRoot, { mode: 0o700 });
  const sourceKey = 'jojo-music/account/Legacy/source.mp3';
  const targetKey = 'jojo-music/account/ID3-managed/Artist/Album/01 - Title.mp3';
  mkdirSync(join(musicRoot, 'jojo-music/account/Legacy'), { recursive: true, mode: 0o750 });
  writeFileSync(join(musicRoot, sourceKey), 'synthetic audio bytes', { mode: 0o640 });
  const digest = (key: string) =>
    createHash('sha256')
      .update(readFileSync(join(musicRoot, key)))
      .digest('hex');
  const fence = createMediaFence({
    root: lockRoot,
    python,
    helperPath: resolve('apps/api/helpers/media_fence.py'),
    timeoutMs: 5_000,
  });
  const store = createOrganizationFileStore({
    musicRoot,
    python,
    helperPath: resolve('apps/api/helpers/organization_move.py'),
    accessHelperPath: resolve('apps/api/helpers/file_access.py'),
    timeoutMs: 5_000,
    maxFileBytes: 1_024,
    fence,
    fileIdentity: (_libraryId, key) => createHash('sha256').update(key).digest('hex'),
    inspectAudio: async (key) => digest(key),
    ...(assertAvailable ? { assertAvailable } : {}),
  });
  return { musicRoot, sourceKey, targetKey, digest, store };
}

it('atomically moves one regular file while preserving identity, mode, owner, and bytes', async () => {
  const s = setup();
  const before = lstatSync(join(s.musicRoot, s.sourceKey));
  const prepared = await s.store.prepare({
    libraryId: 'library',
    sourceKey: s.sourceKey,
    targetKey: s.targetKey,
  });
  const result = await s.store.move(prepared);
  const after = lstatSync(join(s.musicRoot, s.targetKey));
  expect(existsSync(join(s.musicRoot, s.sourceKey))).toBe(false);
  expect(result.digest).toBe(s.digest(s.targetKey));
  expect([after.dev, after.ino, after.mode & 0o777, after.uid, after.gid]).toEqual([
    before.dev,
    before.ino,
    before.mode & 0o777,
    before.uid,
    before.gid,
  ]);
});

it('rejects collisions and symlink parents before losing the source', async () => {
  const collision = setup();
  mkdirSync(join(collision.musicRoot, 'jojo-music/account/ID3-managed/Artist/Album'), {
    recursive: true,
  });
  writeFileSync(join(collision.musicRoot, collision.targetKey), 'other');
  await expect(
    collision.store.prepare({
      libraryId: 'library',
      sourceKey: collision.sourceKey,
      targetKey: collision.targetKey,
    }),
  ).rejects.toThrow('destination_conflict');
  expect(existsSync(join(collision.musicRoot, collision.sourceKey))).toBe(true);

  const linked = setup();
  mkdirSync(join(linked.musicRoot, 'outside'));
  mkdirSync(join(linked.musicRoot, 'jojo-music/account/ID3-managed'), { recursive: true });
  symlinkSync(
    join(linked.musicRoot, 'outside'),
    join(linked.musicRoot, 'jojo-music/account/ID3-managed/Artist'),
  );
  await expect(
    linked.store.prepare({
      libraryId: 'library',
      sourceKey: linked.sourceKey,
      targetKey: linked.targetKey,
    }),
  ).rejects.toThrow('unsafe_target');
  expect(existsSync(join(linked.musicRoot, linked.sourceKey))).toBe(true);

  const equivalent = setup();
  mkdirSync(join(equivalent.musicRoot, 'jojo-music/account/ID3-managed/Artist/Album'), {
    recursive: true,
  });
  writeFileSync(
    join(equivalent.musicRoot, 'jojo-music/account/ID3-managed/Artist/Album/01 - title.MP3'),
    'other',
  );
  await expect(
    equivalent.store.prepare({
      libraryId: 'library',
      sourceKey: equivalent.sourceKey,
      targetKey: equivalent.targetKey,
    }),
  ).rejects.toThrow('destination_conflict');
});

it('rejects an active publication and a replaced target parent before rename', async () => {
  const busy = setup(() => {
    throw new Error('file_busy');
  });
  const busyPrepared = await busy.store.prepare({
    libraryId: 'library',
    sourceKey: busy.sourceKey,
    targetKey: busy.targetKey,
  });
  await expect(busy.store.move(busyPrepared)).rejects.toThrow('file_busy');
  expect(existsSync(join(busy.musicRoot, busy.sourceKey))).toBe(true);

  const replaced = setup();
  const prepared = await replaced.store.prepare({
    libraryId: 'library',
    sourceKey: replaced.sourceKey,
    targetKey: replaced.targetKey,
  });
  const parent = join(replaced.musicRoot, 'jojo-music/account/ID3-managed/Artist/Album');
  renameSync(parent, `${parent}-old`);
  mkdirSync(parent, { mode: 0o750 });
  await expect(replaced.store.move(prepared)).rejects.toThrow('unsafe_target');
  expect(existsSync(join(replaced.musicRoot, replaced.sourceKey))).toBe(true);
});

it('allows a file-verified album projection through the organization rename boundary', async () => {
  const checks: { allowOrganizationAlbumProjection: boolean }[] = [];
  const s = setup((_fileIdentity, options) => {
    if (options) checks.push(options);
  });
  const prepared = await s.store.prepare({
    libraryId: 'library',
    sourceKey: s.sourceKey,
    targetKey: s.targetKey,
  });
  await s.store.move(prepared);
  expect(checks).toEqual([
    { allowOrganizationAlbumProjection: true },
    { allowOrganizationAlbumProjection: true },
  ]);
});

it.each([
  ['before_rename', 'source_only'],
  ['after_rename', 'target_only'],
  ['after_fsync', 'target_only'],
] as const)('classifies an injected %s crash as %s', async (crashAt, expected) => {
  const s = setup();
  const prepared = await s.store.prepare({
    libraryId: 'library',
    sourceKey: s.sourceKey,
    targetKey: s.targetKey,
  });
  await expect(s.store.move(prepared, { crashAt })).rejects.toThrow('worker_interrupted');
  await expect(s.store.classify(prepared)).resolves.toBe(expected);
});

it('classifies both, neither, and identity mismatch as ambiguous', async () => {
  const s = setup();
  const prepared = await s.store.prepare({
    libraryId: 'library',
    sourceKey: s.sourceKey,
    targetKey: s.targetKey,
  });
  mkdirSync(join(s.musicRoot, 'jojo-music/account/ID3-managed/Artist/Album'), { recursive: true });
  writeFileSync(join(s.musicRoot, s.targetKey), 'other');
  await expect(s.store.classify(prepared)).resolves.toBe('ambiguous');
  rmSync(join(s.musicRoot, s.sourceKey));
  rmSync(join(s.musicRoot, s.targetKey));
  await expect(s.store.classify(prepared)).resolves.toBe('ambiguous');
});

it('rejects a parent made writable through unsafe permissions only after preserving the source', async () => {
  const s = setup();
  chmodSync(s.musicRoot, 0o777);
  await expect(
    s.store.prepare({ libraryId: 'library', sourceKey: s.sourceKey, targetKey: s.targetKey }),
  ).rejects.toThrow();
  expect(existsSync(join(s.musicRoot, s.sourceKey))).toBe(true);
});
