import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext } from '../../../tests/support/session-storage-harness.js';
import { createOrganizationCandidates } from '../src/metadata/organization-candidates.js';

let context: Awaited<ReturnType<typeof createTestContext>> | undefined;
afterEach(() => context?.cleanup());

describe('organization candidate lookup', () => {
  it('bounds results to allowed libraries and exposes only current identifiers and provenance', async () => {
    const c = (context = await createTestContext());
    c.mediaLinks.create({
      id: 'media',
      libraryId: 'library',
      relativeFileKey: 'root/account/song.mp3',
      gonicSongId: 'song',
    });
    c.db.connection
      .prepare(
        "INSERT INTO import_jobs(id,identity_key,library_id,operation_id_hash,request_hash,created_at) VALUES('import',?,'library',?,?,1)",
      )
      .run('a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64));
    c.db.connection
      .prepare(
        "INSERT INTO import_items(id,job_id,item_order,source_id,stage,media_link_id,stage_changed_at,ready_at) VALUES('item','import',0,'source','ready','media',1,1)",
      )
      .run();
    const searched: string[] = [];
    const candidates = createOrganizationCandidates({
      database: c.db.connection,
      libraries: [
        { id: 'library', musicFolderId: '1' },
        { id: 'outside', musicFolderId: '2' },
      ],
      search: async (_title, folder) => {
        searched.push(folder);
        return [{ id: 'song', title: 'Match', artist: 'Artist', album: 'Album', isDir: false }];
      },
      resolve: async () => ({ libraryId: 'library', fileRevision: 'revision' }),
    });
    await expect(
      candidates.list({ title: 'Match', limit: 1, allowedLibraryIds: ['library'] }),
    ).resolves.toEqual({
      schemaVersion: 1,
      total: 1,
      candidates: [
        {
          trackId: 'song',
          libraryId: 'library',
          title: 'Match',
          artist: ['Artist'],
          album: 'Album',
          currentRevision: 'revision',
          importSourceId: 'source',
        },
      ],
    });
    expect(searched).toEqual(['1']);
  });
});
