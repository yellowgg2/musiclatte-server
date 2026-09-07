import { closeSync, constants, lstatSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const APPLICATION_ID = 1296843092;
export const SCHEMA_VERSION = 8;
const MIGRATIONS = [
  new URL('./migrations/001-session.sql', import.meta.url),
  new URL('./migrations/002-playlist-operations.sql', import.meta.url),
  new URL('./migrations/003-imports.sql', import.meta.url),
  new URL('./migrations/004-import-worker.sql', import.meta.url),
  new URL('./migrations/005-registration.sql', import.meta.url),
  new URL('./migrations/006-import-api.sql', import.meta.url),
  new URL('./migrations/007-engine-lifecycle.sql', import.meta.url),
  new URL('./migrations/008-engine-requests.sql', import.meta.url),
] as const;
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
  db.prepare(
    'SELECT singleton, action, active_version, previous_version, requested_at, status, restored_active_version, restored_previous_version, owner, expires_at FROM engine_requests LIMIT 0',
  );
  db.prepare('SELECT duplicate_of_item_id FROM import_items LIMIT 0');
  db.prepare(
    'SELECT item_id, attempt, next_attempt_at, failure_code FROM registration_attempts LIMIT 0',
  );
  db.prepare('SELECT singleton, owner, expires_at, next_scan_at FROM registration_cycle LIMIT 0');
  db.prepare(
    'SELECT item_id, relative_file_key, staging_key, event_id, media_link_id, intended_at, completed_at, pending_device, pending_inode, disposition FROM import_publish_intents LIMIT 0',
  );
  db.prepare(
    'SELECT item_id, attempt, staging_key, engine_version, started_at, cleaned_at FROM import_attempts LIMIT 0',
  );
  db.prepare('SELECT singleton, id, policy_revision, key_id FROM instance LIMIT 0');
  db.prepare(
    'SELECT id_hash, instance_id, policy_revision, username, encrypted_proof, created_at, expires_at, revoked_at FROM sessions LIMIT 0',
  );
  db.prepare(
    'SELECT identity_key, operation_id_hash, request_hash, kind, resource_id, before_revision, after_revision, status, created_at, finished_at FROM playlist_operations LIMIT 0',
  );
  db.prepare(
    'SELECT id, identity_key, library_id, operation_id_hash, request_hash, retry_of_job_id, created_at, cancel_requested_at FROM import_jobs LIMIT 0',
  );
  db.prepare(
    'SELECT id, job_id, item_order, source_id, observed_title, observed_channel, observed_channel_id, stage, failure_code, attempt, lease_owner, lease_expires_at, engine_version, media_link_id, stage_changed_at, resolving_at, downloading_at, postprocessing_at, publishing_at, registering_at, ready_at FROM import_items LIMIT 0',
  );
  db.prepare(
    'SELECT id, library_id, relative_file_key, gonic_song_id, revision, availability, created_at, validated_at FROM media_links LIMIT 0',
  );
  db.prepare(
    'SELECT id, import_item_id, identity_key, library_id, download_completed_at, registered_at FROM download_events LIMIT 0',
  );
  db.prepare(
    'SELECT singleton, last_checked_at, last_check_succeeded_at, active_version, candidate_version, previous_version, status, failure_code, candidate_key, candidate_hash, operation_token, operation_expires_at FROM engine_state LIMIT 0',
  );
  db.prepare(
    'SELECT singleton, worker_id, status, heartbeat_at, active_item_id FROM worker_state LIMIT 0',
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
    const fresh = version === 0 && appId === 0 && empty;
    const upgrade =
      typeof version === 'number' &&
      version >= 1 &&
      version < SCHEMA_VERSION &&
      appId === APPLICATION_ID;
    if (!fresh && !upgrade && !(version === SCHEMA_VERSION && appId === APPLICATION_ID))
      throw new Error('Unsupported storage schema');
    if (fresh || upgrade) {
      // Table rebuilds retain references; validate all foreign keys before committing.
      db.exec('PRAGMA foreign_keys=OFF');
      db.exec('BEGIN IMMEDIATE');
      try {
        // Recheck each version after obtaining the writer lock: another startup may migrate first.
        let current = db.prepare('PRAGMA user_version').get()?.user_version;
        while (typeof current === 'number' && current < SCHEMA_VERSION) {
          const migration = MIGRATIONS[current];
          if (!migration) throw new Error('Unsupported storage schema');
          db.exec(readFileSync(migration, 'utf8'));
          const next = db.prepare('PRAGMA user_version').get()?.user_version;
          if (next !== current + 1) throw new Error('Unsupported storage schema');
          current = next;
        }
        validateSchema(db);
        if (db.prepare('PRAGMA foreign_key_check').all().length)
          throw new Error('Storage unavailable');
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
