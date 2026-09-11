import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import type { ManagementDatabase } from './database.js';
import { validateRelativeKey } from '../imports/policy.js';
import {
  advanceOrganizationState,
  conflictOrganizationState,
  failOrganizationState,
  organizationStages,
  type OrganizationRecoveryOwner,
  type OrganizationStage,
} from '../metadata/organization-state.js';

type Row = Record<string, SQLOutputValue>;
const hex = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = (value: unknown) => {
  if (typeof value !== 'string' || !value) throw new Error('Storage unavailable');
  return value;
};
const integer = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Storage unavailable');
  return value;
};

export interface OrganizationIntent {
  id: string;
  itemId: string;
  identityKey: string;
  libraryId: string;
  operationIdHash: string;
  requestHash: string;
  actorTokenId: string;
  policyRevision: number;
  policyVersion: 'id3-managed-v1';
  metadataJobId: string;
  metadataRevision: string;
  sourceEvidence: readonly { url: string; fields: readonly string[] }[];
  mediaLinkId: string;
  sourceKey: string;
  targetKey: string;
  oldTrackId: string;
  fileIdentity: string;
  audioIdentity: string;
  encryptedJobGrant: string;
  grantEpoch: string;
}

export interface OrganizationClaim {
  itemId: string;
  jobId: string;
  workerId: string;
  generation: number;
  stage: OrganizationStage;
  sourceKey: string;
  targetKey: string;
  fileIdentity: string;
  audioIdentity: string;
  oldTrackId: string;
  newTrackId: string | null;
}

function decodeItem(row: Row) {
  if (
    !organizationStages.includes(row.stage as OrganizationStage) ||
    !hex(row.file_identity) ||
    !hex(row.audio_identity)
  )
    throw new Error('Storage unavailable');
  return {
    itemId: text(row.id),
    jobId: text(row.job_id),
    stage: row.stage as OrganizationStage,
    sourceKey: text(row.source_key),
    targetKey: text(row.target_key),
    oldTrackId: text(row.old_track_id),
    newTrackId: row.new_track_id === null ? null : text(row.new_track_id),
    fileIdentity: text(row.file_identity),
    audioIdentity: text(row.audio_identity),
    generation: integer(row.generation),
    errorCode: row.error_code === null ? null : text(row.error_code),
    nextOwner: row.next_owner as OrganizationRecoveryOwner | null,
  };
}

export function validateOrganizationStorage(db: DatabaseSync): void {
  for (const raw of db
    .prepare(
      'SELECT i.*,j.identity_key,j.library_id,j.request_hash,j.source_evidence_json FROM organization_items i JOIN organization_jobs j ON j.id=i.job_id',
    )
    .iterate()) {
    const row = raw as Row;
    const item = decodeItem(row);
    if (!hex(row.identity_key) || !hex(row.request_hash)) throw new Error('Storage unavailable');
    validateRelativeKey(item.sourceKey);
    validateRelativeKey(item.targetKey);
    const evidence = JSON.parse(text(row.source_evidence_json)) as unknown;
    if (!Array.isArray(evidence) || Buffer.byteLength(text(row.source_evidence_json)) > 65536)
      throw new Error('Storage unavailable');
    if (row.baseline_json !== null && Buffer.byteLength(text(row.baseline_json)) > 1024 * 1024)
      throw new Error('Storage unavailable');
  }
  for (const raw of db.prepare('SELECT * FROM organization_reference_checkpoints').iterate()) {
    const row = raw as Row;
    if (
      !['playlist', 'star'].includes(text(row.kind)) ||
      !['pending', 'completed', 'conflict', 'failed'].includes(text(row.status)) ||
      Buffer.byteLength(text(row.baseline_json)) > 1024 * 1024 ||
      Buffer.byteLength(text(row.desired_json)) > 1024 * 1024
    )
      throw new Error('Storage unavailable');
  }
}

export function createOrganizationRepository(options: {
  database: ManagementDatabase;
  clock: () => number;
}) {
  const { database, clock } = options;
  const db = database.connection;
  const now = () => {
    const value = clock();
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid_time');
    return value;
  };
  const atomic = <T>(work: () => T): T => (db.isTransaction ? work() : database.transaction(work));
  const event = (itemId: string, kind: string, payload: unknown) =>
    db
      .prepare(
        'INSERT INTO organization_events(item_id,kind,payload_json,created_at) VALUES(?,?,?,?)',
      )
      .run(itemId, kind, JSON.stringify(payload), now());
  const rowFor = (itemId: string) =>
    db.prepare('SELECT * FROM organization_items WHERE id=?').get(itemId) as Row | undefined;
  const owned = (claim: Pick<OrganizationClaim, 'itemId' | 'workerId' | 'generation'>) => {
    const row = rowFor(claim.itemId);
    if (
      !row ||
      row.lease_owner !== claim.workerId ||
      row.generation !== claim.generation ||
      Number(row.lease_expires_at) <= now()
    )
      throw new Error('conflict');
    return row;
  };
  const readJob = (id: string, identityKey?: string) => {
    const job = db.prepare('SELECT * FROM organization_jobs WHERE id=?').get(id) as Row | undefined;
    if (!job || (identityKey && job.identity_key !== identityKey)) return null;
    const item = rowFor(
      text(db.prepare('SELECT id FROM organization_items WHERE job_id=?').get(id)?.id),
    );
    if (!item) throw new Error('Storage unavailable');
    return {
      id: text(job.id),
      identityKey: text(job.identity_key),
      libraryId: text(job.library_id),
      requestHash: text(job.request_hash),
      item: decodeItem(item),
    };
  };
  return {
    createOrReplay(input: OrganizationIntent) {
      return atomic(() => {
        const replay = db
          .prepare(
            'SELECT id,request_hash FROM organization_jobs WHERE identity_key=? AND operation_id_hash=?',
          )
          .get(input.identityKey, input.operationIdHash);
        if (replay) {
          if (replay.request_hash !== input.requestHash) throw new Error('conflict');
          return readJob(text(replay.id), input.identityKey)!;
        }
        if (
          !input.id ||
          !input.itemId ||
          !hex(input.identityKey) ||
          !hex(input.operationIdHash) ||
          !hex(input.requestHash) ||
          !hex(input.fileIdentity) ||
          !hex(input.audioIdentity) ||
          !hex(input.grantEpoch) ||
          input.policyVersion !== 'id3-managed-v1' ||
          !Number.isSafeInteger(input.policyRevision) ||
          input.policyRevision < 1 ||
          !Array.isArray(input.sourceEvidence) ||
          Buffer.byteLength(JSON.stringify(input.sourceEvidence)) > 65536
        )
          throw new Error('invalid_organization_intent');
        validateRelativeKey(input.sourceKey);
        validateRelativeKey(input.targetKey);
        const timestamp = now();
        db.prepare(
          'INSERT INTO organization_jobs(id,identity_key,library_id,operation_id_hash,request_hash,actor_token_id,policy_revision,policy_version,metadata_job_id,metadata_revision,source_evidence_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        ).run(
          input.id,
          input.identityKey,
          input.libraryId,
          input.operationIdHash,
          input.requestHash,
          input.actorTokenId,
          input.policyRevision,
          input.policyVersion,
          input.metadataJobId,
          input.metadataRevision,
          JSON.stringify(input.sourceEvidence),
          timestamp,
        );
        db.prepare(
          "INSERT INTO organization_items(id,job_id,media_link_id,source_key,target_key,old_track_id,file_identity,audio_identity,stage,encrypted_job_grant,grant_epoch,stage_changed_at) VALUES(?,?,?,?,?,?,?,?,'queued',?,?,?)",
        ).run(
          input.itemId,
          input.id,
          input.mediaLinkId,
          input.sourceKey,
          input.targetKey,
          input.oldTrackId,
          input.fileIdentity,
          input.audioIdentity,
          input.encryptedJobGrant,
          input.grantEpoch,
          timestamp,
        );
        event(input.itemId, 'accepted', {
          policyVersion: input.policyVersion,
          metadataRevision: input.metadataRevision,
        });
        return readJob(input.id, input.identityKey)!;
      });
    },
    getJob: readJob,
    claimNext(input: { workerId: string; leaseDurationMs: number; recoveryOnly?: boolean }) {
      return atomic(() => {
        if (
          !input.workerId ||
          !Number.isSafeInteger(input.leaseDurationMs) ||
          input.leaseDurationMs < 1
        )
          throw new Error('invalid_claim');
        const timestamp = now();
        const stages = input.recoveryOnly
          ? "stage='recovery_required'"
          : "stage NOT IN ('succeeded','failed','conflict','recovery_required')";
        const row = db
          .prepare(
            `SELECT * FROM organization_items WHERE ${stages} AND (lease_owner IS NULL OR lease_expires_at<=?) ORDER BY stage_changed_at,id LIMIT 1`,
          )
          .get(timestamp) as Row | undefined;
        if (!row) return null;
        const stage = row.stage === 'queued' ? 'validating' : String(row.stage);
        const generation = integer(row.generation) + 1;
        const leaseExpiresAt = timestamp + input.leaseDurationMs;
        db.prepare(
          'UPDATE organization_items SET stage=?,generation=?,lease_owner=?,lease_expires_at=?,stage_changed_at=? WHERE id=?',
        ).run(stage, generation, input.workerId, leaseExpiresAt, timestamp, text(row.id));
        db.prepare(
          'INSERT INTO organization_attempts(item_id,generation,owner,started_at) VALUES(?,?,?,?)',
        ).run(text(row.id), generation, input.workerId, timestamp);
        const claimed = decodeItem(rowFor(text(row.id))!);
        return { ...claimed, workerId: input.workerId } as OrganizationClaim;
      });
    },
    recordReferences(
      input: Pick<OrganizationClaim, 'itemId' | 'workerId' | 'generation'> & {
        baseline: unknown;
      },
    ) {
      return atomic(() => {
        const row = owned(input);
        const baseline = JSON.stringify(input.baseline);
        if (row.stage !== 'validating' || Buffer.byteLength(baseline) > 1024 * 1024)
          throw new Error('conflict');
        const state = advanceOrganizationState({ stage: 'validating' }, 'references_captured');
        db.prepare(
          'UPDATE organization_items SET baseline_json=?,stage=?,stage_changed_at=? WHERE id=?',
        ).run(baseline, state.stage, now(), input.itemId);
        event(input.itemId, 'references_captured', {});
      });
    },
    transition(
      input: Pick<OrganizationClaim, 'itemId' | 'workerId' | 'generation'> & {
        stage: OrganizationStage;
        errorCode?: string;
        newTrackId?: string | null;
      },
    ) {
      return atomic(() => {
        const row = owned(input);
        const current = { stage: row.stage as OrganizationStage };
        const state =
          input.stage === 'conflict'
            ? conflictOrganizationState(current, input.errorCode ?? 'destination_conflict')
            : input.stage === 'failed' || input.stage === 'recovery_required'
              ? failOrganizationState(current, input.errorCode ?? 'worker_interrupted')
              : advanceOrganizationState(current, input.stage);
        if (state.stage !== input.stage) throw new Error('invalid_transition');
        const terminal = ['succeeded', 'failed', 'conflict'].includes(state.stage);
        db.prepare(
          'UPDATE organization_items SET stage=$stage,new_track_id=COALESCE($new_track_id,new_track_id),error_code=$error_code,next_owner=$next_owner,stage_changed_at=$changed_at,lease_owner=$lease_owner,lease_expires_at=$lease_expires_at,encrypted_job_grant=CASE WHEN $terminal THEN NULL ELSE encrypted_job_grant END,grant_epoch=CASE WHEN $terminal THEN NULL ELSE grant_epoch END WHERE id=$id',
        ).run({
          $stage: state.stage,
          $new_track_id: input.newTrackId ?? null,
          $error_code: state.errorCode ?? null,
          $next_owner: state.nextOwner ?? null,
          $changed_at: now(),
          $lease_owner: terminal ? null : input.workerId,
          $lease_expires_at: terminal ? null : Number(row.lease_expires_at),
          $terminal: terminal ? 1 : 0,
          $id: input.itemId,
        });
        if (terminal)
          db.prepare(
            'UPDATE organization_attempts SET finished_at=?,error_code=? WHERE item_id=? AND generation=?',
          ).run(now(), state.errorCode ?? null, input.itemId, input.generation);
        event(input.itemId, 'stage_changed', {
          stage: state.stage,
          errorCode: state.errorCode ?? null,
          nextOwner: state.nextOwner ?? null,
        });
        return decodeItem(rowFor(input.itemId)!);
      });
    },
    putReferenceCheckpoint(
      input: Pick<OrganizationClaim, 'itemId' | 'workerId' | 'generation'> & {
        kind: 'playlist' | 'star';
        referenceId: string;
        baseline: unknown;
        desired: unknown;
      },
    ) {
      return atomic(() => {
        const row = owned(input);
        if (row.stage !== 'migrating_references') throw new Error('conflict');
        db.prepare(
          "INSERT INTO organization_reference_checkpoints(item_id,kind,reference_id,baseline_json,desired_json,status,updated_at) VALUES(?,?,?,?,?,'pending',?) ON CONFLICT(item_id,kind,reference_id) DO NOTHING",
        ).run(
          input.itemId,
          input.kind,
          input.referenceId,
          JSON.stringify(input.baseline),
          JSON.stringify(input.desired),
          now(),
        );
      });
    },
    completeReferenceCheckpoint(
      input: Pick<OrganizationClaim, 'itemId' | 'workerId' | 'generation'> & {
        kind: 'playlist' | 'star';
        referenceId: string;
      },
    ) {
      return atomic(() => {
        owned(input);
        const result = db
          .prepare(
            "UPDATE organization_reference_checkpoints SET status='completed',error_code=NULL,updated_at=? WHERE item_id=? AND kind=? AND reference_id=? AND status IN ('pending','completed')",
          )
          .run(now(), input.itemId, input.kind, input.referenceId);
        if (result.changes !== 1) throw new Error('conflict');
      });
    },
    referenceCheckpoints(itemId: string) {
      return db
        .prepare(
          'SELECT kind,reference_id,status,error_code FROM organization_reference_checkpoints WHERE item_id=? ORDER BY kind,reference_id',
        )
        .all(itemId)
        .map((row) => ({
          kind: String(row.kind),
          referenceId: String(row.reference_id),
          status: String(row.status),
          errorCode: row.error_code === null ? null : String(row.error_code),
        }));
    },
    bindSourceLocation(input: {
      itemId: string;
      mediaLinkId: string;
      sourceId: string;
      managedKey: string;
    }) {
      validateRelativeKey(input.managedKey);
      const item = rowFor(input.itemId);
      if (!item || item.media_link_id !== input.mediaLinkId || item.target_key !== input.managedKey)
        throw new Error('conflict');
      db.prepare(
        'INSERT INTO organization_source_locations(media_link_id,source_id,managed_key,organization_item_id,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(media_link_id) DO UPDATE SET source_id=excluded.source_id,managed_key=excluded.managed_key,organization_item_id=excluded.organization_item_id,updated_at=excluded.updated_at',
      ).run(input.mediaLinkId, input.sourceId, input.managedKey, input.itemId, now());
    },
    sourceLocation(sourceId: string) {
      const row = db
        .prepare('SELECT * FROM organization_source_locations WHERE source_id=?')
        .get(sourceId);
      return row
        ? {
            mediaLinkId: String(row.media_link_id),
            sourceId: String(row.source_id),
            managedKey: String(row.managed_key),
            itemId: String(row.organization_item_id),
          }
        : null;
    },
  };
}
