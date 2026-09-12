import { chmodSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkpointId3ReferenceRestore,
  createId3ReferenceSnapshot,
  planId3PlaylistReferenceRestore,
  readId3ReferenceSnapshot,
} from '../../tools/id3-organize-reference-guard.js';

const root = () => mkdtempSync(join(tmpdir(), 'musiclatte-reference-guard-'));

describe('private multi-account ID3 reference guard', () => {
  it('persists an exact private snapshot without the PAT and checkpoints restore atomically', () => {
    const directory = root();
    const path = join(directory, 'references.json');
    const snapshot = createId3ReferenceSnapshot({
      path,
      api: 'https://music.example/api/v1',
      token: 'mlpat_' + 's'.repeat(48),
      trackId: 'old',
      starred: true,
      playlists: [
        {
          id: 'owned',
          name: 'Owned',
          owner: 'listener',
          revision: 'r'.repeat(43),
          songIds: ['old', 'B', 'old'],
        },
      ],
    });
    expect(snapshot).toMatchObject({ schemaVersion: 1, trackId: 'old', starred: true });
    expect(readFileSync(path, 'utf8')).not.toContain('mlpat_');
    expect(readId3ReferenceSnapshot(path)).toEqual(snapshot);
    checkpointId3ReferenceRestore(path, { kind: 'favorite', newTrackId: 'new' });
    checkpointId3ReferenceRestore(path, {
      kind: 'playlist',
      playlistId: 'owned',
      newTrackId: 'new',
    });
    expect(readId3ReferenceSnapshot(path)).toMatchObject({
      favoriteRestoredTo: 'new',
      playlists: [{ restoredTo: 'new' }],
    });

    chmodSync(path, 0o644);
    expect(() => readId3ReferenceSnapshot(path)).toThrow('client_failed:reference_private');
    chmodSync(path, 0o600);
    const link = join(directory, 'link.json');
    symlinkSync(path, link);
    expect(() => readId3ReferenceSnapshot(link)).toThrow('client_failed:reference_private');
    expect(() =>
      readId3ReferenceSnapshot(
        (() => {
          const invalid = join(directory, 'invalid.json');
          writeFileSync(invalid, JSON.stringify({ ...snapshot, token: 'secret' }), { mode: 0o600 });
          return invalid;
        })(),
      ),
    ).toThrow('client_failed:reference_invalid');
  });

  it('restores duplicate occurrences in exact order and rejects concurrent edits', () => {
    expect(planId3PlaylistReferenceRestore(['old', 'B', 'old'], ['B'], 'old', 'new')).toEqual({
      append: ['new', 'new'],
      order: [1, 0, 2],
    });
    expect(
      planId3PlaylistReferenceRestore(['old', 'B', 'old'], ['new', 'B', 'new'], 'old', 'new'),
    ).toEqual({ append: [], order: null });
    expect(() =>
      planId3PlaylistReferenceRestore(['old', 'B', 'old'], ['B', 'C'], 'old', 'new'),
    ).toThrow('client_failed:reference_conflict');
  });
});
