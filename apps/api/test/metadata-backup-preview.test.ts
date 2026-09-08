import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
import { createBackupPreviewIndexer } from '../src/metadata/backup-preview.js';
import type { MetadataTagSnapshot } from '../src/metadata/helper-client.js';
import type { ManagementDatabase } from '../src/storage/database.js';
/** Existing backup projections are digest checked, tag-only, and a bad backup cannot block the next one. */
it('should backfill safe original summaries and defer corrupt backups', async () => {
  const connection = new DatabaseSync(':memory:');
  try {
    connection.exec(
      'CREATE TABLE metadata_backups(id TEXT,relative_key TEXT,preimage_digest TEXT,created_at INTEGER); CREATE TABLE metadata_backup_previews(backup_id TEXT PRIMARY KEY,summary_json TEXT)',
    );
    connection
      .prepare('INSERT INTO metadata_backups VALUES(?,?,?,?)')
      .run('bad', 'bad.backup', 'a'.repeat(64), 1);
    for (let i = 0; i < 64; i++) {
      connection
        .prepare('INSERT INTO metadata_backups VALUES(?,?,?,?)')
        .run(`bad-${i}`, `bad-${i}.backup`, 'a'.repeat(64), 1);
    }
    connection
      .prepare('INSERT INTO metadata_backups VALUES(?,?,?,?)')
      .run('good', 'good.backup', 'b'.repeat(64), 2);
    const read = vi.fn().mockResolvedValue({
      fullDigest: 'b'.repeat(64),
      values: {
        title: 'Original',
        artist: [],
        album: null,
        albumArtist: [],
        year: null,
        trackNumber: null,
        genre: [],
      },
      lyricsFrames: [],
      coverFrames: [],
      audio: { privatePayload: 'never publish' },
    } as unknown as MetadataTagSnapshot);
    const index = createBackupPreviewIndexer({
      database: { connection } as ManagementDatabase,
      read,
      clock: () => 100,
    });
    for (let i = 0; i < 65; i++) expect(await index()).toBe(false);
    expect(await index()).toBe(true);
    expect(await index()).toBe(false);
    const row = connection.prepare('SELECT * FROM metadata_backup_previews').get()!;
    expect(row.backup_id).toBe('good');
    expect(JSON.parse(String(row.summary_json))).toEqual({
      values: {
        title: 'Original',
        artist: [],
        album: null,
        albumArtist: [],
        year: null,
        trackNumber: null,
        genre: [],
      },
      lyricsFrames: [],
      covers: [],
    });
    expect(String(row.summary_json)).not.toMatch(/backup|privatePayload|fullDigest/);
  } finally {
    connection.close();
  }
});
