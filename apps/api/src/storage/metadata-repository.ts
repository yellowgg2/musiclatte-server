import type { DatabaseSync } from 'node:sqlite';
import {
  decodeMetadataItem,
  metadataFields,
  metadataStages,
  metadataErrorCodes,
  type MetadataField,
  type MetadataPatch,
  type MetadataJob,
  type MetadataItem,
  type MetadataStage,
  type MetadataErrorCode,
} from '@musiclatte/contracts';
import type { ManagementDatabase } from './database.js';
import { decodeMetadataReferences, type MetadataReferences } from '../metadata/reference-check.js';

export interface ValidatedMetadataItem {
  id: string;
  mediaLinkId: string;
  fileIdentity: string;
  bindingRevision: number;
  trackId: string;
  expectedRevision: string;
  expectedDigest: string;
  actorSessionId: string | null;
  actorTokenId?: string;
  encryptedJobGrant?: string;
  grantEpoch?: string;
  policyRevision: number;
  patch: MetadataPatch;
}
export interface ValidatedMetadataRequest {
  id: string;
  identityKey: string;
  libraryId: string;
  operationIdHash: string;
  requestHash: string;
  items: ValidatedMetadataItem[];
  sourceReference?: string;
  usageBasis?: string;
}
export interface MetadataClaim {
  itemId: string;
  workerId: string;
  generation: number;
  stage: MetadataStage;
  recovering: boolean;
}
export interface FencedMetadataTransition extends Omit<MetadataClaim, 'stage' | 'recovering'> {
  stage: MetadataStage;
  errorCode?: MetadataErrorCode;
  resultRevision?: string;
  resultDigest?: string;
  candidateKey?: string;
  currentTrackId?: string;
}
const text = (value: unknown): string => {
  if (typeof value !== 'string' || !value.length) throw new Error('Storage unavailable');
  return value;
};
const integer = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Storage unavailable');
  return value;
};
const nullableText = (value: unknown) => (value === null ? null : text(value));
const nullableTime = (value: unknown) => (value === null ? null : integer(value));
const terminal = new Set<MetadataStage>(['succeeded', 'failed', 'conflict', 'recovery_required']);
const next: Partial<Record<MetadataStage, MetadataStage>> = {
  queued: 'preparing',
  preparing: 'backed_up',
  backed_up: 'prepared',
  prepared: 'file_saved',
  file_saved: 'reflecting',
  reflecting: 'succeeded',
};
const hex = (value: string) => /^[a-f0-9]{64}$/.test(value);

function publicItem(row: Record<string, unknown>, hasBackup: boolean): MetadataItem {
  const stage = text(row.stage) as MetadataStage;
  const errorCode = nullableText(row.error_code) as MetadataErrorCode | null;
  const fields: unknown = JSON.parse(text(row.changed_fields_json));
  if (
    !metadataStages.includes(stage) ||
    (errorCode !== null && !metadataErrorCodes.includes(errorCode)) ||
    !Array.isArray(fields) ||
    fields.some((field) => !metadataFields.includes(field))
  )
    throw new Error('Storage unavailable');
  const saved = nullableTime(row.file_saved_at);
  return {
    itemId: text(row.id),
    originalTrackId: text(row.original_track_id),
    currentTrackId: text(row.current_track_id),
    stage,
    fileSavedAt: saved,
    reflectedAt: nullableTime(row.reflected_at),
    previousRevision: text(row.expected_revision),
    resultRevision: nullableText(row.result_revision),
    changedFields: fields as MetadataField[],
    errorCode,
    recoveryActions:
      stage === 'conflict'
        ? ['refresh']
        : stage === 'failed' && saved === null
          ? ['retry']
          : stage === 'file_saved' || stage === 'reflecting'
            ? ['recheck', ...(hasBackup ? ['restore' as const] : [])]
            : hasBackup && saved !== null
              ? ['restore']
              : [],
    restoreAvailable: hasBackup && saved !== null,
  };
}
function summary(items: MetadataItem[]): MetadataJob['status'] {
  if (items.every((item) => item.stage === 'queued')) return 'queued';
  if (items.some((item) => ['preparing', 'backed_up', 'prepared', 'queued'].includes(item.stage)))
    return 'running';
  if (items.some((item) => ['file_saved', 'reflecting'].includes(item.stage))) return 'reflecting';
  if (items.every((item) => item.stage === 'succeeded')) return 'succeeded';
  return items.some((item) => item.stage === 'succeeded') ? 'partial' : 'failed';
}

/** Snapshot verification checks relationships that foreign keys alone cannot express. */
export function validateMetadataStorage(db: DatabaseSync): void {
  const invalid = () => {
    throw new Error('Storage unavailable');
  };
  for (const row of db
    .prepare(
      'SELECT r.*,j.identity_key AS job_identity FROM metadata_rechecks r JOIN metadata_jobs j ON j.id=r.job_id',
    )
    .iterate()) {
    if (
      row.identity_key !== row.job_identity ||
      !hex(text(row.identity_key)) ||
      !hex(text(row.operation_id_hash)) ||
      !hex(text(row.request_hash))
    )
      invalid();
  }
  for (const row of db
    .prepare(
      'SELECT e.*,i.original_track_id FROM metadata_item_evidence e JOIN metadata_items i ON i.id=e.item_id',
    )
    .iterate()) {
    const value = decodeMetadataReferences(JSON.parse(text(row.references_json)));
    if (
      value.trackId !== row.original_track_id ||
      Buffer.byteLength(text(row.references_json)) > 1024 * 1024
    )
      invalid();
    if (row.reflection_json !== null && Buffer.byteLength(text(row.reflection_json)) > 65536)
      invalid();
  }
  for (const row of db
    .prepare(
      'SELECT i.*,j.identity_key,j.library_id,j.kind FROM metadata_items i JOIN metadata_jobs j ON j.id=i.job_id',
    )
    .iterate()) {
    const backup = db.prepare('SELECT * FROM metadata_backups WHERE item_id=?').get(text(row.id));
    decodeMetadataItem(publicItem(row, !!backup));
    if ((row.actor_session_id === null) === (row.actor_token_id === null)) invalid();
    const link = db
      .prepare('SELECT library_id FROM media_links WHERE id=?')
      .get(text(row.media_link_id));
    if (
      !link ||
      link.library_id !== row.library_id ||
      !hex(text(row.file_identity)) ||
      !hex(text(row.expected_digest)) ||
      (row.result_digest !== null && !hex(text(row.result_digest)))
    )
      invalid();
    const patch: unknown = JSON.parse(text(row.patch_json));
    if (
      !patch ||
      typeof patch !== 'object' ||
      Array.isArray(patch) ||
      Object.keys(patch).some((field) => !metadataFields.includes(field as MetadataField)) ||
      (!Object.keys(patch).length && row.kind !== 'restore')
    )
      invalid();
    if (
      ['backed_up', 'prepared', 'file_saved', 'reflecting', 'succeeded'].includes(
        text(row.stage),
      ) &&
      !backup
    )
      invalid();
    if (
      backup &&
      (backup.identity_key !== row.identity_key ||
        backup.library_id !== row.library_id ||
        backup.preimage_digest !== row.expected_digest)
    )
      invalid();
    if (row.parent_item_id !== null) {
      const parent = db
        .prepare(
          'SELECT i.*,j.identity_key,j.library_id FROM metadata_items i JOIN metadata_jobs j ON j.id=i.job_id WHERE i.id=?',
        )
        .get(text(row.parent_item_id));
      if (
        !parent ||
        parent.identity_key !== row.identity_key ||
        parent.library_id !== row.library_id ||
        parent.media_link_id !== row.media_link_id
      )
        invalid();
    }
    if (row.restore_backup_id !== null) {
      const source = db
        .prepare('SELECT * FROM metadata_backups WHERE id=?')
        .get(text(row.restore_backup_id));
      if (
        !source ||
        source.identity_key !== row.identity_key ||
        source.library_id !== row.library_id ||
        source.item_id !== row.parent_item_id ||
        row.kind !== 'restore'
      )
        invalid();
    }
    if ((row.kind === 'restore') !== (row.restore_backup_id !== null)) invalid();
  }
  for (const row of db
    .prepare(
      'SELECT l.*,i.generation AS item_generation,i.file_identity AS item_file_identity,i.stage FROM metadata_file_locks l JOIN metadata_items i ON i.id=l.item_id',
    )
    .iterate()) {
    if (
      row.generation !== row.item_generation ||
      row.file_identity !== row.item_file_identity ||
      terminal.has(text(row.stage) as MetadataStage)
    )
      invalid();
    const attempt = db
      .prepare('SELECT owner,finished_at FROM metadata_attempts WHERE item_id=? AND generation=?')
      .get(text(row.item_id), integer(row.generation));
    if (!attempt || attempt.owner !== row.owner || attempt.finished_at !== null) invalid();
  }
  for (const row of db
    .prepare(
      'SELECT j.*,count(i.id) AS item_count FROM metadata_jobs j LEFT JOIN metadata_items i ON i.job_id=j.id GROUP BY j.id',
    )
    .iterate()) {
    if (
      !hex(text(row.identity_key)) ||
      !hex(text(row.operation_id_hash)) ||
      !hex(text(row.request_hash)) ||
      integer(row.item_count) < 1 ||
      integer(row.item_count) > 100
    )
      invalid();
  }
  for (const row of db.prepare('SELECT * FROM metadata_backups').iterate()) {
    const profile: unknown = JSON.parse(text(row.owner_profile_json));
    if (!profile || typeof profile !== 'object' || !('uid' in profile) || !('gid' in profile))
      invalid();
    else {
      integer(profile.uid);
      integer(profile.gid);
    }
    if (!hex(text(row.preimage_digest))) invalid();
  }
}

/** Database claims fence cooperative workers; S04 additionally holds an OS lock during file I/O. */
export function createMetadataRepository({
  database,
  clock,
}: {
  database: ManagementDatabase;
  clock: () => number;
}) {
  const db = database.connection;
  const now = () => integer(clock());
  const readItem = (id: string) => db.prepare('SELECT * FROM metadata_items WHERE id=?').get(id);
  const project = (row: Record<string, unknown>) =>
    publicItem(
      row,
      !!db.prepare('SELECT id FROM metadata_backups WHERE item_id=?').get(text(row.id)),
    );
  const readJob = (id: string, identityKey: string): MetadataJob | null => {
    const row = db
      .prepare('SELECT * FROM metadata_jobs WHERE id=? AND identity_key=?')
      .get(id, identityKey);
    if (!row) return null;
    const items = db
      .prepare('SELECT * FROM metadata_items WHERE job_id=? ORDER BY item_order')
      .all(id)
      .map(project);
    const kind = text(row.kind);
    if (!['edit', 'retry', 'restore'].includes(kind) || !items.length)
      throw new Error('Storage unavailable');
    return {
      id: text(row.id),
      libraryId: text(row.library_id),
      createdAt: integer(row.created_at),
      status: summary(items),
      kind: kind as MetadataJob['kind'],
      parentJobId: nullableText(row.parent_job_id),
      items,
    };
  };
  function insert(
    input: ValidatedMetadataRequest,
    lineage?: {
      kind: 'retry' | 'restore';
      jobId: string;
      parents: Map<string, { itemId: string; backupId?: string }>;
    },
  ): MetadataJob {
    if (
      ![input.identityKey, input.operationIdHash, input.requestHash].every(hex) ||
      !input.items.length ||
      input.items.length > 100
    )
      throw new Error('Invalid metadata request');
    const replay = db
      .prepare(
        'SELECT id,request_hash FROM metadata_jobs WHERE identity_key=? AND operation_id_hash=?',
      )
      .get(input.identityKey, input.operationIdHash);
    if (
      db
        .prepare('SELECT 1 FROM metadata_rechecks WHERE identity_key=? AND operation_id_hash=?')
        .get(input.identityKey, input.operationIdHash)
    )
      throw new Error('conflict');
    if (replay) {
      if (replay.request_hash !== input.requestHash) throw new Error('conflict');
      return readJob(text(replay.id), input.identityKey)!;
    }
    const timestamp = now();
    db.prepare(
      'INSERT INTO metadata_jobs(id,identity_key,library_id,operation_id_hash,request_hash,kind,parent_job_id,source_reference,usage_basis,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    ).run(
      input.id,
      input.identityKey,
      input.libraryId,
      input.operationIdHash,
      input.requestHash,
      lineage?.kind ?? 'edit',
      lineage?.jobId ?? null,
      input.sourceReference ?? null,
      input.usageBasis ?? null,
      timestamp,
    );
    for (const [order, item] of input.items.entries()) {
      if (lineage?.kind === 'restore' && item.actorTokenId) throw new Error('conflict');
      const link = db
        .prepare('SELECT library_id,revision,gonic_song_id FROM media_links WHERE id=?')
        .get(item.mediaLinkId);
      const session = item.actorSessionId
        ? db
            .prepare('SELECT policy_revision FROM sessions WHERE id_hash=?')
            .get(item.actorSessionId)
        : db
            .prepare(
              'SELECT policy_revision FROM access_tokens WHERE id=? AND revoked_at IS NULL AND expires_at>? AND created_at<=?',
            )
            .get(item.actorTokenId ?? '', timestamp, timestamp);
      if (
        item.actorSessionId === null &&
        (!item.actorTokenId ||
          !item.encryptedJobGrant ||
          item.grantEpoch !==
            db.prepare('SELECT credential_epoch FROM automation_state WHERE singleton=1').get()
              ?.credential_epoch)
      )
        throw new Error('conflict');
      if (item.actorSessionId !== null && item.actorTokenId) throw new Error('conflict');
      if (
        !link ||
        link.library_id !== input.libraryId ||
        link.revision !== item.bindingRevision ||
        link.gonic_song_id !== item.trackId ||
        !session ||
        session.policy_revision !== item.policyRevision ||
        !hex(item.fileIdentity) ||
        !hex(item.expectedDigest)
      )
        throw new Error('conflict');
      // Session editor requests cannot steal an active automation reservation.
      if (
        item.actorSessionId &&
        db
          .prepare(
            'SELECT 1 FROM curation_claim_items i JOIN curation_claims c ON c.id=i.claim_id JOIN curation_state s ON s.claim_epoch=c.claim_epoch WHERE i.file_identity=? AND c.released_at IS NULL AND c.created_at<=? AND c.lease_until>? LIMIT 1',
          )
          .get(item.fileIdentity, timestamp, timestamp)
      )
        throw new Error('conflict');
      const changedFields = Object.keys(item.patch);
      if (item.patch.cover?.op === 'set') {
        const uploadId = item.patch.cover.uploadId;
        const upload = db
          .prepare(
            'SELECT expires_at FROM metadata_cover_uploads WHERE id=? AND identity_key=? AND library_id=? AND actor_token_id IS ?',
          )
          .get(uploadId, input.identityKey, input.libraryId, item.actorTokenId ?? null);
        if (
          !upload ||
          (integer(upload.expires_at) <= timestamp &&
            !db
              .prepare(
                "SELECT 1 FROM metadata_items WHERE json_extract(patch_json,'$.cover.uploadId')=? LIMIT 1",
              )
              .get(uploadId))
        )
          throw new Error('conflict');
      }
      if (
        (!changedFields.length && lineage?.kind !== 'restore') ||
        changedFields.some((field) => !metadataFields.includes(field as MetadataField))
      )
        throw new Error('Invalid metadata request');
      const parent = lineage?.parents.get(item.id);
      db.prepare(
        "INSERT INTO metadata_items(id,job_id,item_order,media_link_id,file_identity,binding_revision,original_track_id,current_track_id,expected_revision,expected_digest,patch_json,actor_session_id,actor_token_id,encrypted_job_grant,grant_epoch,policy_revision,parent_item_id,restore_backup_id,stage,stage_changed_at,changed_fields_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'queued',?,?)",
      ).run(
        item.id,
        input.id,
        order,
        item.mediaLinkId,
        item.fileIdentity,
        item.bindingRevision,
        item.trackId,
        item.trackId,
        item.expectedRevision,
        item.expectedDigest,
        JSON.stringify(item.patch),
        item.actorSessionId,
        item.actorTokenId ?? null,
        item.encryptedJobGrant ?? null,
        item.grantEpoch ?? null,
        item.policyRevision,
        parent?.itemId ?? null,
        parent?.backupId ?? null,
        timestamp,
        JSON.stringify(changedFields),
      );
    }
    return readJob(input.id, input.identityKey)!;
  }
  const owned = (claim: Pick<MetadataClaim, 'itemId' | 'workerId' | 'generation'>) => {
    const row = readItem(claim.itemId);
    const lock = db.prepare('SELECT * FROM metadata_file_locks WHERE item_id=?').get(claim.itemId);
    if (
      !row ||
      !lock ||
      lock.owner !== claim.workerId ||
      lock.generation !== claim.generation ||
      row.generation !== claim.generation ||
      integer(lock.expires_at) <= now()
    )
      throw new Error('conflict');
    return row;
  };
  return {
    getJob: readJob,
    recheck(input: {
      identityKey: string;
      operationIdHash: string;
      requestHash: string;
      jobId: string;
      itemIds: string[];
      actorSessionId?: string;
      policyRevision?: number;
    }) {
      return database.transaction(() => {
        const job = readJob(input.jobId, input.identityKey);
        if (!job) throw new Error('conflict');
        if (
          db
            .prepare('SELECT 1 FROM metadata_jobs WHERE identity_key=? AND operation_id_hash=?')
            .get(input.identityKey, input.operationIdHash)
        )
          throw new Error('conflict');
        const replay = db
          .prepare(
            'SELECT request_hash,job_id FROM metadata_rechecks WHERE identity_key=? AND operation_id_hash=?',
          )
          .get(input.identityKey, input.operationIdHash);
        if (replay) {
          if (replay.request_hash !== input.requestHash || replay.job_id !== input.jobId)
            throw new Error('conflict');
          return job;
        }
        if (
          !input.itemIds.length ||
          new Set(input.itemIds).size !== input.itemIds.length ||
          input.itemIds.some(
            (id) =>
              !job.items.some(
                (entry) =>
                  entry.itemId === id && ['file_saved', 'reflecting'].includes(entry.stage),
              ),
          )
        )
          throw new Error('conflict');
        const at = now();
        if (
          input.actorSessionId &&
          (!input.policyRevision ||
            !db
              .prepare(
                'SELECT 1 FROM sessions WHERE id_hash=? AND policy_revision=? AND revoked_at IS NULL',
              )
              .get(input.actorSessionId, input.policyRevision))
        )
          throw new Error('conflict');
        db.prepare(
          'INSERT INTO metadata_rechecks(identity_key,operation_id_hash,request_hash,job_id,created_at) VALUES(?,?,?,?,?)',
        ).run(input.identityKey, input.operationIdHash, input.requestHash, input.jobId, at);
        for (const id of input.itemIds) {
          // An active reflector owns its lease until it exits; a user recheck never steals it.
          db.prepare('UPDATE metadata_items SET next_reflection_at=0 WHERE id=?').run(id);
          if (input.actorSessionId)
            db.prepare(
              'UPDATE metadata_items SET actor_session_id=?,policy_revision=? WHERE id=? AND actor_token_id IS NULL',
            ).run(input.actorSessionId, input.policyRevision!, id);
        }
        return job;
      });
    },
    hasSavedSuccessor(claim: MetadataClaim, digest: string): boolean {
      const row = owned(claim);
      return !!db
        .prepare(
          'SELECT 1 FROM metadata_items WHERE id<>? AND file_identity=? AND result_digest=? AND file_saved_at IS NOT NULL AND file_saved_at>=?',
        )
        .get(claim.itemId, text(row.file_identity), digest, integer(row.file_saved_at));
    },
    deferReflection(claim: MetadataClaim, delayMs: number) {
      database.transaction(() => {
        const row = owned(claim);
        if (
          !['file_saved', 'reflecting'].includes(String(row.stage)) ||
          !Number.isSafeInteger(delayMs) ||
          delayMs < 1
        )
          throw new Error('conflict');
        const at = now();
        db.prepare('UPDATE metadata_items SET next_reflection_at=? WHERE id=?').run(
          at + delayMs,
          claim.itemId,
        );
        db.prepare(
          'UPDATE metadata_attempts SET finished_at=?,error_code=? WHERE item_id=? AND generation=?',
        ).run(at, row.error_code ?? null, claim.itemId, claim.generation);
        db.prepare('DELETE FROM metadata_file_locks WHERE item_id=?').run(claim.itemId);
      });
    },
    requestReflectionRetry(itemId: string, identityKey: string): MetadataItem {
      return database.transaction(() => {
        const row = db
          .prepare(
            'SELECT i.* FROM metadata_items i JOIN metadata_jobs j ON j.id=i.job_id WHERE i.id=? AND j.identity_key=?',
          )
          .get(itemId, identityKey);
        if (!row || !['file_saved', 'reflecting'].includes(String(row.stage)))
          throw new Error('conflict');
        db.prepare('UPDATE metadata_file_locks SET expires_at=? WHERE item_id=?').run(
          now(),
          itemId,
        );
        db.prepare('UPDATE metadata_items SET next_reflection_at=0 WHERE id=?').run(itemId);
        return project(row);
      });
    },
    recordReferences(claim: MetadataClaim, references: MetadataReferences) {
      database.transaction(() => {
        const item = owned(claim);
        if (item.stage !== 'preparing' || references.trackId !== item.current_track_id)
          throw new Error('conflict');
        const encoded = JSON.stringify(decodeMetadataReferences(references));
        if (Buffer.byteLength(encoded) > 1024 * 1024) throw new Error('reference_conflict');
        db.prepare(
          'INSERT INTO metadata_item_evidence(item_id,references_json,updated_at) VALUES(?,?,?) ON CONFLICT(item_id) DO NOTHING',
        ).run(claim.itemId, encoded, now());
      });
    },
    readReferences(claim: MetadataClaim): MetadataReferences | null {
      owned(claim);
      const row = db
        .prepare('SELECT references_json FROM metadata_item_evidence WHERE item_id=?')
        .get(claim.itemId);
      return row ? decodeMetadataReferences(JSON.parse(text(row.references_json))) : null;
    },
    recordReflection(
      claim: MetadataClaim,
      input: {
        status:
          'verified' | 'reflection_mismatch' | 'reference_conflict' | 'reflection_unavailable';
        evidence: Record<string, unknown>;
        relatedIds: {
          trackIds: string[];
          albumIds: string[];
          artistIds: string[];
          coverIds: string[];
        };
      },
    ) {
      return database.transaction(() => {
        const row = owned(claim);
        if (row.stage !== 'reflecting' || row.file_saved_at === null) throw new Error('conflict');
        const timestamp = now();
        db.prepare(
          'UPDATE metadata_item_evidence SET reflection_json=?,updated_at=? WHERE item_id=?',
        ).run(JSON.stringify(input.evidence), timestamp, claim.itemId);
        if (input.status === 'verified') {
          db.prepare(
            "UPDATE metadata_items SET stage='succeeded',error_code=NULL,stage_changed_at=?,reflected_at=? WHERE id=?",
          ).run(timestamp, timestamp, claim.itemId);
          db.prepare(
            'UPDATE metadata_attempts SET finished_at=?,error_code=NULL WHERE item_id=? AND generation=?',
          ).run(timestamp, claim.itemId, claim.generation);
          db.prepare('DELETE FROM metadata_file_locks WHERE item_id=?').run(claim.itemId);
        } else
          db.prepare('UPDATE metadata_items SET error_code=?,stage_changed_at=? WHERE id=?').run(
            input.status,
            timestamp,
            claim.itemId,
          );
        if (input.status !== 'reflection_unavailable') {
          const job = db.prepare('SELECT * FROM metadata_jobs WHERE id=?').get(text(row.job_id))!;
          db.prepare(
            'INSERT INTO metadata_changes(item_id,media_link_id,identity_key,library_id,old_revision,new_revision,related_ids_json,cover_generation,changed_fields_json,reflection_result,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET sequence=excluded.sequence,reflection_result=excluded.reflection_result,related_ids_json=excluded.related_ids_json WHERE metadata_changes.reflection_result<>excluded.reflection_result OR metadata_changes.related_ids_json<>excluded.related_ids_json',
          ).run(
            claim.itemId,
            text(row.media_link_id),
            text(job.identity_key),
            text(job.library_id),
            text(row.expected_revision),
            text(row.result_revision),
            JSON.stringify(input.relatedIds),
            text(row.result_revision),
            text(row.changed_fields_json),
            input.status,
            timestamp,
          );
        }
        return project(readItem(claim.itemId)!);
      });
    },
    assertClaim(claim: Pick<MetadataClaim, 'itemId' | 'workerId' | 'generation'>) {
      owned(claim);
    },
    renewClaim(
      claim: Pick<MetadataClaim, 'itemId' | 'workerId' | 'generation'>,
      leaseDurationMs: number,
    ) {
      if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1)
        throw new Error('conflict');
      database.transaction(() => {
        owned(claim);
        db.prepare('UPDATE metadata_file_locks SET expires_at=? WHERE item_id=?').run(
          now() + leaseDurationMs,
          claim.itemId,
        );
      });
    },
    readWork(claim: Pick<MetadataClaim, 'itemId' | 'workerId' | 'generation'>) {
      const row = owned(claim);
      const job = db.prepare('SELECT * FROM metadata_jobs WHERE id=?').get(text(row.job_id))!;
      const link = db.prepare('SELECT * FROM media_links WHERE id=?').get(text(row.media_link_id))!;
      const restore =
        row.restore_backup_id === null
          ? null
          : db
              .prepare(
                'SELECT * FROM metadata_backups WHERE id=? AND identity_key=? AND library_id=?',
              )
              .get(text(row.restore_backup_id), text(job.identity_key), text(job.library_id));
      if (row.restore_backup_id !== null && !restore) throw new Error('restore_unavailable');
      return {
        itemId: text(row.id),
        jobId: text(row.job_id),
        identityKey: text(job.identity_key),
        libraryId: text(job.library_id),
        mediaLinkId: text(row.media_link_id),
        bindingRevision: integer(row.binding_revision),
        currentBindingRevision: integer(link.revision),
        key: text(link.relative_file_key),
        trackId: text(row.current_track_id),
        fileIdentity: text(row.file_identity),
        expectedRevision: text(row.expected_revision),
        expectedDigest: text(row.expected_digest),
        actorSessionId: nullableText(row.actor_session_id),
        actorTokenId: nullableText(row.actor_token_id),
        originalTrackId: text(row.original_track_id),
        policyRevision: integer(row.policy_revision),
        patch: JSON.parse(text(row.patch_json)) as MetadataPatch,
        stage: text(row.stage) as MetadataStage,
        resultDigest: nullableText(row.result_digest),
        resultRevision: nullableText(row.result_revision),
        restore: restore
          ? { relativeKey: text(restore.relative_key), digest: text(restore.preimage_digest) }
          : null,
      };
    },
    createOrReplay(input: ValidatedMetadataRequest) {
      return database.transaction(() => insert(input));
    },
    recordBackup(
      input: Pick<MetadataClaim, 'itemId' | 'workerId' | 'generation'> & {
        backup: {
          id: string;
          relativeKey: string;
          preimageDigest: string;
          size: number;
          mode: number;
          ownerProfile: { uid: number; gid: number };
        };
      },
    ) {
      return database.transaction(() => {
        const row = owned(input);
        if (row.stage !== 'preparing' || row.expected_digest !== input.backup.preimageDigest)
          throw new Error('conflict');
        const job = db
          .prepare('SELECT identity_key,library_id FROM metadata_jobs WHERE id=?')
          .get(text(row.job_id))!;
        const existing = db
          .prepare('SELECT * FROM metadata_backups WHERE item_id=?')
          .get(input.itemId);
        const backup = input.backup;
        if (existing) {
          if (
            existing.id !== backup.id ||
            existing.relative_key !== backup.relativeKey ||
            existing.preimage_digest !== backup.preimageDigest ||
            existing.size !== backup.size ||
            existing.mode !== backup.mode ||
            existing.owner_profile_json !== JSON.stringify(backup.ownerProfile)
          )
            throw new Error('conflict');
          return;
        }
        db.prepare(
          'INSERT INTO metadata_backups(id,item_id,identity_key,library_id,relative_key,preimage_digest,size,mode,owner_profile_json,parent_backup_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        ).run(
          backup.id,
          input.itemId,
          text(job.identity_key),
          text(job.library_id),
          backup.relativeKey,
          backup.preimageDigest,
          backup.size,
          backup.mode,
          JSON.stringify(backup.ownerProfile),
          nullableText(row.restore_backup_id),
          now(),
        );
      });
    },
    createRestore(input: {
      request: ValidatedMetadataRequest;
      parentJobId: string;
      itemId: string;
    }) {
      return database.transaction(() => {
        const replay = db
          .prepare(
            'SELECT id,request_hash,kind,parent_job_id FROM metadata_jobs WHERE identity_key=? AND operation_id_hash=?',
          )
          .get(input.request.identityKey, input.request.operationIdHash);
        if (replay) {
          if (
            replay.request_hash !== input.request.requestHash ||
            replay.kind !== 'restore' ||
            replay.parent_job_id !== input.parentJobId
          )
            throw new Error('conflict');
          return readJob(text(replay.id), input.request.identityKey)!;
        }
        const parent = readJob(input.parentJobId, input.request.identityKey);
        const row = readItem(input.itemId);
        const backup = db
          .prepare(
            'SELECT * FROM metadata_backups WHERE item_id=? AND identity_key=? AND library_id=?',
          )
          .get(input.itemId, input.request.identityKey, input.request.libraryId);
        const item = input.request.items[0];
        if (
          !parent ||
          !row ||
          !backup ||
          !item ||
          input.request.items.length !== 1 ||
          row.job_id !== parent.id ||
          row.file_saved_at === null ||
          row.media_link_id !== item.mediaLinkId ||
          row.file_identity !== item.fileIdentity ||
          parent.libraryId !== input.request.libraryId
        )
          throw new Error('conflict');
        return insert(input.request, {
          kind: 'restore',
          jobId: parent.id,
          parents: new Map([[item.id, { itemId: input.itemId, backupId: text(backup.id) }]]),
        });
      });
    },
    retryFailed(input: {
      request: ValidatedMetadataRequest;
      parentJobId: string;
      itemIds: string[];
    }) {
      return database.transaction(() => {
        const replay = db
          .prepare(
            'SELECT id,request_hash,kind,parent_job_id FROM metadata_jobs WHERE identity_key=? AND operation_id_hash=?',
          )
          .get(input.request.identityKey, input.request.operationIdHash);
        if (replay) {
          if (
            replay.request_hash !== input.request.requestHash ||
            replay.kind !== 'retry' ||
            replay.parent_job_id !== input.parentJobId
          )
            throw new Error('conflict');
          return readJob(text(replay.id), input.request.identityKey)!;
        }
        const parent = readJob(input.parentJobId, input.request.identityKey);
        if (
          !parent ||
          parent.libraryId !== input.request.libraryId ||
          input.itemIds.length !== input.request.items.length ||
          new Set(input.itemIds).size !== input.itemIds.length
        )
          throw new Error('conflict');
        const parents = new Map<string, { itemId: string }>();
        for (const [index, itemId] of input.itemIds.entries()) {
          const old = readItem(itemId);
          const item = input.request.items[index];
          if (
            !old ||
            !item ||
            old.job_id !== parent.id ||
            !['failed', 'conflict'].includes(String(old.stage)) ||
            old.file_saved_at !== null ||
            old.media_link_id !== item.mediaLinkId ||
            old.file_identity !== item.fileIdentity
          )
            throw new Error('conflict');
          parents.set(item.id, { itemId });
        }
        return insert(input.request, { kind: 'retry', jobId: parent.id, parents });
      });
    },
    claimNext(input: {
      workerId: string;
      leaseDurationMs: number;
      reflectionOnly?: boolean;
      recoveryOnly?: boolean;
      fileOnly?: boolean;
    }): MetadataClaim | null {
      if (
        !input.workerId ||
        !Number.isSafeInteger(input.leaseDurationMs) ||
        input.leaseDurationMs < 1
      )
        throw new Error('Invalid claim');
      return database.transaction(() => {
        const timestamp = now();
        const row = db
          .prepare(
            `SELECT i.* FROM metadata_items i LEFT JOIN metadata_file_locks l ON l.file_identity=i.file_identity WHERE i.stage IN ('queued','preparing','backed_up','prepared','file_saved','reflecting') AND (?=0 OR i.stage IN ('file_saved','reflecting')) AND (i.stage NOT IN ('file_saved','reflecting') OR i.next_reflection_at<=?) AND (?=0 OR i.stage IN ('preparing','backed_up','prepared')) AND (?=0 OR i.stage NOT IN ('file_saved','reflecting')) AND NOT EXISTS (SELECT 1 FROM metadata_items blocked WHERE blocked.file_identity=i.file_identity AND blocked.stage='recovery_required') AND (l.file_identity IS NULL OR (l.item_id=i.id AND l.expires_at<=?)) ORDER BY CASE WHEN i.stage='queued' THEN 1 ELSE 0 END,i.stage_changed_at,i.id LIMIT 1`,
          )
          .get(
            input.reflectionOnly ? 1 : 0,
            timestamp,
            input.recoveryOnly ? 1 : 0,
            input.fileOnly ? 1 : 0,
            timestamp,
          );
        if (!row) return null;
        const itemId = text(row.id);
        const generation = integer(row.generation) + 1;
        const stage = row.stage === 'queued' ? 'preparing' : (text(row.stage) as MetadataStage);
        db.prepare(
          "UPDATE metadata_attempts SET finished_at=?,error_code='worker_interrupted' WHERE item_id=? AND finished_at IS NULL",
        ).run(timestamp, itemId);
        db.prepare(
          'INSERT INTO metadata_file_locks(file_identity,item_id,owner,generation,expires_at) VALUES(?,?,?,?,?) ON CONFLICT(file_identity) DO UPDATE SET item_id=excluded.item_id,owner=excluded.owner,generation=excluded.generation,expires_at=excluded.expires_at',
        ).run(
          text(row.file_identity),
          itemId,
          input.workerId,
          generation,
          timestamp + input.leaseDurationMs,
        );
        db.prepare(
          'UPDATE metadata_items SET generation=?,stage=?,stage_changed_at=? WHERE id=?',
        ).run(generation, stage, timestamp, itemId);
        db.prepare(
          'INSERT INTO metadata_attempts(item_id,generation,owner,started_at) VALUES(?,?,?,?)',
        ).run(itemId, generation, input.workerId, timestamp);
        return {
          itemId,
          workerId: input.workerId,
          generation,
          stage,
          recovering: row.stage !== 'queued',
        };
      });
    },
    transition(input: FencedMetadataTransition): MetadataItem {
      return database.transaction(() => {
        const row = owned(input);
        const previous = text(row.stage) as MetadataStage;
        if (
          terminal.has(previous) ||
          (next[previous] !== input.stage &&
            !['failed', 'conflict', 'recovery_required'].includes(input.stage)) ||
          (input.errorCode !== undefined && !metadataErrorCodes.includes(input.errorCode))
        )
          throw new Error('conflict');
        if (
          input.stage === 'backed_up' &&
          !db.prepare('SELECT id FROM metadata_backups WHERE item_id=?').get(input.itemId)
        )
          throw new Error('conflict');
        const timestamp = now();
        db.prepare(
          "UPDATE metadata_items SET stage=?,stage_changed_at=?,error_code=?,result_revision=COALESCE(?,result_revision),result_digest=COALESCE(?,result_digest),candidate_key=COALESCE(?,candidate_key),current_track_id=COALESCE(?,current_track_id),file_saved_at=CASE WHEN ?='file_saved' THEN ? ELSE file_saved_at END,reflected_at=CASE WHEN ?='succeeded' THEN ? ELSE reflected_at END WHERE id=?",
        ).run(
          input.stage,
          timestamp,
          input.errorCode ?? null,
          input.resultRevision ?? null,
          input.resultDigest ?? null,
          input.candidateKey ?? null,
          input.currentTrackId ?? null,
          input.stage,
          timestamp,
          input.stage,
          timestamp,
          input.itemId,
        );
        if (terminal.has(input.stage)) {
          db.prepare(
            'UPDATE metadata_attempts SET finished_at=?,error_code=? WHERE item_id=? AND generation=?',
          ).run(timestamp, input.errorCode ?? null, input.itemId, input.generation);
          db.prepare('DELETE FROM metadata_file_locks WHERE item_id=?').run(input.itemId);
        }
        return project(readItem(input.itemId)!);
      });
    },
  };
}
