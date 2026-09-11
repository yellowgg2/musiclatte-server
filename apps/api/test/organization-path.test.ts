import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  planOrganizationPath,
  resolveOrganizationAccountScope,
} from '../src/metadata/organization-path.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(sourceKey = 'jojo-music/account/Legacy/source.mp3') {
  const createdRoot = mkdtempSync(join(tmpdir(), 'musiclatte-organization-'));
  roots.push(createdRoot);
  const musicRoot = realpathSync(createdRoot);
  const source = join(musicRoot, ...sourceKey.split('/'));
  mkdirSync(join(source, '..'), { recursive: true });
  writeFileSync(source, 'fixture');
  return {
    musicRoot,
    sourceKey,
    libraryId: 'library',
    ownerUsername: 'listener',
    allowedLibraryIds: ['library'],
    relativeRoot: 'jojo-music',
    accounts: [{ username: 'listener', accountDirectory: 'account' }],
    values: {
      title: '노래: 東京 / Song',
      artist: ['Artist'],
      album: '앨범',
      albumArtist: ['アルバム作家'],
      trackNumber: '10/15',
    },
  } as const;
}

describe('id3-managed-v1 organization path planning', () => {
  it('derives an account-scoped normalized key without mutating directories', () => {
    const input = fixture();
    const result = planOrganizationPath(input);
    expect(result).toEqual({
      status: 'ready',
      policyVersion: 'id3-managed-v1',
      sourceKind: 'legacy',
      currentKey: input.sourceKey,
      targetKey: 'jojo-music/account/ID3-managed/アルバム作家/앨범/10 - 노래 - 東京 - Song.mp3',
    });
    expect(() =>
      mkdirSync(join(input.musicRoot, 'jojo-music/account/ID3-managed'), { recursive: false }),
    ).not.toThrow();
  });

  /** A configured operator keeps another configured source account as the destination owner. */
  it('should organize a shared-library song inside its source account directory', () => {
    const input = fixture('jojo-music/admin/Legacy/source.mp3');
    const result = planOrganizationPath({
      ...input,
      ownerUsername: 'listener',
      accounts: [
        { username: 'listener', accountDirectory: 'yellowgg2' },
        { username: 'admin', accountDirectory: 'admin' },
      ],
    });

    expect(result).toMatchObject({
      status: 'ready',
      currentKey: input.sourceKey,
      targetKey: 'jojo-music/admin/ID3-managed/アルバム作家/앨범/10 - 노래 - 東京 - Song.mp3',
    });
  });

  /** The shared admission and worker guard rejects any cross-account destination. */
  it('should reject rehoming a configured source account into another account', () => {
    const accounts = [
      { username: 'listener', accountDirectory: 'yellowgg2' },
      { username: 'admin', accountDirectory: 'admin' },
    ];
    expect(
      resolveOrganizationAccountScope({
        relativeRoot: 'jojo-music',
        ownerUsername: 'listener',
        sourceKey: 'jojo-music/admin/Legacy/source.mp3',
        targetKey: 'jojo-music/admin/ID3-managed/Artist/Album/Title.mp3',
        accounts,
      }),
    ).toEqual({ status: 'ready', accountRoot: 'jojo-music/admin' });
    expect(
      resolveOrganizationAccountScope({
        relativeRoot: 'jojo-music',
        ownerUsername: 'listener',
        sourceKey: 'jojo-music/admin/Legacy/source.mp3',
        targetKey: 'jojo-music/yellowgg2/ID3-managed/Artist/Album/Title.mp3',
        accounts,
      }),
    ).toEqual({ status: 'error', code: 'source_outside_account' });
  });

  it('falls back to artist and omits a missing track prefix', () => {
    const input = fixture();
    expect(
      planOrganizationPath({
        ...input,
        values: { ...input.values, albumArtist: [], trackNumber: null },
      }),
    ).toMatchObject({
      status: 'ready',
      targetKey: 'jojo-music/account/ID3-managed/Artist/앨범/노래 - 東京 - Song.mp3',
    });
  });

  it.each([
    ['title', { title: '' }],
    ['album', { album: null }],
    ['artistFolder', { albumArtist: [], artist: [] }],
  ])('keeps the current path when %s metadata is incomplete', (_field, patch) => {
    const input = fixture();
    expect(planOrganizationPath({ ...input, values: { ...input.values, ...patch } })).toMatchObject(
      { status: 'error', code: 'metadata_incomplete', currentKey: input.sourceKey },
    );
  });

  it('rejects unmapped owners, library mismatch, and sources outside the mapped account', () => {
    const input = fixture();
    expect(planOrganizationPath({ ...input, accounts: [] })).toMatchObject({
      status: 'error',
      code: 'account_unmapped',
    });
    expect(planOrganizationPath({ ...input, allowedLibraryIds: ['other'] })).toMatchObject({
      status: 'error',
      code: 'library_denied',
    });
    expect(
      planOrganizationPath({ ...input, sourceKey: 'jojo-music/other/Legacy/source.mp3' }),
    ).toMatchObject({ status: 'error', code: 'source_outside_account' });
  });

  it('distinguishes an already managed no-op from destination collision', () => {
    const targetKey = 'jojo-music/account/ID3-managed/Artist/Album/03 - Title.mp3';
    const noOp = fixture(targetKey);
    expect(
      planOrganizationPath({
        ...noOp,
        values: {
          title: 'Title',
          artist: ['Artist'],
          album: 'Album',
          albumArtist: [],
          trackNumber: '3',
        },
      }),
    ).toMatchObject({ status: 'no_op', sourceKind: 'managed', targetKey });

    const collision = fixture();
    mkdirSync(join(collision.musicRoot, 'jojo-music/account/ID3-managed/Artist/Album'), {
      recursive: true,
    });
    writeFileSync(
      join(collision.musicRoot, 'jojo-music/account/ID3-managed/Artist/Album/03 - Title.mp3'),
      'other',
    );
    expect(
      planOrganizationPath({
        ...collision,
        values: {
          title: 'Title',
          artist: ['Artist'],
          album: 'Album',
          albumArtist: [],
          trackNumber: '3/9',
        },
      }),
    ).toMatchObject({ status: 'error', code: 'destination_conflict' });
  });

  it('detects NFC-equivalent collisions and symlink parents without mutation', () => {
    const input = fixture();
    mkdirSync(join(input.musicRoot, 'jojo-music/account/ID3-managed'), { recursive: true });
    mkdirSync(join(input.musicRoot, 'jojo-music/account/ID3-managed/Cafe\u0301'));
    expect(
      planOrganizationPath({
        ...input,
        values: { ...input.values, albumArtist: ['Café'], album: 'Album', title: 'Title' },
      }),
    ).toMatchObject({ status: 'error', code: 'destination_conflict' });

    const symlinkInput = fixture();
    mkdirSync(join(symlinkInput.musicRoot, 'outside'));
    mkdirSync(join(symlinkInput.musicRoot, 'jojo-music/account/ID3-managed'), { recursive: true });
    symlinkSync(
      join(symlinkInput.musicRoot, 'outside'),
      join(symlinkInput.musicRoot, 'jojo-music/account/ID3-managed/Artist'),
    );
    expect(
      planOrganizationPath({
        ...symlinkInput,
        values: { ...symlinkInput.values, albumArtist: [], album: 'Album', title: 'Title' },
      }),
    ).toMatchObject({ status: 'error', code: 'unsafe_target' });
  });

  it('rejects excessive metadata instead of accepting an unbounded request', () => {
    const input = fixture();
    expect(
      planOrganizationPath({ ...input, values: { ...input.values, title: '가'.repeat(2_000) } }),
    ).toMatchObject({ status: 'error', code: 'excessive_length' });
  });
});
