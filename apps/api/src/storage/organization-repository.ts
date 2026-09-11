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
import { decodeMetadataReferences, type MetadataReferences } from '../metadata/reference-check.js';

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
  sourceEvidence: readonly { url: string; kind: string; fields: readonly string[] }[];
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
  libraryId: string;
  workerId: string;
  generation: number;
  stage: OrganizationStage;
  sourceKey: string;
  targetKey: string;
  fileIdentity: string;
  audioIdentity: string;
  oldTrackId: string;
  newTrackId: string | null;
  preimage: {
    device: string;
    inode: string;
    digest: string;
    mode: number;
    uid: number;
    gid: number;
    audioIdentity: string;
    targetParentDevice: string;
    targetParentInode: string;
  } | null;
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
    preimage:
      row.source_digest === null
        ? null
        : {
            device: text(row.source_device),
            inode: text(row.source_inode),
            digest: text(row.source_digest),
            mode: integer(row.source_mode),
            uid: integer(row.source_uid),
            gid: integer(row.source_gid),
            audioIdentity: text(row.audio_identity),
            targetParentDevice: text(row.target_parent_device),
            targetParentInode: text(row.target_parent_inode),
          },
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
    if (
      [
        'moving',
        'moved',
        'scanning',
        'rebound',
        'migrating_references',
        'verifying',
        'succeeded',
      ].includes(item.stage) &&
      (!hex(row.source_digest) ||
        typeof row.source_device !== 'string' ||
        !/^\d+$/.test(row.source_device) ||
        typeof row.source_inode !== 'string' ||
        !/^\d+$/.test(row.source_inode) ||
        typeof row.target_parent_device !== 'string' ||
        !/^\d+$/.test(row.target_parent_device) ||
        typeof row.target_parent_inode !== 'string' ||
        !/^\d+$/.test(row.target_parent_inode))
    )
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
    requestRetry(input: {
      itemId: string;
      identityKey: string;
      operationIdHash: string;
      requestHash: string;
    }) {
      return atomic(() => {
        if (!hex(input.identityKey) || !hex(input.operationIdHash) || !hex(input.requestHash))
          throw new Error('conflict');
        const row = db
          .prepare(
            'SELECT i.*,j.identity_key FROM organization_items i JOIN organization_jobs j ON j.id=i.job_id WHERE i.id=?',
          )
          .get(input.itemId) as Row | undefined;
        if (!row || row.identity_key !== input.identityKey) throw new Error('not_found');
        const prior = db
          .prepare(
            "SELECT payload_json FROM organization_events WHERE item_id=? AND kind='retry_requested' ORDER BY sequence",
          )
          .all(input.itemId)
          .map((event) => JSON.parse(String(event.payload_json)) as Record<string, unknown>)
          .find((payload) => payload.operationIdHash === input.operationIdHash);
        if (prior) {
          if (prior.requestHash !== input.requestHash) throw new Error('conflict');
          return readJob(text(row.job_id), input.identityKey)!;
        }
        if (row.stage !== 'recovery_required' || row.lease_owner !== null) {
          if (
            [
              'moving',
              'moved',
              'scanning',
              'rebound',
              'migrating_references',
              'verifying',
              'succeeded',
            ].includes(String(row.stage))
          )
            return readJob(text(row.job_id), input.identityKey)!;
          throw new Error('conflict');
        }
        if (!['filesystem', 'gonic', 'references', 'verification'].includes(String(row.next_owner)))
          throw new Error('conflict');
        event(input.itemId, 'retry_requested', {
          operationIdHash: input.operationIdHash,
          requestHash: input.requestHash,
          nextOwner: row.next_owner,
        });
        db.prepare('UPDATE organization_items SET stage_changed_at=? WHERE id=?').run(
          now(),
          input.itemId,
        );
        return readJob(text(row.job_id), input.identityKey)!;
      });
    },
    claimNext(input: {
      workerId: string;
      leaseDurationMs: number;
      recoveryOnly?: boolean;
      fileOnly?: boolean;
      registrationOnly?: boolean;
      referenceOnly?: boolean;
    }) {
      return atomic(() => {
        if (
          !input.workerId ||
          !Number.isSafeInteger(input.leaseDurationMs) ||
          input.leaseDurationMs < 1
        )
          throw new Error('invalid_claim');
        const timestamp = now();
        if (
          [input.recoveryOnly, input.fileOnly, input.registrationOnly, input.referenceOnly].filter(
            Boolean,
          ).length > 1
        )
          throw new Error('invalid_claim');
        const stages = input.recoveryOnly
          ? "(stage='moving' OR (stage='recovery_required' AND next_owner='filesystem'))"
          : input.fileOnly
            ? "stage IN ('queued','validating','references_captured')"
            : input.registrationOnly
              ? "(stage IN ('moved','scanning') OR (stage='recovery_required' AND next_owner='gonic'))"
              : input.referenceOnly
                ? "(stage IN ('rebound','migrating_references','verifying') OR (stage='recovery_required' AND next_owner IN ('references','verification')))"
                : "stage NOT IN ('succeeded','failed','conflict','recovery_required')";
        const row = db
          .prepare(
            `SELECT * FROM organization_items WHERE ${stages} AND (lease_owner IS NULL OR lease_expires_at<=?) ORDER BY stage_changed_at,id LIMIT 1`,
          )
          .get(timestamp) as Row | undefined;
        if (!row) return null;
        const stage =
          row.stage === 'queued'
            ? 'validating'
            : input.recoveryOnly && row.stage === 'moving'
              ? 'recovery_required'
              : input.registrationOnly && row.stage === 'scanning'
                ? 'recovery_required'
                : input.referenceOnly &&
                    ['migrating_references', 'verifying'].includes(String(row.stage))
                  ? 'recovery_required'
                  : String(row.stage);
        const generation = integer(row.generation) + 1;
        const leaseExpiresAt = timestamp + input.leaseDurationMs;
        const interrupted =
          (input.recoveryOnly && row.stage === 'moving') ||
          (input.registrationOnly && row.stage === 'scanning') ||
          (input.referenceOnly &&
            ['migrating_references', 'verifying'].includes(String(row.stage)));
        db.prepare(
          'UPDATE organization_items SET stage=?,generation=?,lease_owner=?,lease_expires_at=?,stage_changed_at=?,error_code=CASE WHEN ? THEN ? ELSE error_code END,next_owner=CASE WHEN ? THEN ? ELSE next_owner END WHERE id=?',
        ).run(
          stage,
          generation,
          input.workerId,
          leaseExpiresAt,
          timestamp,
          interrupted ? 1 : 0,
          'worker_interrupted',
          interrupted ? 1 : 0,
          input.registrationOnly
            ? 'gonic'
            : input.referenceOnly
              ? row.stage === 'verifying'
                ? 'verification'
                : 'references'
              : 'filesystem',
          text(row.id),
        );
        db.prepare(
          'INSERT INTO organization_attempts(item_id,generation,owner,started_at) VALUES(?,?,?,?)',
        ).run(text(row.id), generation, input.workerId, timestamp);
        const claimed = decodeItem(rowFor(text(row.id))!);
        const libraryId = text(
          db.prepare('SELECT library_id FROM organization_jobs WHERE id=?').get(claimed.jobId)
            ?.library_id,
        );
        return { ...claimed, libraryId, workerId: input.workerId } as OrganizationClaim;
      });
    },
    recordReferences(
      input: Pick<OrganizationClaim, 'itemId' | 'workerId' | 'generation'> & {
        baseline: unknown;
      },
    ) {
      return atomic(() => {
        const row = owned(input);
        const baseline = JSON.stringify(decodeMetadataReferences(input.baseline));
        if (row.stage !== 'validating' || Buffer.byteLength(baseline) > 1024 * 1024)
          throw new Error('conflict');
        const state = advanceOrganizationState({ stage: 'validating' }, 'references_captured');
        db.prepare(
          'UPDATE organization_items SET baseline_json=?,stage=?,stage_changed_at=? WHERE id=?',
        ).run(baseline, state.stage, now(), input.itemId);
        event(input.itemId, 'references_captured', {});
      });
    },
    recordMovePreimage(
      input: Pick<OrganizationClaim, 'itemId' | 'workerId' | 'generation'> & {
        preimage: {
          device: string;
          inode: string;
          digest: string;
          mode: number;
          uid: number;
          gid: number;
          audioIdentity: string;
          targetParentDevice: string;
          targetParentInode: string;
        };
      },
    ) {
      return atomic(() => {
        const row = owned(input);
        const value = input.preimage;
        if (
          row.stage !== 'references_captured' ||
          !/^\d+$/.test(value.device) ||
          !/^\d+$/.test(value.inode) ||
          !/^\d+$/.test(value.targetParentDevice) ||
          !/^\d+$/.test(value.targetParentInode) ||
          !hex(value.digest) ||
          !hex(value.audioIdentity) ||
          value.audioIdentity !== row.audio_identity ||
          ![value.mode, value.uid, value.gid].every(
            (number) => Number.isSafeInteger(number) && number >= 0,
          ) ||
          value.mode > 4095
        )
          throw new Error('conflict');
        db.prepare(
          'UPDATE organization_items SET source_device=?,source_inode=?,source_digest=?,source_mode=?,source_uid=?,source_gid=?,target_parent_device=?,target_parent_inode=? WHERE id=?',
        ).run(
          value.device,
          value.inode,
          value.digest,
          value.mode,
          value.uid,
          value.gid,
          value.targetParentDevice,
          value.targetParentInode,
          input.itemId,
        );
        event(input.itemId, 'move_preimage_recorded', {
          device: value.device,
          inode: value.inode,
          digest: value.digest,
          mode: value.mode,
          uid: value.uid,
          gid: value.gid,
          targetParentDevice: value.targetParentDevice,
          targetParentInode: value.targetParentInode,
        });
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
          input.stage === 'recovery_required' && current.stage === 'recovery_required'
            ? {
                stage: 'recovery_required' as const,
                errorCode: input.errorCode ?? 'worker_interrupted',
                nextOwner: String(row.next_owner) as OrganizationRecoveryOwner,
              }
            : input.stage === 'conflict'
              ? conflictOrganizationState(current, input.errorCode ?? 'destination_conflict')
              : input.stage === 'failed' || input.stage === 'recovery_required'
                ? failOrganizationState(current, input.errorCode ?? 'worker_interrupted')
                : advanceOrganizationState(current, input.stage);
        if (state.stage !== input.stage) throw new Error('invalid_transition');
        const terminal = ['succeeded', 'failed', 'conflict'].includes(state.stage);
        const relinquish =
          terminal ||
          state.stage === 'moved' ||
          state.stage === 'rebound' ||
          state.stage === 'recovery_required';
        db.prepare(
          'UPDATE organization_items SET stage=$stage,new_track_id=COALESCE($new_track_id,new_track_id),error_code=$error_code,next_owner=$next_owner,stage_changed_at=$changed_at,lease_owner=$lease_owner,lease_expires_at=$lease_expires_at,encrypted_job_grant=CASE WHEN $terminal THEN NULL ELSE encrypted_job_grant END,grant_epoch=CASE WHEN $terminal THEN NULL ELSE grant_epoch END WHERE id=$id',
        ).run({
          $stage: state.stage,
          $new_track_id: input.newTrackId ?? null,
          $error_code: state.errorCode ?? null,
          $next_owner: state.nextOwner ?? null,
          $changed_at: now(),
          $lease_owner: relinquish ? null : input.workerId,
          $lease_expires_at: relinquish ? null : Number(row.lease_expires_at),
          $terminal: terminal ? 1 : 0,
          $id: input.itemId,
        });
        if (relinquish)
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
        const baseline = JSON.stringify(input.baseline);
        const desired = JSON.stringify(input.desired);
        const existing = db
          .prepare(
            'SELECT baseline_json,desired_json,status FROM organization_reference_checkpoints WHERE item_id=? AND kind=? AND reference_id=?',
          )
          .get(input.itemId, input.kind, input.referenceId);
        if (existing) {
          if (existing.baseline_json !== baseline || existing.desired_json !== desired)
            throw new Error('conflict');
          if (existing.status !== 'completed')
            db.prepare(
              "UPDATE organization_reference_checkpoints SET status='pending',error_code=NULL,updated_at=? WHERE item_id=? AND kind=? AND reference_id=?",
            ).run(now(), input.itemId, input.kind, input.referenceId);
          return;
        }
        db.prepare(
          "INSERT INTO organization_reference_checkpoints(item_id,kind,reference_id,baseline_json,desired_json,status,updated_at) VALUES(?,?,?,?,?,'pending',?)",
        ).run(input.itemId, input.kind, input.referenceId, baseline, desired, now());
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
    readBaseline(claim: OrganizationClaim): MetadataReferences {
      const row = owned(claim);
      if (row.baseline_json === null) throw new Error('reference_conflict');
      return decodeMetadataReferences(JSON.parse(text(row.baseline_json)));
    },
    failReferenceCheckpoint(
      input: Pick<OrganizationClaim, 'itemId' | 'workerId' | 'generation'> & {
        kind: 'playlist' | 'star';
        referenceId: string;
        errorCode: string;
      },
    ) {
      return atomic(() => {
        const row = owned(input);
        if (row.stage !== 'migrating_references' || !input.errorCode) throw new Error('conflict');
        const result = db
          .prepare(
            "UPDATE organization_reference_checkpoints SET status='conflict',error_code=?,updated_at=? WHERE item_id=? AND kind=? AND reference_id=? AND status<>'completed'",
          )
          .run(input.errorCode, now(), input.itemId, input.kind, input.referenceId);
        if (result.changes !== 1) throw new Error('conflict');
      });
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
    rebindCurrent(
      input: Pick<OrganizationClaim, 'itemId' | 'workerId' | 'generation'> & {
        newTrackId: string;
        targetFileIdentity: string;
      },
    ) {
      return atomic(() => {
        const row = owned(input);
        if (row.stage !== 'scanning' || !input.newTrackId || !hex(input.targetFileIdentity))
          throw new Error('conflict');
        const job = db
          .prepare('SELECT library_id FROM organization_jobs WHERE id=?')
          .get(text(row.job_id))!;
        const libraryId = text(job.library_id);
        const mediaLinkId = text(row.media_link_id);
        const sourceKey = text(row.source_key);
        const targetKey = text(row.target_key);
        const oldTrackId = text(row.old_track_id);
        const link = db.prepare('SELECT * FROM media_links WHERE id=?').get(mediaLinkId) as
          Row | undefined;
        if (
          !link ||
          link.library_id !== libraryId ||
          !(
            (link.relative_file_key === sourceKey && link.gonic_song_id === oldTrackId) ||
            (link.relative_file_key === targetKey && link.gonic_song_id === input.newTrackId)
          ) ||
          db
            .prepare(
              'SELECT 1 FROM media_links WHERE library_id=? AND id<>? AND (relative_file_key=? OR gonic_song_id=?) LIMIT 1',
            )
            .get(libraryId, mediaLinkId, targetKey, input.newTrackId)
        )
          throw new Error('conflict');
        if (
          link.relative_file_key !== targetKey ||
          link.gonic_song_id !== input.newTrackId ||
          link.availability !== 'available'
        )
          db.prepare(
            "UPDATE media_links SET relative_file_key=?,gonic_song_id=?,availability='available',revision=revision+1,validated_at=? WHERE id=? AND revision=?",
          ).run(targetKey, input.newTrackId, now(), mediaLinkId, integer(link.revision));
        const rebound = db.prepare('SELECT revision FROM media_links WHERE id=?').get(mediaLinkId)!;
        db.prepare('UPDATE metadata_items SET current_track_id=? WHERE media_link_id=?').run(
          input.newTrackId,
          mediaLinkId,
        );
        const curation = db
          .prepare('SELECT id FROM curation_tracks WHERE media_link_id=?')
          .all(mediaLinkId);
        if (curation.length > 1) throw new Error('conflict');
        const trackRef = curation.length ? text(curation[0]!.id) : null;
        if (trackRef) {
          const conflict = db
            .prepare(
              'SELECT 1 FROM curation_tracks WHERE library_id=? AND track_id=? AND id<>? LIMIT 1',
            )
            .get(libraryId, input.newTrackId, trackRef);
          if (conflict) throw new Error('conflict');
          db.prepare(
            "UPDATE curation_tracks SET track_id=?,file_identity=?,binding_revision=?,format='mp3',tombstoned=0 WHERE id=?",
          ).run(input.newTrackId, input.targetFileIdentity, integer(rebound.revision), trackRef);
        }
        db.prepare(
          "INSERT OR IGNORE INTO curation_source_events(library_id,media_link_id,track_id,kind,source_key,created_at) VALUES(?,?,?,'organization_rebound',?,?)",
        ).run(
          libraryId,
          mediaLinkId,
          input.newTrackId,
          `organization:${input.itemId}:rebound`,
          now(),
        );
        return { trackRef };
      });
    },
    completeRegistration(
      input: Pick<OrganizationClaim, 'itemId' | 'workerId' | 'generation'> & {
        newTrackId: string;
      },
    ) {
      return atomic(() => {
        const row = owned(input);
        const mediaLinkId = text(row.media_link_id);
        const targetKey = text(row.target_key);
        const link = db.prepare('SELECT * FROM media_links WHERE id=?').get(mediaLinkId) as
          Row | undefined;
        if (
          row.stage !== 'scanning' ||
          !input.newTrackId ||
          !link ||
          link.relative_file_key !== targetKey ||
          link.gonic_song_id !== input.newTrackId ||
          link.availability !== 'available'
        )
          throw new Error('conflict');
        const provenance = db
          .prepare(
            "SELECT source_id FROM import_items WHERE media_link_id=? AND stage IN ('registering','ready','duplicate') ORDER BY id LIMIT 1",
          )
          .get(mediaLinkId);
        if (provenance)
          db.prepare(
            'INSERT INTO organization_source_locations(media_link_id,source_id,managed_key,organization_item_id,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(media_link_id) DO UPDATE SET source_id=excluded.source_id,managed_key=excluded.managed_key,organization_item_id=excluded.organization_item_id,updated_at=excluded.updated_at',
          ).run(mediaLinkId, text(provenance.source_id), targetKey, input.itemId, now());
        db.prepare(
          "UPDATE organization_items SET stage='rebound',new_track_id=?,error_code=NULL,next_owner=NULL,stage_changed_at=?,lease_owner=NULL,lease_expires_at=NULL WHERE id=?",
        ).run(input.newTrackId, now(), input.itemId);
        db.prepare(
          'UPDATE organization_attempts SET finished_at=?,error_code=NULL WHERE item_id=? AND generation=?',
        ).run(now(), input.itemId, input.generation);
        event(input.itemId, 'stage_changed', {
          stage: 'rebound',
          newTrackId: input.newTrackId,
        });
        return decodeItem(rowFor(input.itemId)!);
      });
    },
    resumeRecovery(
      input: Pick<OrganizationClaim, 'itemId' | 'workerId' | 'generation'> & {
        stage: 'moving' | 'moved' | 'scanning' | 'migrating_references';
      },
    ) {
      return atomic(() => {
        const row = owned(input);
        if (
          row.stage !== 'recovery_required' ||
          (input.stage === 'scanning'
            ? row.next_owner !== 'gonic'
            : input.stage === 'migrating_references'
              ? !['references', 'verification'].includes(String(row.next_owner))
              : row.next_owner !== 'filesystem')
        )
          throw new Error('conflict');
        db.prepare(
          'UPDATE organization_items SET stage=$stage,error_code=NULL,next_owner=NULL,stage_changed_at=$changed_at,lease_owner=$lease_owner,lease_expires_at=$lease_expires_at WHERE id=$id',
        ).run({
          $stage: input.stage,
          $changed_at: now(),
          $lease_owner: input.stage === 'moved' ? null : input.workerId,
          $lease_expires_at: input.stage === 'moved' ? null : Number(row.lease_expires_at),
          $id: input.itemId,
        });
        if (input.stage === 'moved')
          db.prepare(
            'UPDATE organization_attempts SET finished_at=?,error_code=NULL WHERE item_id=? AND generation=?',
          ).run(now(), input.itemId, input.generation);
        event(input.itemId, 'filesystem_recovered', { stage: input.stage });
        return decodeItem(rowFor(input.itemId)!);
      });
    },
  };
}
