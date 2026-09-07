import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ManagementDatabase } from './database.js';

export const engineStatuses = [
  'never_checked',
  'checking',
  'up_to_date',
  'candidate_pending_validation',
  'active',
  'update_failed',
  'validation_failed',
  'restored',
] as const;
export type EngineStatus = (typeof engineStatuses)[number];
export const engineFailureCodes = [
  'update_failed',
  'invalid_executable',
  'invalid_hash',
  'invalid_version',
  'dependency_failed',
  'source_probe_failed',
  'source_mismatch',
  'activation_failed',
  'check_interrupted',
] as const;
export type EngineFailure = (typeof engineFailureCodes)[number];
export interface EngineState {
  lastCheckedAt: number | null;
  lastCheckSucceededAt: number | null;
  activeVersion: string | null;
  candidateVersion: string | null;
  previousVersion: string | null;
  status: EngineStatus;
  failureCode: EngineFailure | null;
  candidateKey: string | null;
  candidateHash: string | null;
  operationToken: string | null;
  operationExpiresAt: number | null;
}
export const engineCheckIntervalMs = 86_400_000;
export const engineOperationLeaseMs = 120_000;
const text = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const time = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function decode(row: Record<string, unknown> | undefined): EngineState {
  if (!row) throw new Error('Storage unavailable');
  const state = {
    lastCheckedAt: row.last_checked_at,
    lastCheckSucceededAt: row.last_check_succeeded_at,
    activeVersion: row.active_version,
    candidateVersion: row.candidate_version,
    previousVersion: row.previous_version,
    status: row.status,
    failureCode: row.failure_code,
    candidateKey: row.candidate_key,
    candidateHash: row.candidate_hash,
    operationToken: row.operation_token,
    operationExpiresAt: row.operation_expires_at,
  };
  if (
    ![state.lastCheckedAt, state.lastCheckSucceededAt, state.operationExpiresAt].every(
      (v) => v === null || time(v),
    ) ||
    ![
      state.activeVersion,
      state.candidateVersion,
      state.previousVersion,
      state.candidateKey,
      state.operationToken,
    ].every((v) => v === null || text(v)) ||
    !engineStatuses.some((v) => v === state.status) ||
    !(state.failureCode === null || engineFailureCodes.some((v) => v === state.failureCode)) ||
    !(
      state.candidateHash === null ||
      (typeof state.candidateHash === 'string' && /^[a-f0-9]{64}$/.test(state.candidateHash))
    )
  )
    throw new Error('Storage unavailable');
  return state as EngineState;
}
export function validateEngineState(database: DatabaseSync): void {
  decode(database.prepare('SELECT * FROM engine_state WHERE singleton=1').get());
}

/** Short SQL claims fence all asynchronous process work; filesystem I/O stays outside transactions. */
export function createEngineRepository(options: {
  database: ManagementDatabase;
  clock: () => number;
}) {
  const { database, clock } = options;
  const db = database.connection;
  const get = () => decode(db.prepare('SELECT * FROM engine_state WHERE singleton=1').get());
  const now = () => {
    const value = clock();
    if (!time(value)) throw new Error('Invalid engine state');
    return value;
  };
  const assertOwned = (token: string) => {
    const state = get();
    if (
      state.operationToken !== token ||
      state.operationExpiresAt === null ||
      state.operationExpiresAt <= now()
    )
      throw new Error('engine_claim_lost');
  };
  const clearCandidate = 'candidate_version=NULL,candidate_key=NULL,candidate_hash=NULL';
  return {
    get,
    assertOwned,
    initialize(version: string) {
      if (!text(version)) throw new Error('Invalid engine state');
      const current = get();
      if (current.activeVersion !== null) {
        if (current.activeVersion !== version) throw new Error('Engine already initialized');
        return current;
      }
      db.prepare(
        "UPDATE engine_state SET active_version=?,status='never_checked' WHERE singleton=1",
      ).run(version);
      return get();
    },
    claim(kind: 'check' | 'use') {
      return database.transaction(() => {
        const at = now();
        const current = get();
        if (current.operationExpiresAt !== null && current.operationExpiresAt > at) return null;
        if (
          kind === 'check' &&
          (current.candidateVersion !== null ||
            (current.lastCheckedAt !== null && at - current.lastCheckedAt < engineCheckIntervalMs))
        )
          return null;
        const token = randomUUID();
        db.prepare(
          'UPDATE engine_state SET operation_token=?,operation_expires_at=? WHERE singleton=1',
        ).run(token, at + engineOperationLeaseMs);
        if (kind === 'check')
          db.prepare(
            "UPDATE engine_state SET last_checked_at=?,status='checking',failure_code=NULL WHERE singleton=1",
          ).run(at);
        else if (current.status === 'checking')
          db.prepare(
            "UPDATE engine_state SET status='update_failed',failure_code='check_interrupted' WHERE singleton=1",
          ).run();
        return token;
      });
    },
    unlock(token: string) {
      db.prepare(
        'UPDATE engine_state SET operation_token=NULL,operation_expires_at=NULL WHERE singleton=1 AND operation_token=?',
      ).run(token);
    },
    finishCheck(token: string, candidate?: { version: string; key: string; hash: string }) {
      assertOwned(token);
      db.prepare(
        'UPDATE engine_state SET last_check_succeeded_at=last_checked_at,status=?,failure_code=NULL,candidate_version=?,candidate_key=?,candidate_hash=? WHERE singleton=1',
      ).run(
        candidate ? 'candidate_pending_validation' : 'up_to_date',
        candidate?.version ?? null,
        candidate?.key ?? null,
        candidate?.hash ?? null,
      );
    },
    fail(token: string, status: 'update_failed' | 'validation_failed', code: EngineFailure) {
      assertOwned(token);
      db.prepare(
        `UPDATE engine_state SET status=?,failure_code=?,${clearCandidate} WHERE singleton=1`,
      ).run(status, code);
    },
    reconcile(
      token: string,
      pointer: {
        active: { version: string };
        previous: { version: string } | null;
        status: 'never_checked' | 'active' | 'restored';
      },
    ) {
      assertOwned(token);
      const state = get();
      if (
        state.activeVersion === pointer.active.version &&
        state.previousVersion === (pointer.previous?.version ?? null)
      )
        return;
      db.prepare(
        `UPDATE engine_state SET active_version=?,previous_version=?,${clearCandidate},status=?,failure_code=NULL WHERE singleton=1`,
      ).run(pointer.active.version, pointer.previous?.version ?? null, pointer.status);
    },
    // Compatibility entry points for storage clients predating the managed engine provider.
    recordCheck(input: {
      status: 'idle' | 'candidate_ready' | 'failed';
      candidateVersion?: string;
      succeeded: boolean;
    }) {
      if (
        !['idle', 'candidate_ready', 'failed'].includes(input.status) ||
        (input.status === 'candidate_ready') !== text(input.candidateVersion) ||
        (input.status === 'candidate_ready' && !input.succeeded)
      )
        throw new Error('Invalid engine state');
      const checkedAt = now();
      db.prepare(
        'UPDATE engine_state SET last_checked_at=?,last_check_succeeded_at=CASE WHEN ? THEN ? ELSE last_check_succeeded_at END,candidate_version=?,candidate_key=NULL,candidate_hash=NULL,status=?,failure_code=? WHERE singleton=1',
      ).run(
        checkedAt,
        input.succeeded ? 1 : 0,
        checkedAt,
        input.candidateVersion ?? null,
        input.status === 'failed'
          ? 'update_failed'
          : input.status === 'candidate_ready'
            ? 'candidate_pending_validation'
            : 'up_to_date',
        input.status === 'failed' ? 'update_failed' : null,
      );
      return get();
    },
    activateCandidate() {
      if (!get().candidateVersion) throw new Error('No engine candidate');
      db.prepare(
        `UPDATE engine_state SET previous_version=active_version,active_version=candidate_version,${clearCandidate},status='active',failure_code=NULL WHERE singleton=1`,
      ).run();
      return get();
    },
    restorePrevious() {
      if (!get().previousVersion) throw new Error('No previous engine');
      db.prepare(
        `UPDATE engine_state SET active_version=previous_version,previous_version=active_version,${clearCandidate},status='restored',failure_code=NULL WHERE singleton=1`,
      ).run();
      return get();
    },
  };
}
