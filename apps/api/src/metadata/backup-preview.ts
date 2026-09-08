import { decodeMetadataRestoreState } from '@musiclatte/contracts';
import type { MetadataTagSnapshot } from './helper-client.js';
import type { ManagementDatabase } from '../storage/database.js';

export function restoreState(snapshot: MetadataTagSnapshot) {
  return decodeMetadataRestoreState({
    values: snapshot.values,
    lyricsFrames: snapshot.lyricsFrames,
    covers: snapshot.coverFrames.map(({ description, pictureType, mimeType, digest }) => ({
      description,
      pictureType,
      mimeType,
      digest,
    })),
  });
}
/** Worker-only projection, including older backups. Never gives the API a private mount. */
export function createBackupPreviewIndexer(options: {
  database: ManagementDatabase;
  read: (key: string) => Promise<MetadataTagSnapshot>;
  clock: () => number;
}) {
  const deferred = new Map<string, number>();
  let cursor: { createdAt: number; id: string } | undefined;
  return async () => {
    const db = options.database.connection;
    const query = db.prepare(
      'SELECT b.id,b.created_at,b.relative_key,b.preimage_digest FROM metadata_backups b LEFT JOIN metadata_backup_previews p ON p.backup_id=b.id WHERE p.backup_id IS NULL AND (b.created_at>? OR (b.created_at=? AND b.id>?)) ORDER BY b.created_at,b.id LIMIT 64',
    );
    let rows = query.all(cursor?.createdAt ?? -1, cursor?.createdAt ?? -1, cursor?.id ?? '');
    if (rows.length === 0 && cursor) {
      cursor = undefined;
      rows = query.all(-1, -1, '');
    }
    const row = rows.find(
      (candidate) => (deferred.get(String(candidate.id)) ?? 0) <= options.clock(),
    );
    const visited = row ?? rows.at(-1);
    if (visited) cursor = { createdAt: Number(visited.created_at), id: String(visited.id) };
    if (!row) return false;
    const id = String(row.id);
    try {
      const snapshot = await options.read(String(row.relative_key));
      if (snapshot.fullDigest !== row.preimage_digest) throw new Error('restore_unavailable');
      const summary = restoreState(snapshot);
      db.prepare(
        'INSERT OR IGNORE INTO metadata_backup_previews(backup_id,summary_json) VALUES(?,?)',
      ).run(id, JSON.stringify(summary));
      deferred.delete(id);
      return true;
    } catch {
      deferred.set(id, options.clock() + 60000);
      return false;
    }
  };
}
