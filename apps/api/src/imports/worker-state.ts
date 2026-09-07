import { randomUUID } from 'node:crypto';
import type { ManagementDatabase } from '../storage/database.js';
import { createImportRepository, type ImportStage } from '../storage/import-repository.js';
import { validateRelativeKey } from './policy.js';

export interface PublishIntent {
  fileKey: string;
  stagingKey: string;
  eventId: string;
  mediaLinkId: string;
  disposition: 'new' | 'duplicate';
}

/** Synchronous lease-fenced transactions; no process or filesystem work is performed here. */
export function createWorkerLedger(
  database: ManagementDatabase,
  clock: () => number,
  owner: string,
  leaseMs: number,
) {
  const db = database.connection;
  const imports = createImportRepository({ database, clock });
  const now = () => {
    const value = clock();
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(value + leaseMs))
      throw new Error('worker_clock_invalid');
    return value;
  };
  const assertOwned = (id: string) => {
    const row = db
      .prepare('SELECT * FROM import_items WHERE id=? AND lease_owner=? AND lease_expires_at>?')
      .get(id, owner, now());
    if (!row) throw new Error('worker_lease_lost');
    return row;
  };
  const intent = (id: string): PublishIntent | null => {
    const row = db.prepare('SELECT * FROM import_publish_intents WHERE item_id=?').get(id);
    if (!row) return null;
    for (const key of ['relative_file_key', 'staging_key', 'event_id', 'media_link_id'])
      if (typeof row[key] !== 'string' || !row[key]) throw new Error('worker_storage_invalid');
    const fileKey = validateRelativeKey(String(row.relative_file_key));
    const stagingKey = validateRelativeKey(String(row.staging_key));
    if (row.disposition !== 'new' && row.disposition !== 'duplicate')
      throw new Error('worker_storage_invalid');
    return {
      fileKey,
      stagingKey,
      eventId: String(row.event_id),
      mediaLinkId: String(row.media_link_id),
      disposition: row.disposition,
    };
  };
  return {
    imports,
    assertOwned,
    intent,
    claim() {
      return database.transaction(() => {
        const at = now();
        // v1 serializes all download work, not just claims for the same item.
        if (
          db
            .prepare(
              "SELECT 1 FROM import_items WHERE stage IN ('resolving','downloading','postprocessing','publishing') AND lease_expires_at>? LIMIT 1",
            )
            .get(at)
        )
          return null;
        const row = db
          .prepare(
            "SELECT i.id,i.job_id,i.stage,i.attempt FROM import_items i JOIN import_jobs j ON j.id=i.job_id WHERE i.stage IN ('queued','resolving','downloading','postprocessing','publishing') AND (i.lease_owner IS NULL OR i.lease_expires_at<=?) ORDER BY CASE WHEN i.stage='publishing' THEN 0 ELSE 1 END,j.created_at,i.item_order LIMIT 1",
          )
          .get(at);
        if (
          !row ||
          typeof row.id !== 'string' ||
          typeof row.job_id !== 'string' ||
          typeof row.attempt !== 'number'
        )
          return null;
        const stage = row.stage === 'queued' ? 'resolving' : String(row.stage);
        db.prepare(
          "UPDATE import_items SET stage=?,attempt=attempt+1,lease_owner=?,lease_expires_at=?,stage_changed_at=?,resolving_at=CASE WHEN ?='resolving' THEN COALESCE(resolving_at,?) ELSE resolving_at END WHERE id=?",
        ).run(stage, owner, at + leaseMs, at, stage, at, row.id);
        const job = imports.getJob(row.job_id)!;
        return {
          job,
          item: job.items.find((item) => item.id === row.id)!,
          recovering: row.attempt > 0,
        };
      });
    },
    heartbeat(id: string) {
      database.transaction(() => {
        assertOwned(id);
        db.prepare('UPDATE import_items SET lease_expires_at=? WHERE id=?').run(
          now() + leaseMs,
          id,
        );
        db.prepare(
          "UPDATE worker_state SET worker_id=?,status='working',heartbeat_at=?,active_item_id=? WHERE singleton=1",
        ).run(owner, now(), id);
      });
    },
    startAttempt(id: string, stagingKey: string) {
      validateRelativeKey(stagingKey);
      database.transaction(() => {
        const row = assertOwned(id);
        db.prepare(
          'INSERT INTO import_attempts(item_id,attempt,staging_key,started_at) VALUES(?,?,?,?)',
        ).run(id, row.attempt!, stagingKey, now());
      });
    },
    engine(id: string, version: string) {
      if (!version || version.length > 128 || /[\x00-\x1f]/.test(version))
        throw new Error('invalid_engine');
      database.transaction(() => {
        const row = assertOwned(id);
        db.prepare('UPDATE import_items SET engine_version=? WHERE id=?').run(version, id);
        db.prepare('UPDATE import_attempts SET engine_version=? WHERE item_id=? AND attempt=?').run(
          version,
          id,
          row.attempt!,
        );
      });
    },
    stagingKeys(id: string) {
      return db
        .prepare('SELECT staging_key FROM import_attempts WHERE item_id=? AND cleaned_at IS NULL')
        .all(id)
        .map((row) => validateRelativeKey(String(row.staging_key)));
    },
    advance(
      id: string,
      stage: ImportStage,
      observed?: { title: string; channel: string; channelId: string },
    ) {
      return imports.advanceItem({
        itemId: id,
        workerId: owner,
        stage,
        ...(observed ? { observed } : {}),
      });
    },
    saveIntent(id: string, value: PublishIntent) {
      validateRelativeKey(value.fileKey);
      validateRelativeKey(value.stagingKey);
      database.transaction(() => {
        const row = assertOwned(id);
        if (
          row.stage !== 'postprocessing' &&
          !(row.stage === 'resolving' && value.disposition === 'duplicate')
        )
          throw new Error('worker_transition_invalid');
        db.prepare(
          'INSERT INTO import_publish_intents(item_id,relative_file_key,staging_key,event_id,media_link_id,intended_at,disposition) VALUES(?,?,?,?,?,?,?)',
        ).run(
          id,
          value.fileKey,
          value.stagingKey,
          value.eventId,
          value.mediaLinkId,
          now(),
          value.disposition,
        );
        db.prepare(
          "UPDATE import_items SET stage='publishing',publishing_at=?,stage_changed_at=? WHERE id=?",
        ).run(now(), now(), id);
      });
    },
    recordIdentity(id: string, identity: { dev: number; ino: number }) {
      if (!Number.isSafeInteger(identity.dev) || !Number.isSafeInteger(identity.ino))
        throw new Error('worker_storage_invalid');
      database.transaction(() => {
        assertOwned(id);
        db.prepare(
          'UPDATE import_publish_intents SET pending_device=?,pending_inode=? WHERE item_id=?',
        ).run(identity.dev, identity.ino, id);
      });
    },
    ownsPublishedFile(id: string, identity: { dev: number; ino: number }) {
      const row = db
        .prepare('SELECT pending_device,pending_inode FROM import_publish_intents WHERE item_id=?')
        .get(id);
      return row?.pending_device === identity.dev && row.pending_inode === identity.ino;
    },
    complete(id: string, duplicate: boolean) {
      return database.transaction(() => {
        const row = assertOwned(id);
        const value = intent(id);
        if (!value || row.stage !== 'publishing') throw new Error('worker_transition_invalid');
        const job = imports.getJob(String(row.job_id))!;
        const at = now();
        let media = db
          .prepare('SELECT id FROM media_links WHERE library_id=? AND relative_file_key=?')
          .get(job.libraryId, value.fileKey);
        if (!media) {
          db.prepare(
            "INSERT INTO media_links(id,library_id,relative_file_key,gonic_song_id,revision,availability,created_at) VALUES(?,?,?,NULL,1,'unavailable',?)",
          ).run(value.mediaLinkId, job.libraryId, value.fileKey, at);
          media = { id: value.mediaLinkId };
        }
        if (!duplicate)
          db.prepare(
            'INSERT INTO download_events(id,import_item_id,identity_key,library_id,download_completed_at) VALUES(?,?,?,?,?)',
          ).run(value.eventId, id, job.identityKey, job.libraryId, at);
        db.prepare('UPDATE import_publish_intents SET completed_at=? WHERE item_id=?').run(at, id);
        db.prepare(
          'UPDATE import_items SET stage=?,media_link_id=?,stage_changed_at=?,registering_at=?,lease_owner=NULL,lease_expires_at=NULL WHERE id=?',
        ).run(duplicate ? 'duplicate' : 'registering', media.id!, at, duplicate ? null : at, id);
        return imports.getJob(job.id)!;
      });
    },
    finish(id: string, cancelled: boolean, failureCode: string) {
      database.transaction(() => {
        assertOwned(id);
        db.prepare(
          'UPDATE import_items SET stage=?,failure_code=?,stage_changed_at=?,lease_owner=NULL,lease_expires_at=NULL WHERE id=?',
        ).run(cancelled ? 'cancelled' : 'failed', cancelled ? null : failureCode, now(), id);
      });
    },
    findSource(libraryId: string, sourceId: string) {
      const row = db
        .prepare(
          "SELECT m.id,m.relative_file_key FROM import_items i JOIN import_jobs j ON j.id=i.job_id JOIN media_links m ON m.id=i.media_link_id WHERE i.source_id=? AND j.library_id=? AND i.stage IN ('registering','ready','duplicate') ORDER BY i.id LIMIT 1",
        )
        .get(sourceId, libraryId);
      return row
        ? { id: String(row.id), fileKey: validateRelativeKey(String(row.relative_file_key)) }
        : null;
    },
    cleaned(stagingKey: string) {
      db.prepare(
        'UPDATE import_attempts SET cleaned_at=? WHERE staging_key=? AND cleaned_at IS NULL',
      ).run(now(), stagingKey);
    },
    idle() {
      db.prepare(
        "UPDATE worker_state SET worker_id=?,status='idle',heartbeat_at=?,active_item_id=NULL WHERE singleton=1 AND NOT EXISTS (SELECT 1 FROM import_items WHERE stage IN ('resolving','downloading','postprocessing','publishing') AND lease_expires_at>?)",
      ).run(owner, now(), now());
    },
    stop() {
      db.prepare(
        "UPDATE worker_state SET worker_id=NULL,status='stopped',heartbeat_at=NULL,active_item_id=NULL WHERE singleton=1 AND worker_id=?",
      ).run(owner);
    },
    newIntent(fileKey: string, stagingKey: string, duplicate = false): PublishIntent {
      return {
        fileKey,
        stagingKey,
        eventId: randomUUID(),
        mediaLinkId: randomUUID(),
        disposition: duplicate ? 'duplicate' : 'new',
      };
    },
  };
}
