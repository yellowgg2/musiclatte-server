import type { DatabaseSync } from 'node:sqlite';
import { validateRelativeKey } from '../imports/policy.js';
import type { ManagementDatabase } from './database.js';

export type ImportStage =
  | 'queued'
  | 'resolving'
  | 'downloading'
  | 'postprocessing'
  | 'publishing'
  | 'registering'
  | 'ready'
  | 'failed'
  | 'cancelled'
  | 'duplicate';

export interface ImportItem {
  id: string;
  sourceId: string;
  observedTitle: string | null;
  observedChannel: string | null;
  observedChannelId: string | null;
  stage: ImportStage;
  failureCode: string | null;
  attempt: number;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
  engineVersion: string | null;
  mediaLinkId: string | null;
  duplicateOfItemId: string | null;
}

export interface ImportJob {
  accountDirectory?: string;
  id: string;
  identityKey: string;
  libraryId: string;
  operationIdHash: string;
  requestHash: string;
  retryOfJobId: string | null;
  createdAt: number;
  cancelRequestedAt: number | null;
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
  items: ImportItem[];
}

const fingerprint = /^[a-f0-9]{64}$/;
const stages = new Set<ImportStage>([
  'queued',
  'resolving',
  'downloading',
  'postprocessing',
  'publishing',
  'registering',
  'ready',
  'failed',
  'cancelled',
  'duplicate',
]);
const terminal = new Set<ImportStage>(['ready', 'failed', 'cancelled', 'duplicate']);
const nextStage: Partial<Record<ImportStage, ImportStage>> = {
  resolving: 'downloading',
  downloading: 'postprocessing',
  postprocessing: 'publishing',
};

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function time(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function nullableText(value: unknown): value is string | null {
  return value === null || text(value);
}

function nullableTime(value: unknown): value is number | null {
  return value === null || time(value);
}

function decodeItem(row: Record<string, unknown>): ImportItem {
  const item = {
    id: row.id,
    sourceId: row.source_id,
    observedTitle: row.observed_title,
    observedChannel: row.observed_channel,
    observedChannelId: row.observed_channel_id,
    stage: row.stage,
    failureCode: row.failure_code,
    attempt: row.attempt,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    engineVersion: row.engine_version,
    mediaLinkId: row.media_link_id,
    duplicateOfItemId: row.duplicate_of_item_id,
  };
  if (
    !text(item.id) ||
    !text(item.sourceId) ||
    !nullableText(item.observedTitle) ||
    !nullableText(item.observedChannel) ||
    !nullableText(item.observedChannelId) ||
    typeof item.stage !== 'string' ||
    !stages.has(item.stage as ImportStage) ||
    !nullableText(item.failureCode) ||
    !time(item.attempt) ||
    !nullableText(item.leaseOwner) ||
    !nullableTime(item.leaseExpiresAt) ||
    !nullableText(item.engineVersion) ||
    !nullableText(item.duplicateOfItemId) ||
    !nullableText(item.mediaLinkId)
  )
    throw new Error('Storage unavailable');
  return item as ImportItem;
}

function deriveStatus(items: ImportItem[]): ImportJob['status'] {
  if (items.some((item) => !terminal.has(item.stage) && item.stage !== 'queued')) return 'running';
  if (items.some((item) => item.stage === 'queued')) return 'queued';
  if (items.every((item) => item.stage === 'ready' || item.stage === 'duplicate'))
    return 'completed';
  if (items.every((item) => item.stage === 'failed')) return 'failed';
  if (items.every((item) => item.stage === 'cancelled')) return 'cancelled';
  return 'partial';
}

function decodeEvent(row: Record<string, unknown> | undefined) {
  if (!row) return null;
  const event = {
    id: row.id,
    importItemId: row.import_item_id,
    identityKey: row.identity_key,
    libraryId: row.library_id,
    downloadCompletedAt: row.download_completed_at,
    registeredAt: row.registered_at,
  };
  if (
    !text(event.id) ||
    !text(event.importItemId) ||
    typeof event.identityKey !== 'string' ||
    !fingerprint.test(event.identityKey) ||
    !text(event.libraryId) ||
    !time(event.downloadCompletedAt) ||
    !nullableTime(event.registeredAt)
  )
    throw new Error('Storage unavailable');
  return event as {
    id: string;
    importItemId: string;
    identityKey: string;
    libraryId: string;
    downloadCompletedAt: number;
    registeredAt: number | null;
  };
}

/** Validate every import item and event in a backup snapshot. */
export function validateImportStorage(database: DatabaseSync): void {
  for (const row of database.prepare('SELECT * FROM import_publish_intents').iterate()) {
    if (
      !text(row.relative_file_key) ||
      !text(row.staging_key) ||
      !text(row.event_id) ||
      !text(row.media_link_id) ||
      !time(row.intended_at) ||
      !nullableTime(row.completed_at) ||
      !nullableTime(row.pending_device) ||
      !nullableTime(row.pending_inode) ||
      (row.pending_device === null) !== (row.pending_inode === null)
    )
      throw new Error('Storage unavailable');
    validateRelativeKey(row.relative_file_key);
    validateRelativeKey(row.staging_key);
  }
  for (const row of database.prepare('SELECT * FROM import_attempts').iterate()) {
    if (
      !text(row.staging_key) ||
      !time(row.started_at) ||
      !nullableTime(row.cleaned_at) ||
      !nullableText(row.engine_version)
    )
      throw new Error('Storage unavailable');
    validateRelativeKey(row.staging_key);
  }
  for (const row of database.prepare('SELECT * FROM import_items').iterate()) decodeItem(row);
  for (const row of database.prepare('SELECT * FROM download_events').iterate()) decodeEvent(row);
  if (
    database
      .prepare(
        "SELECT 1 FROM download_events e JOIN import_items i ON i.id=e.import_item_id JOIN import_jobs j ON j.id=i.job_id WHERE e.identity_key<>j.identity_key OR e.library_id<>j.library_id OR i.stage NOT IN ('registering','ready') LIMIT 1",
      )
      .get() ||
    database
      .prepare(
        'SELECT 1 FROM import_items i JOIN import_jobs j ON j.id=i.job_id JOIN media_links m ON m.id=i.media_link_id WHERE j.library_id<>m.library_id LIMIT 1',
      )
      .get() ||
    database
      .prepare(
        'SELECT 1 FROM import_jobs child JOIN import_jobs parent ON parent.id=child.retry_of_job_id WHERE child.identity_key<>parent.identity_key OR child.library_id<>parent.library_id LIMIT 1',
      )
      .get()
  )
    throw new Error('Storage unavailable');
}

/** Append-only event ledger; rowid is an insertion fence, independent of completion time. */
export const recentDownloadQuery = `
  SELECT e.*, i.media_link_id
  FROM download_events AS e INDEXED BY download_events_recent
  JOIN import_items AS i ON i.id=e.import_item_id
  WHERE e.identity_key=? AND e.library_id=?
    AND e.download_completed_at>=? AND e.download_completed_at<?
    AND e.download_completed_at<=? AND e.rowid<=?
    AND (? IS NULL OR (e.download_completed_at,e.id)<(?,?))
  ORDER BY e.download_completed_at DESC,e.id DESC LIMIT ?`;

/** Durable import ledger; callers keep network, process, and filesystem work outside transactions. */
export function createImportRepository(options: {
  database: ManagementDatabase;
  clock: () => number;
}) {
  const { database, clock } = options;
  const db = database.connection;
  const now = () => {
    const value = clock();
    if (!time(value)) throw new Error('Invalid import time');
    return value;
  };
  const readItem = (id: string) => {
    const row = db.prepare('SELECT * FROM import_items WHERE id=?').get(id);
    return row ? decodeItem(row) : null;
  };
  const readJob = (id: string): ImportJob | null => {
    const row = db.prepare('SELECT * FROM import_jobs WHERE id=?').get(id);
    if (!row) return null;
    const items = db
      .prepare('SELECT * FROM import_items WHERE job_id=? ORDER BY item_order')
      .all(id)
      .map(decodeItem);
    if (
      !text(row.id) ||
      typeof row.identity_key !== 'string' ||
      !fingerprint.test(row.identity_key) ||
      !text(row.library_id) ||
      typeof row.operation_id_hash !== 'string' ||
      !fingerprint.test(row.operation_id_hash) ||
      typeof row.request_hash !== 'string' ||
      !fingerprint.test(row.request_hash) ||
      !nullableText(row.retry_of_job_id) ||
      !time(row.created_at) ||
      !nullableTime(row.cancel_requested_at)
    )
      throw new Error('Storage unavailable');
    return {
      ...(row.account_directory === null
        ? {}
        : { accountDirectory: validateRelativeKey(String(row.account_directory)) }),
      id: row.id,
      identityKey: row.identity_key,
      libraryId: row.library_id,
      operationIdHash: row.operation_id_hash,
      requestHash: row.request_hash,
      retryOfJobId: row.retry_of_job_id,
      createdAt: row.created_at,
      cancelRequestedAt: row.cancel_requested_at,
      status: deriveStatus(items),
      items,
    };
  };

  type JobInput = {
    accountDirectory?: string;
    id: string;
    identityKey: string;
    libraryId: string;
    operationIdHash: string;
    requestHash: string;
    retryOfJobId?: string;
    deduplicate?: boolean;
    items: { id: string; sourceId: string }[];
  };

  function insertJob(input: JobInput) {
    if (
      !text(input.id) ||
      !fingerprint.test(input.identityKey) ||
      !text(input.libraryId) ||
      !fingerprint.test(input.operationIdHash) ||
      !fingerprint.test(input.requestHash) ||
      (input.retryOfJobId !== undefined && !text(input.retryOfJobId)) ||
      input.items.length === 0 ||
      !input.items.every((item) => text(item.id) && text(item.sourceId)) ||
      new Set(input.items.map((item) => item.id)).size !== input.items.length
    )
      throw new Error('Invalid import job');
    if (
      input.accountDirectory !== undefined &&
      validateRelativeKey(input.accountDirectory).includes('/')
    )
      throw new Error('Invalid import account');
    if (input.accountDirectory !== undefined) {
      const owners = db
        .prepare(
          'SELECT DISTINCT account_directory,identity_key FROM import_jobs WHERE library_id=? AND account_directory IS NOT NULL',
        )
        .all(input.libraryId);
      if (
        owners.some(
          (owner) =>
            String(owner.account_directory).normalize('NFC').toLowerCase() ===
              input.accountDirectory!.normalize('NFC').toLowerCase() &&
            owner.identity_key !== input.identityKey,
        )
      )
        throw new Error('Import account directory conflict');
    }
    const createdAt = now();
    const existing = db
      .prepare(
        'SELECT id,request_hash FROM import_jobs WHERE identity_key=? AND operation_id_hash=?',
      )
      .get(input.identityKey, input.operationIdHash);
    if (existing) {
      const job = readJob(String(existing.id))!;
      return {
        outcome: existing.request_hash === input.requestHash ? 'existing' : 'conflict',
        job,
      };
    }
    db.prepare(
      'INSERT INTO import_jobs(id,identity_key,library_id,operation_id_hash,request_hash,retry_of_job_id,created_at,cancel_requested_at,account_directory) VALUES(?,?,?,?,?,?,?,NULL,?)',
    ).run(
      input.id,
      input.identityKey,
      input.libraryId,
      input.operationIdHash,
      input.requestHash,
      input.retryOfJobId ?? null,
      createdAt,
      input.accountDirectory ?? null,
    );
    const statement = db.prepare(
      "INSERT INTO import_items(id,job_id,item_order,source_id,stage,failure_code,attempt,lease_owner,lease_expires_at,engine_version,media_link_id,stage_changed_at) VALUES(?,?,?,?,'queued',NULL,0,NULL,NULL,NULL,NULL,?)",
    );
    input.items.forEach((item, index) =>
      statement.run(item.id, input.id, index, item.sourceId, createdAt),
    );
    if (input.deduplicate) {
      for (const item of input.items) {
        const media =
          input.accountDirectory !== undefined
            ? undefined
            : db
                .prepare(
                  "SELECT m.id FROM import_items i JOIN import_jobs j ON j.id=i.job_id JOIN media_links m ON m.id=i.media_link_id WHERE i.source_id=? AND j.library_id=? AND j.account_directory IS NULL AND m.availability='available' AND m.gonic_song_id IS NOT NULL ORDER BY i.id LIMIT 1",
                )
                .get(item.sourceId, input.libraryId);
        const active = media
          ? undefined
          : db
              .prepare(
                "SELECT i.id FROM import_items i JOIN import_jobs j ON j.id=i.job_id WHERE i.source_id=? AND j.library_id=? AND j.account_directory IS ? AND i.id<>? AND i.stage IN ('queued','resolving','downloading','postprocessing','publishing','registering') AND (j.id<>? OR i.item_order<(SELECT item_order FROM import_items WHERE id=?)) ORDER BY j.created_at,j.id,i.item_order LIMIT 1",
              )
              .get(
                item.sourceId,
                input.libraryId,
                input.accountDirectory ?? null,
                item.id,
                input.id,
                item.id,
              );
        if (media || active)
          db.prepare(
            "UPDATE import_items SET stage='duplicate',media_link_id=?,duplicate_of_item_id=? WHERE id=?",
          ).run(media ? String(media.id) : null, active ? String(active.id) : null, item.id);
      }
    }
    return { outcome: 'created', job: readJob(input.id)! };
  }

  function ownedItem(itemId: string, workerId: string, expected: ImportStage[]): ImportItem {
    const item = readItem(itemId);
    if (!item || item.leaseOwner !== workerId || !expected.includes(item.stage))
      throw new Error('Invalid import transition');
    if (item.leaseExpiresAt === null || item.leaseExpiresAt <= now())
      throw new Error('Import lease lost');
    return item;
  }

  return {
    createJob(input: JobInput) {
      return database.transaction(() => insertJob(input));
    },
    listJobs(
      identityKey: string,
      libraryIds: string[],
      limit: number,
      before?: { createdAt: number; id: string },
    ) {
      if (!libraryIds.length) return [];
      const placeholders = libraryIds.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT id FROM import_jobs WHERE identity_key=? AND library_id IN (${placeholders}) ${before ? 'AND (created_at<? OR (created_at=? AND id<?))' : ''} ORDER BY created_at DESC,id DESC LIMIT ?`,
        )
        .all(
          identityKey,
          ...libraryIds,
          ...(before ? [before.createdAt, before.createdAt, before.id] : []),
          limit,
        );
      return rows.map((row) => readJob(String(row.id))!);
    },
    findOperation(identityKey: string, operationIdHash: string) {
      const row = db
        .prepare('SELECT id FROM import_jobs WHERE identity_key=? AND operation_id_hash=?')
        .get(identityKey, operationIdHash);
      return row ? readJob(String(row.id)) : null;
    },
    getJob(id: string) {
      if (!text(id)) throw new Error('Invalid import job');
      return readJob(id);
    },
    claimNext(input: { workerId: string; leaseDurationMs: number; engineVersion: string }) {
      if (
        !text(input.workerId) ||
        !text(input.engineVersion) ||
        !Number.isSafeInteger(input.leaseDurationMs) ||
        input.leaseDurationMs <= 0
      )
        throw new Error('Invalid import claim');
      return database.transaction(() => {
        const claimedAt = now();
        const expiresAt = claimedAt + input.leaseDurationMs;
        if (!Number.isSafeInteger(expiresAt)) throw new Error('Invalid import claim');
        const row = db
          .prepare(
            "SELECT i.id,i.stage FROM import_items i JOIN import_jobs j ON j.id=i.job_id WHERE i.stage IN ('queued','resolving','downloading','postprocessing','publishing','registering') AND (i.lease_owner IS NULL OR i.lease_expires_at<=?) AND (j.cancel_requested_at IS NULL OR i.stage IN ('publishing','registering')) ORDER BY j.created_at,i.item_order LIMIT 1",
          )
          .get(claimedAt);
        if (!row) return null;
        if (!text(row.id) || typeof row.stage !== 'string' || !stages.has(row.stage as ImportStage))
          throw new Error('Storage unavailable');
        const stage = row.stage === 'queued' ? 'resolving' : row.stage;
        db.prepare(
          "UPDATE import_items SET stage=?,stage_changed_at=?,resolving_at=CASE WHEN ?='resolving' THEN COALESCE(resolving_at,?) ELSE resolving_at END,attempt=attempt+1,lease_owner=?,lease_expires_at=?,engine_version=COALESCE(engine_version,?) WHERE id=?",
        ).run(
          stage,
          claimedAt,
          stage,
          claimedAt,
          input.workerId,
          expiresAt,
          input.engineVersion,
          row.id,
        );
        return readItem(row.id);
      });
    },
    renewLease(input: { itemId: string; workerId: string; leaseDurationMs: number }) {
      if (
        !text(input.itemId) ||
        !text(input.workerId) ||
        !Number.isSafeInteger(input.leaseDurationMs) ||
        input.leaseDurationMs <= 0
      )
        throw new Error('Invalid import claim');
      return database.transaction(() => {
        const renewedAt = now();
        const expiresAt = renewedAt + input.leaseDurationMs;
        const result = db
          .prepare(
            "UPDATE import_items SET lease_expires_at=? WHERE id=? AND lease_owner=? AND lease_expires_at>? AND stage NOT IN ('ready','failed','cancelled','duplicate')",
          )
          .run(expiresAt, input.itemId, input.workerId, renewedAt);
        if (result.changes !== 1) throw new Error('Import lease lost');
        return readItem(input.itemId)!;
      });
    },
    advanceItem(input: {
      itemId: string;
      workerId: string;
      stage: ImportStage;
      observed?: { title: string; channel: string; channelId: string };
    }) {
      if (!text(input.itemId) || !text(input.workerId) || !stages.has(input.stage))
        throw new Error('Invalid import transition');
      return database.transaction(() => {
        const item = readItem(input.itemId);
        if (!item || nextStage[item.stage] !== input.stage)
          throw new Error('Invalid import transition');
        ownedItem(input.itemId, input.workerId, [item.stage]);
        const changedAt = now();
        const column = `${input.stage}_at`;
        if (input.stage === 'downloading') {
          if (
            !input.observed ||
            !text(input.observed.title) ||
            !text(input.observed.channel) ||
            !text(input.observed.channelId)
          )
            throw new Error('Invalid import transition');
          db.prepare(
            `UPDATE import_items SET stage=?,stage_changed_at=?,${column}=?,observed_title=?,observed_channel=?,observed_channel_id=? WHERE id=?`,
          ).run(
            input.stage,
            changedAt,
            changedAt,
            input.observed.title,
            input.observed.channel,
            input.observed.channelId,
            input.itemId,
          );
        } else {
          if (input.observed !== undefined) throw new Error('Invalid import transition');
          db.prepare(
            `UPDATE import_items SET stage=?,stage_changed_at=?,${column}=? WHERE id=?`,
          ).run(input.stage, changedAt, changedAt, input.itemId);
        }
        return readItem(input.itemId)!;
      });
    },
    recordPublished(input: { itemId: string; workerId: string; eventId: string }) {
      if (!text(input.eventId)) throw new Error('Invalid download event');
      return database.transaction(() => {
        ownedItem(input.itemId, input.workerId, ['publishing']);
        const publishedAt = now();
        const job = db
          .prepare(
            'SELECT j.identity_key,j.library_id FROM import_jobs j JOIN import_items i ON i.job_id=j.id WHERE i.id=?',
          )
          .get(input.itemId)!;
        if (!text(job.identity_key) || !text(job.library_id))
          throw new Error('Storage unavailable');
        db.prepare(
          'INSERT INTO download_events(id,import_item_id,identity_key,library_id,download_completed_at,registered_at) VALUES(?,?,?,?,?,NULL)',
        ).run(input.eventId, input.itemId, job.identity_key, job.library_id, publishedAt);
        db.prepare(
          "UPDATE import_items SET stage='registering',stage_changed_at=?,registering_at=? WHERE id=?",
        ).run(publishedAt, publishedAt, input.itemId);
        return readItem(input.itemId)!;
      });
    },
    finishRegistration(input: { itemId: string; workerId: string; mediaLinkId: string }) {
      if (!text(input.mediaLinkId)) throw new Error('Invalid import transition');
      return database.transaction(() => {
        ownedItem(input.itemId, input.workerId, ['registering']);
        const row = db
          .prepare(
            "SELECT j.library_id AS job_library,m.library_id AS media_library FROM import_items i JOIN import_jobs j ON j.id=i.job_id JOIN media_links m ON m.id=? WHERE i.id=? AND m.gonic_song_id IS NOT NULL AND m.availability='available'",
          )
          .get(input.mediaLinkId, input.itemId);
        if (!row || row.job_library !== row.media_library)
          throw new Error('Invalid import transition');
        const registeredAt = now();
        const event = db
          .prepare(
            'UPDATE download_events SET registered_at=? WHERE import_item_id=? AND registered_at IS NULL',
          )
          .run(registeredAt, input.itemId);
        if (event.changes !== 1) throw new Error('Invalid import transition');
        db.prepare(
          "UPDATE import_items SET stage='ready',stage_changed_at=?,ready_at=?,media_link_id=?,lease_owner=NULL,lease_expires_at=NULL WHERE id=?",
        ).run(registeredAt, registeredAt, input.mediaLinkId, input.itemId);
        return readItem(input.itemId)!;
      });
    },
    failItem(input: { itemId: string; workerId: string; failureCode: string }) {
      if (!text(input.failureCode)) throw new Error('Invalid import transition');
      return database.transaction(() => {
        ownedItem(input.itemId, input.workerId, ['resolving', 'downloading', 'postprocessing']);
        const failedAt = now();
        db.prepare(
          "UPDATE import_items SET stage='failed',failure_code=?,stage_changed_at=?,lease_owner=NULL,lease_expires_at=NULL WHERE id=?",
        ).run(input.failureCode, failedAt, input.itemId);
        return readItem(input.itemId)!;
      });
    },
    markDuplicate(input: { itemId: string; workerId: string; mediaLinkId: string }) {
      if (!text(input.mediaLinkId)) throw new Error('Invalid import transition');
      return database.transaction(() => {
        ownedItem(input.itemId, input.workerId, ['resolving']);
        const row = db
          .prepare(
            'SELECT j.library_id AS job_library,m.library_id AS media_library FROM import_items i JOIN import_jobs j ON j.id=i.job_id JOIN media_links m ON m.id=? WHERE i.id=?',
          )
          .get(input.mediaLinkId, input.itemId);
        if (!row || row.job_library !== row.media_library)
          throw new Error('Invalid import transition');
        const changedAt = now();
        db.prepare(
          "UPDATE import_items SET stage='duplicate',stage_changed_at=?,media_link_id=?,lease_owner=NULL,lease_expires_at=NULL WHERE id=?",
        ).run(changedAt, input.mediaLinkId, input.itemId);
        return readItem(input.itemId)!;
      });
    },
    requestCancel(jobId: string) {
      if (!text(jobId)) throw new Error('Invalid import job');
      return database.transaction(() => {
        const job = readJob(jobId);
        if (!job) throw new Error('Import job not found');
        if (job.items.every((item) => terminal.has(item.stage))) return job;
        const cancelledAt = now();
        db.prepare(
          'UPDATE import_jobs SET cancel_requested_at=COALESCE(cancel_requested_at,?) WHERE id=?',
        ).run(cancelledAt, jobId);
        db.prepare(
          "UPDATE import_items SET stage='cancelled',stage_changed_at=?,lease_owner=NULL,lease_expires_at=NULL WHERE job_id=? AND stage='queued'",
        ).run(cancelledAt, jobId);
        return readJob(jobId)!;
      });
    },
    retryFailed(input: {
      deduplicate?: boolean;
      sourceJobId: string;
      id: string;
      operationIdHash: string;
      requestHash: string;
      itemIds: string[];
    }) {
      if (!text(input.sourceJobId) || input.itemIds.length === 0)
        throw new Error('Only failed import items can be retried');
      return database.transaction(() => {
        const source = readJob(input.sourceJobId);
        if (!source) throw new Error('Import job not found');
        const selected = input.itemIds.map((id) => source.items.find((item) => item.id === id));
        if (selected.some((item) => !item || item.stage !== 'failed'))
          throw new Error('Only failed import items can be retried');
        return insertJob({
          id: input.id,
          ...(source.accountDirectory === undefined
            ? {}
            : { accountDirectory: source.accountDirectory }),
          identityKey: source.identityKey,
          libraryId: source.libraryId,
          operationIdHash: input.operationIdHash,
          requestHash: input.requestHash,
          retryOfJobId: source.id,
          deduplicate: input.deduplicate ?? false,
          items: selected.map((item, index) => ({
            id: `${input.id}:${index}`,
            sourceId: item!.sourceId,
          })),
        });
      });
    },
    recentHighWater(): number {
      const value = db
        .prepare('SELECT COALESCE(MAX(rowid),0) AS high_water FROM download_events')
        .get()?.high_water;
      if (!time(value)) throw new Error('Storage unavailable');
      return value;
    },
    listRecent(input: {
      identityKey: string;
      libraries: readonly string[];
      from: number;
      to: number;
      asOf: number;
      highWater: number;
      limit: number;
      before?: { at: number; id: string };
    }) {
      const query = db.prepare(recentDownloadQuery);
      // A bounded range seek per authorized library avoids a whole-library merge scan.
      return input.libraries
        .flatMap((libraryId) =>
          query
            .all(
              input.identityKey,
              libraryId,
              input.from,
              input.to,
              input.asOf,
              input.highWater,
              input.before?.at ?? null,
              input.before?.at ?? null,
              input.before?.id ?? null,
              input.limit,
            )
            .map((row) => {
              if (!nullableText(row.media_link_id)) throw new Error('Storage unavailable');
              return { ...decodeEvent(row)!, mediaLinkId: row.media_link_id };
            }),
        )
        .sort(
          (a, b) =>
            b.downloadCompletedAt - a.downloadCompletedAt ||
            Buffer.compare(Buffer.from(b.id), Buffer.from(a.id)),
        )
        .slice(0, input.limit);
    },
    getDownloadEvent(id: string) {
      if (!text(id)) throw new Error('Invalid download event');
      return decodeEvent(db.prepare('SELECT * FROM download_events WHERE id=?').get(id));
    },
  };
}
