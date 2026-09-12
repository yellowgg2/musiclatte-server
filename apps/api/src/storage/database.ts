import { closeSync, constants, lstatSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const APPLICATION_ID = 1296843092;
export const SCHEMA_VERSION = 26;
const MIGRATIONS = [
  new URL('./migrations/001-session.sql', import.meta.url),
  new URL('./migrations/002-playlist-operations.sql', import.meta.url),
  new URL('./migrations/003-imports.sql', import.meta.url),
  new URL('./migrations/004-import-worker.sql', import.meta.url),
  new URL('./migrations/005-registration.sql', import.meta.url),
  new URL('./migrations/006-import-api.sql', import.meta.url),
  new URL('./migrations/007-engine-lifecycle.sql', import.meta.url),
  new URL('./migrations/008-engine-requests.sql', import.meta.url),
  new URL('./migrations/009-metadata.sql', import.meta.url),
  new URL('./migrations/010-metadata-evidence.sql', import.meta.url),
  new URL('./migrations/011-metadata-rechecks.sql', import.meta.url),
  new URL('./migrations/012-metadata-backup-previews.sql', import.meta.url),
  new URL('./migrations/013-import-account.sql', import.meta.url),
  new URL('./migrations/014-scan-schedule.sql', import.meta.url),
  new URL('./migrations/015-access-tokens.sql', import.meta.url),
  new URL('./migrations/016-metadata-principals.sql', import.meta.url),
  new URL('./migrations/017-curation.sql', import.meta.url),
  new URL('./migrations/018-media-publications.sql', import.meta.url),
  new URL('./migrations/019-curation-inventory.sql', import.meta.url),
  new URL('./migrations/020-saved-mixes.sql', import.meta.url),
  new URL('./migrations/021-listening-history.sql', import.meta.url),
  new URL('./migrations/022-curation-metadata-fields.sql', import.meta.url),
  new URL('./migrations/023-metadata-organization.sql', import.meta.url),
  new URL('./migrations/024-organization-file-preimage.sql', import.meta.url),
  new URL('./migrations/025-organization-identity-publications.sql', import.meta.url),
  new URL('./migrations/026-curation-inventory-retries.sql', import.meta.url),
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
    'SELECT sequence,id,identity_key,name,conditions_json,revision,created_at,updated_at,deleted_at FROM saved_mixes LIMIT 0',
  );
  db.prepare(
    'SELECT identity_key,operation_id_hash,request_hash,kind,resource_id,result_json,created_at FROM mix_operations LIMIT 0',
  );
  db.prepare(
    'SELECT sequence,identity_key,event_id_hash,request_hash,song_id,source,started_at,qualified_at,received_at FROM listening_events LIMIT 0',
  );
  db.prepare(
    'SELECT event_sequence,status,claimed_at,finished_at FROM listening_deliveries LIMIT 0',
  );
  for (const table of [
    'curation_source_events',
    'media_publications',
    'curation_state',
    'curation_tracks',
    'curation_field_states',
    'curation_receipts',
    'curation_events',
    'curation_claims',
    'curation_claim_items',
    'curation_operations',
    'curation_inventory_runs',
    'curation_inventory_queue',
    'curation_inventory_failures',
    'curation_snapshots',
    'curation_snapshot_items',
    'organization_jobs',
    'organization_items',
    'organization_attempts',
    'organization_reference_checkpoints',
    'organization_source_locations',
    'organization_events',
    'organization_identity_publications',
  ])
    db.prepare(`SELECT * FROM ${table} LIMIT 0`);
  db.prepare(
    'SELECT attempt_count,next_attempt_at,last_error_code,terminal FROM curation_inventory_queue LIMIT 0',
  );
  db.prepare(
    'SELECT library_id,kind,opaque_id,failure_count,last_error_code,last_cause,first_failed_at,last_failed_at,resolved_at FROM curation_inventory_failures LIMIT 0',
  );
  const automation = db
    .prepare('SELECT credential_epoch FROM automation_state WHERE singleton=1')
    .get();
  if (
    typeof automation?.credential_epoch !== 'string' ||
    !/^[a-f0-9]{64}$/.test(automation.credential_epoch)
  )
    throw new Error('Unsupported storage schema');
  db.prepare(
    'SELECT id,instance_id,owner_username,name,scopes_json,library_ids_json,token_hash,created_at,expires_at,revoked_at,last_used_at,policy_revision,encrypted_proof FROM access_tokens LIMIT 0',
  );
  db.prepare(
    'SELECT enabled,interval_minutes,next_run_at,last_started_at,last_error,encrypted_proof,policy_revision,generation,lease_until FROM scan_schedule LIMIT 0',
  );
  db.prepare('SELECT backup_id,summary_json FROM metadata_backup_previews LIMIT 0');
  db.prepare(
    'SELECT identity_key,operation_id_hash,request_hash,job_id,created_at FROM metadata_rechecks LIMIT 0',
  );
  db.prepare(
    'SELECT item_id,references_json,reflection_json,updated_at FROM metadata_item_evidence LIMIT 0',
  );
  db.prepare('SELECT next_reflection_at FROM metadata_items LIMIT 0');
  db.prepare(
    'SELECT id,identity_key,library_id,operation_id_hash,request_hash,kind,parent_job_id,source_reference,usage_basis,created_at FROM metadata_jobs LIMIT 0',
  );
  db.prepare(
    'SELECT id,job_id,item_order,media_link_id,file_identity,binding_revision,original_track_id,current_track_id,expected_revision,expected_digest,patch_json,actor_session_id,actor_token_id,encrypted_job_grant,grant_epoch,policy_revision,parent_item_id,restore_backup_id,stage,generation,stage_changed_at,file_saved_at,reflected_at,result_revision,result_digest,candidate_key,error_code,changed_fields_json FROM metadata_items LIMIT 0',
  );
  db.prepare(
    'SELECT file_identity,item_id,owner,generation,expires_at FROM metadata_file_locks LIMIT 0',
  );
  db.prepare(
    'SELECT item_id,generation,owner,started_at,finished_at,error_code FROM metadata_attempts LIMIT 0',
  );
  db.prepare(
    'SELECT id,item_id,identity_key,library_id,relative_key,preimage_digest,size,mode,owner_profile_json,parent_backup_id,created_at FROM metadata_backups LIMIT 0',
  );
  db.prepare(
    'SELECT id,identity_key,library_id,operation_id_hash,digest,relative_key,mime_type,size,created_at,expires_at,actor_token_id FROM metadata_cover_uploads LIMIT 0',
  );
  db.prepare(
    'SELECT sequence,item_id,media_link_id,identity_key,library_id,old_revision,new_revision,related_ids_json,cover_generation,changed_fields_json,reflection_result,created_at FROM metadata_changes LIMIT 0',
  );
  db.prepare(
    'SELECT singleton,worker_id,status,heartbeat_at,active_item_id FROM metadata_worker_state LIMIT 0',
  );
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
    'SELECT account_directory, id, identity_key, library_id, operation_id_hash, request_hash, retry_of_job_id, created_at, cancel_requested_at FROM import_jobs LIMIT 0',
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
