import type { ManagementDatabase } from '../storage/database.js';
/** Shared by imports and metadata; the caller may include acquisition in its own transaction. */
export function createScanCoordinator(options: {
  database: ManagementDatabase;
  clock(): number;
  timeoutMs: number;
  retryMs: number;
}) {
  const db = options.database.connection;
  return {
    available() {
      const at = options.clock();
      return !!db
        .prepare(
          'SELECT 1 FROM registration_cycle WHERE singleton=1 AND expires_at<=? AND next_scan_at<=?',
        )
        .get(at, at);
    },
    acquire(owner: string) {
      const at = options.clock();
      const expires = at + options.timeoutMs + 1000;
      return (
        db
          .prepare(
            'UPDATE registration_cycle SET owner=?,expires_at=?,next_scan_at=? WHERE singleton=1 AND expires_at<=? AND next_scan_at<=?',
          )
          .run(owner, expires, expires + options.retryMs, at, at).changes === 1
      );
    },
    owns(owner: string) {
      return !!db
        .prepare('SELECT 1 FROM registration_cycle WHERE singleton=1 AND owner=? AND expires_at>?')
        .get(owner, options.clock());
    },
    release(owner: string, retry: boolean) {
      db.prepare(
        'UPDATE registration_cycle SET owner=NULL,expires_at=0,next_scan_at=? WHERE singleton=1 AND owner=?',
      ).run(options.clock() + (retry ? options.retryMs : 0), owner);
    },
  };
}
