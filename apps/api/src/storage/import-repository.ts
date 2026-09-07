import type { DatabaseSync } from 'node:sqlite';
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
}

export interface ImportJob {
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
    id: string;
    identityKey: string;
    libraryId: string;
    operationIdHash: string;
    requestHash: string;
    retryOfJobId?: string;
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
      'INSERT INTO import_jobs(id,identity_key,library_id,operation_id_hash,request_hash,retry_of_job_id,created_at,cancel_requested_at) VALUES(?,?,?,?,?,?,?,NULL)',
    ).run(
      input.id,
      input.identityKey,
      input.libraryId,
      input.operationIdHash,
      input.requestHash,
      input.retryOfJobId ?? null,
      createdAt,
    );
    const statement = db.prepare(
      "INSERT INTO import_items(id,job_id,item_order,source_id,stage,failure_code,attempt,lease_owner,lease_expires_at,engine_version,media_link_id,stage_changed_at) VALUES(?,?,?,?,'queued',NULL,0,NULL,NULL,NULL,NULL,?)",
    );
    input.items.forEach((item, index) =>
      statement.run(item.id, input.id, index, item.sourceId, createdAt),
    );
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
            'SELECT j.library_id AS job_library,m.library_id AS media_library FROM import_items i JOIN import_jobs j ON j.id=i.job_id JOIN media_links m ON m.id=? WHERE i.id=?',
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
        if (!readJob(jobId)) throw new Error('Import job not found');
        const cancelledAt = now();
        db.prepare(
          'UPDATE import_jobs SET cancel_requested_at=COALESCE(cancel_requested_at,?) WHERE id=?',
        ).run(cancelledAt, jobId);
        db.prepare(
          "UPDATE import_items SET stage='cancelled',stage_changed_at=?,lease_owner=NULL,lease_expires_at=NULL WHERE job_id=? AND stage IN ('queued','resolving','downloading','postprocessing')",
        ).run(cancelledAt, jobId);
        return readJob(jobId)!;
      });
    },
    retryFailed(input: {
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
          identityKey: source.identityKey,
          libraryId: source.libraryId,
          operationIdHash: input.operationIdHash,
          requestHash: input.requestHash,
          retryOfJobId: source.id,
          items: selected.map((item, index) => ({
            id: `${input.id}:${index}`,
            sourceId: item!.sourceId,
          })),
        });
      });
    },
    getDownloadEvent(id: string) {
      if (!text(id)) throw new Error('Invalid download event');
      return decodeEvent(db.prepare('SELECT * FROM download_events WHERE id=?').get(id));
    },
  };
}
