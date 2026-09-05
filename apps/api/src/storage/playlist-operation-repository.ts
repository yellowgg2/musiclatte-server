import type { DatabaseSync } from 'node:sqlite';
import type { ManagementDatabase } from './database.js';

export type PlaylistOperationKind =
  'create' | 'rename' | 'append' | 'remove' | 'reorder' | 'delete';
export type PlaylistOperationStatus = 'pending' | 'applied' | 'uncertain' | 'failed';
export interface PlaylistOperationReceipt {
  identityKey: string;
  operationIdHash: string;
  requestHash: string;
  kind: PlaylistOperationKind;
  resourceId: string | null;
  beforeRevision: string | null;
  afterRevision: string | null;
  status: PlaylistOperationStatus;
  createdAt: number;
  finishedAt: number | null;
}
export interface PlaylistOperationClaim {
  identityKey: string;
  operationIdHash: string;
  requestHash: string;
  kind: PlaylistOperationKind;
}
export interface PlaylistOperationResult {
  resourceId: string | null;
  beforeRevision: string | null;
  afterRevision: string | null;
}

const kinds = new Set<PlaylistOperationKind>([
  'create',
  'rename',
  'append',
  'remove',
  'reorder',
  'delete',
]);
const statuses = new Set<PlaylistOperationStatus>(['pending', 'applied', 'uncertain', 'failed']);
const fingerprint = /^[a-f0-9]{64}$/;
const domainErrors = new Set([
  'Invalid playlist operation',
  'Invalid playlist operation transition',
  'Playlist operation not found',
]);

function decode(row: Record<string, unknown> | undefined): PlaylistOperationReceipt | null {
  if (!row) return null;
  const receipt = {
    identityKey: row.identity_key,
    operationIdHash: row.operation_id_hash,
    requestHash: row.request_hash,
    kind: row.kind,
    resourceId: row.resource_id,
    beforeRevision: row.before_revision,
    afterRevision: row.after_revision,
    status: row.status,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
  if (
    typeof receipt.identityKey !== 'string' ||
    !fingerprint.test(receipt.identityKey) ||
    typeof receipt.operationIdHash !== 'string' ||
    !fingerprint.test(receipt.operationIdHash) ||
    typeof receipt.requestHash !== 'string' ||
    !fingerprint.test(receipt.requestHash) ||
    typeof receipt.kind !== 'string' ||
    !kinds.has(receipt.kind as PlaylistOperationKind) ||
    typeof receipt.status !== 'string' ||
    !statuses.has(receipt.status as PlaylistOperationStatus) ||
    !nullableText(receipt.resourceId) ||
    !nullableText(receipt.beforeRevision) ||
    !nullableText(receipt.afterRevision) ||
    !time(receipt.createdAt) ||
    !(receipt.finishedAt === null || time(receipt.finishedAt))
  )
    throw new Error('Storage unavailable');
  return receipt as PlaylistOperationReceipt;
}

function nullableText(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length > 0);
}

function time(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validClaim(input: PlaylistOperationClaim): boolean {
  return (
    fingerprint.test(input.identityKey) &&
    fingerprint.test(input.operationIdHash) &&
    fingerprint.test(input.requestHash) &&
    kinds.has(input.kind)
  );
}

function preserveDomainError(error: unknown): never {
  if (error instanceof Error && domainErrors.has(error.message)) throw error;
  throw new Error('Storage unavailable');
}

/** Validate every persisted receipt when publishing or restoring a backup snapshot. */
export function validatePlaylistOperationReceipts(database: DatabaseSync): void {
  for (const row of database
    .prepare(
      'SELECT identity_key,operation_id_hash,request_hash,kind,resource_id,before_revision,after_revision,status,created_at,finished_at FROM playlist_operations',
    )
    .iterate())
    decode(row);
}

/** Durable synchronous receipt storage; callers perform all network work outside its transactions. */
export function createPlaylistOperationRepository(options: {
  database: ManagementDatabase;
  clock: () => number;
}) {
  const { database, clock } = options;
  const db = database.connection;
  const read = (identityKey: string, operationIdHash: string) =>
    decode(
      db
        .prepare(
          'SELECT identity_key,operation_id_hash,request_hash,kind,resource_id,before_revision,after_revision,status,created_at,finished_at FROM playlist_operations WHERE identity_key=? AND operation_id_hash=?',
        )
        .get(identityKey, operationIdHash),
    );
  const now = () => {
    const value = clock();
    if (!time(value)) throw new Error('Invalid playlist operation');
    return value;
  };
  function key(identityKey: string, operationIdHash: string): void {
    if (!fingerprint.test(identityKey) || !fingerprint.test(operationIdHash))
      throw new Error('Invalid playlist operation');
  }
  function transition(
    identityKey: string,
    operationIdHash: string,
    allowed: PlaylistOperationStatus[],
    status: PlaylistOperationStatus,
    result: PlaylistOperationResult = {
      resourceId: null,
      beforeRevision: null,
      afterRevision: null,
    },
  ): PlaylistOperationReceipt {
    key(identityKey, operationIdHash);
    if (![result.resourceId, result.beforeRevision, result.afterRevision].every(nullableText))
      throw new Error('Invalid playlist operation');
    try {
      return database.transaction(() => {
        const current = read(identityKey, operationIdHash);
        if (!current) throw new Error('Playlist operation not found');
        if (!allowed.includes(current.status))
          throw new Error('Invalid playlist operation transition');
        const finishedAt = now();
        if (finishedAt < current.createdAt) throw new Error('Invalid playlist operation');
        db.prepare(
          'UPDATE playlist_operations SET resource_id=?,before_revision=?,after_revision=?,status=?,finished_at=? WHERE identity_key=? AND operation_id_hash=?',
        ).run(
          result.resourceId,
          result.beforeRevision,
          result.afterRevision,
          status,
          finishedAt,
          identityKey,
          operationIdHash,
        );
        return read(identityKey, operationIdHash)!;
      });
    } catch (error) {
      preserveDomainError(error);
    }
  }
  return {
    claim(input: PlaylistOperationClaim): {
      outcome: 'claimed' | 'existing' | 'conflict';
      receipt: PlaylistOperationReceipt;
    } {
      if (!validClaim(input)) throw new Error('Invalid playlist operation');
      try {
        return database.transaction(() => {
          const createdAt = now();
          const inserted = db
            .prepare(
              "INSERT OR IGNORE INTO playlist_operations(identity_key,operation_id_hash,request_hash,kind,resource_id,before_revision,after_revision,status,created_at,finished_at) VALUES(?,?,?,?,NULL,NULL,NULL,'pending',?,NULL)",
            )
            .run(
              input.identityKey,
              input.operationIdHash,
              input.requestHash,
              input.kind,
              createdAt,
            );
          const receipt = read(input.identityKey, input.operationIdHash)!;
          if (inserted.changes === 1) return { outcome: 'claimed', receipt };
          if (receipt.requestHash === input.requestHash && receipt.kind === input.kind)
            return { outcome: 'existing', receipt };
          return { outcome: 'conflict', receipt };
        });
      } catch (error) {
        preserveDomainError(error);
      }
    },
    get(identityKey: string, operationIdHash: string): PlaylistOperationReceipt | null {
      key(identityKey, operationIdHash);
      try {
        return read(identityKey, operationIdHash);
      } catch (error) {
        preserveDomainError(error);
      }
    },
    markApplied(
      identityKey: string,
      operationIdHash: string,
      result: PlaylistOperationResult,
    ): PlaylistOperationReceipt {
      return transition(identityKey, operationIdHash, ['pending', 'uncertain'], 'applied', result);
    },
    markUncertain(identityKey: string, operationIdHash: string): PlaylistOperationReceipt {
      return transition(identityKey, operationIdHash, ['pending'], 'uncertain');
    },
    markFailed(identityKey: string, operationIdHash: string): PlaylistOperationReceipt {
      return transition(identityKey, operationIdHash, ['pending'], 'failed');
    },
  };
}
