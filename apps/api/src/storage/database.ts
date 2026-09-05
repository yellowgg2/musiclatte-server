import { closeSync, constants, lstatSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const APPLICATION_ID = 1296843092;
export const SCHEMA_VERSION = 1;
export interface ManagementDatabase {
  connection: DatabaseSync;
  transaction<T>(work: () => T): T;
  close(): void;
}
/** Refuse foreign and unsupported schemas before any persistent PRAGMA or migration. */
export function validateSchema(db: DatabaseSync): void {
  if (
    db.prepare('PRAGMA application_id').get()?.application_id !== APPLICATION_ID ||
    db.prepare('PRAGMA user_version').get()?.user_version !== SCHEMA_VERSION
  ) {
    throw new Error('Unsupported storage schema');
  }
  db.prepare('SELECT singleton, id, policy_revision, key_id FROM instance LIMIT 0');
  db.prepare(
    'SELECT id_hash, instance_id, policy_revision, username, encrypted_proof, created_at, expires_at, revoked_at FROM sessions LIMIT 0',
  );
}
export function openDatabase(directory: string): ManagementDatabase {
  let connection: DatabaseSync | undefined;
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())
      throw new Error('Storage unavailable');
    const path = join(directory, 'management.sqlite');
    try {
      const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      closeSync(fd);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    }
    if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())
      throw new Error('Storage unavailable');
    connection = new DatabaseSync(path, { timeout: 100 });
    const db = connection;
    const version = db.prepare('PRAGMA user_version').get()?.user_version;
    const appId = db.prepare('PRAGMA application_id').get()?.application_id;
    const empty =
      db.prepare("SELECT count(*) AS count FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").get()
        ?.count === 0;
    if (version === 0 && appId === 0 && empty) {
      db.exec('BEGIN IMMEDIATE');
      try {
        // Recheck after obtaining the writer lock: another startup may have migrated first.
        if (db.prepare('PRAGMA user_version').get()?.user_version === 0)
          db.exec(readFileSync(new URL('./migrations/001-session.sql', import.meta.url), 'utf8'));
        validateSchema(db);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    } else validateSchema(db);
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    return {
      connection: db,
      transaction<T>(work: () => T): T {
        if (work.constructor.name === 'AsyncFunction')
          throw new Error('Synchronous transaction required');
        db.exec('BEGIN IMMEDIATE');
        try {
          const result = work();
          if (
            result !== null &&
            (typeof result === 'object' || typeof result === 'function') &&
            'then' in result
          )
            throw new Error('Synchronous transaction required');
          db.exec('COMMIT');
          return result;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
      close() {
        if (db.isOpen) db.close();
      },
    };
  } catch (error) {
    if (connection?.isOpen) connection.close();
    if (error instanceof Error && error.message === 'Unsupported storage schema') throw error;
    throw new Error('Storage unavailable');
  }
}
