import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { decodeMixInput, type MixInput } from '@musiclatte/contracts';
import type { ManagementDatabase } from './database.js';
export interface StoredMix extends MixInput {
  id: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
}
export type MixMutationResult = { mix: StoredMix } | { deleted: true; id: string };
export interface MixMutation {
  identityKey: string;
  operationIdHash: string;
  requestHash: string;
  kind: 'create' | 'update' | 'delete';
  id?: string;
  revision?: number;
  input?: MixInput;
}
export interface MixAnchor {
  createdAt: number;
  id: string;
}
const fingerprint = /^[a-f0-9]{64}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const time = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function invalid(): never {
  throw new Error('Storage unavailable');
}
function decode(value: Record<string, unknown>): StoredMix {
  try {
    const input = decodeMixInput({
      name: value.name,
      conditions: JSON.parse(String(value.conditions_json)),
    });
    if (
      input.name !== value.name ||
      JSON.stringify(input.conditions) !== value.conditions_json ||
      typeof value.id !== 'string' ||
      !uuid.test(value.id) ||
      typeof value.identity_key !== 'string' ||
      !fingerprint.test(value.identity_key) ||
      !time(value.sequence) ||
      value.sequence < 1 ||
      !time(value.revision) ||
      value.revision < 1 ||
      !time(value.created_at) ||
      !time(value.updated_at) ||
      value.updated_at < value.created_at ||
      !(
        value.deleted_at === null ||
        (time(value.deleted_at) && value.deleted_at >= value.updated_at)
      )
    )
      return invalid();
    return {
      ...input,
      id: value.id,
      revision: value.revision,
      createdAt: value.created_at,
      updatedAt: value.updated_at,
    };
  } catch {
    return invalid();
  }
}
function receipt(row: Record<string, unknown>, db: DatabaseSync): MixMutationResult {
  try {
    if (
      ![row.identity_key, row.operation_id_hash, row.request_hash].every(
        (value) => typeof value === 'string' && fingerprint.test(value),
      ) ||
      !['create', 'update', 'delete'].includes(String(row.kind)) ||
      !time(row.created_at)
    )
      return invalid();
    const target = db
      .prepare('SELECT * FROM saved_mixes WHERE id=? AND identity_key=?')
      .get(String(row.resource_id), String(row.identity_key));
    if (!target) return invalid();
    const current = decode(target);
    const result = JSON.parse(String(row.result_json));
    if (row.kind === 'delete') {
      if (
        result.deleted !== true ||
        result.id !== current.id ||
        target.deleted_at === null ||
        Object.keys(result).length !== 2
      )
        return invalid();
    } else {
      const mix = result.mix;
      if (!mix || Object.keys(result).length !== 1 || Object.keys(mix).length !== 6)
        return invalid();
      const saved = decode({
        ...target,
        name: mix.name,
        conditions_json: JSON.stringify(mix.conditions),
        revision: mix.revision,
        created_at: mix.createdAt,
        updated_at: mix.updatedAt,
        deleted_at: null,
      });
      if (
        mix.id !== saved.id ||
        saved.createdAt !== current.createdAt ||
        saved.revision > current.revision ||
        saved.updatedAt > current.updatedAt
      )
        return invalid();
    }
    return result;
  } catch {
    return invalid();
  }
}
export function validateMixStorage(db: DatabaseSync): void {
  for (const row of db.prepare('SELECT * FROM saved_mixes').iterate()) decode(row);
  for (const row of db.prepare('SELECT * FROM mix_operations').iterate()) receipt(row, db);
}
/** Only typed anchors and HMAC identities cross this private storage boundary. */
export function createMixRepository({
  database,
  clock,
}: {
  database: ManagementDatabase;
  clock(): number;
}) {
  const db = database.connection;
  function key(identityKey: string) {
    if (!fingerprint.test(identityKey)) throw new Error('Invalid mix');
  }
  function get(identityKey: string, id: string): StoredMix | null {
    key(identityKey);
    const row = db
      .prepare('SELECT * FROM saved_mixes WHERE identity_key=? AND id=? AND deleted_at IS NULL')
      .get(identityKey, id);
    return row ? decode(row) : null;
  }
  return {
    get,
    list(
      identityKey: string,
      options: { limit?: number; highWater?: number; anchor?: MixAnchor } = {},
    ) {
      key(identityKey);
      const limit = options.limit ?? 50;
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        (options.highWater !== undefined && !time(options.highWater)) ||
        (options.anchor && (!time(options.anchor.createdAt) || !uuid.test(options.anchor.id)))
      )
        throw new Error('Invalid mix');
      return database.transaction(() => {
        const highWater =
          options.highWater ??
          Number(
            db
              .prepare(
                'SELECT coalesce(max(sequence),0) AS n FROM saved_mixes WHERE identity_key=?',
              )
              .get(identityKey)?.n,
          );
        const rows = db
          .prepare(
            `SELECT * FROM saved_mixes WHERE identity_key=? AND deleted_at IS NULL AND sequence<=? ${options.anchor ? 'AND (created_at<? OR (created_at=? AND id<?))' : ''} ORDER BY created_at DESC,id DESC LIMIT ?`,
          )
          .all(
            identityKey,
            highWater,
            ...(options.anchor
              ? [options.anchor.createdAt, options.anchor.createdAt, options.anchor.id]
              : []),
            limit + 1,
          );
        const items = rows.slice(0, limit).map(decode);
        const last = items.at(-1);
        return {
          items,
          highWater,
          next: rows.length > limit && last ? { createdAt: last.createdAt, id: last.id } : null,
        };
      });
    },
    mutate(request: MixMutation): MixMutationResult {
      key(request.identityKey);
      if (
        !fingerprint.test(request.operationIdHash) ||
        !fingerprint.test(request.requestHash) ||
        !['create', 'update', 'delete'].includes(request.kind)
      )
        throw new Error('Invalid mix');
      const input = request.kind === 'delete' ? undefined : decodeMixInput(request.input);
      if (
        request.kind !== 'create' &&
        (typeof request.id !== 'string' ||
          !uuid.test(request.id) ||
          !time(request.revision) ||
          request.revision < 1)
      )
        throw new Error('Invalid mix');
      return database.transaction(() => {
        const existing = db
          .prepare('SELECT * FROM mix_operations WHERE identity_key=? AND operation_id_hash=?')
          .get(request.identityKey, request.operationIdHash);
        if (existing) {
          if (
            existing.request_hash !== request.requestHash ||
            existing.kind !== request.kind ||
            (request.kind !== 'create' && existing.resource_id !== request.id)
          )
            throw new Error('Mix conflict');
          return receipt(existing, db);
        }
        const now = clock();
        if (!time(now)) throw new Error('Invalid mix');
        let result: MixMutationResult;
        if (request.kind === 'create') {
          const id = randomUUID();
          db.prepare(
            'INSERT INTO saved_mixes(id,identity_key,name,conditions_json,revision,created_at,updated_at) VALUES(?,?,?,?,1,?,?)',
          ).run(id, request.identityKey, input!.name, JSON.stringify(input!.conditions), now, now);
          result = { mix: get(request.identityKey, id)! };
        } else {
          const current = get(request.identityKey, request.id!);
          if (!current) throw new Error('Mix not found');
          if (current.revision !== request.revision || current.revision === Number.MAX_SAFE_INTEGER)
            throw new Error('Mix conflict');
          const updatedAt = Math.max(now, current.updatedAt);
          if (request.kind === 'delete') {
            db.prepare('UPDATE saved_mixes SET deleted_at=? WHERE id=?').run(updatedAt, current.id);
            result = { deleted: true, id: current.id };
          } else {
            db.prepare(
              'UPDATE saved_mixes SET name=?,conditions_json=?,revision=revision+1,updated_at=? WHERE id=?',
            ).run(input!.name, JSON.stringify(input!.conditions), updatedAt, current.id);
            result = { mix: get(request.identityKey, current.id)! };
          }
        }
        db.prepare(
          'INSERT INTO mix_operations(identity_key,operation_id_hash,request_hash,kind,resource_id,result_json,created_at) VALUES(?,?,?,?,?,?,?)',
        ).run(
          request.identityKey,
          request.operationIdHash,
          request.requestHash,
          request.kind,
          'mix' in result ? result.mix.id : result.id,
          JSON.stringify(result),
          now,
        );
        return result;
      });
    },
  };
}
