import { randomUUID } from 'node:crypto';
import type { EngineActionRequest } from '@musiclatte/contracts';
import type { ManagementDatabase } from './database.js';
import {
  createEngineRepository,
  engineCheckIntervalMs,
  engineOperationLeaseMs,
} from './engine-repository.js';

export interface EngineRequest {
  action: EngineActionRequest['action'];
  activeVersion: string;
  previousVersion: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  restoredActiveVersion: string | null;
  restoredPreviousVersion: string | null;
  owner: string | null;
  expiresAt: number | null;
}
/** A bounded singleton mailbox; all admission and claims are synchronous SQLite transactions. */
export function createEngineRequestRepository(options: {
  database: ManagementDatabase;
  clock: () => number;
}) {
  const { database } = options;
  const db = database.connection;
  const engine = createEngineRepository(options);
  const now = () => {
    const at = options.clock();
    if (!Number.isSafeInteger(at) || at < 0) throw new Error('Storage unavailable');
    return at;
  };
  const get = (): EngineRequest | undefined => {
    const row = db.prepare('SELECT * FROM engine_requests WHERE singleton=1').get();
    if (!row) return undefined;
    return {
      restoredActiveVersion: row.restored_active_version,
      restoredPreviousVersion: row.restored_previous_version,
      action: row.action,
      activeVersion: row.active_version,
      previousVersion: row.previous_version,
      status: row.status,
      owner: row.owner,
      expiresAt: row.expires_at,
    } as EngineRequest;
  };
  return {
    get,
    request(action: EngineActionRequest['action']) {
      return database.transaction(() => {
        const at = now();
        const state = engine.get();
        const old = get();
        if (old && ['pending', 'running'].includes(old.status)) {
          if (old.action === action) return;
          throw new Error('engine_conflict');
        }
        if (action === 'check_now') {
          // Manual intent shares the persisted daily budget, including failed attempts.
          if (
            state.status === 'checking' ||
            state.candidateVersion !== null ||
            (state.lastCheckedAt !== null && at - state.lastCheckedAt < engineCheckIntervalMs)
          )
            return;
        } else {
          if (!state.previousVersion) throw new Error('engine_conflict');
          if (
            old?.action === 'restore_previous' &&
            old.status === 'failed' &&
            old.activeVersion === state.activeVersion &&
            old.previousVersion === state.previousVersion
          )
            throw new Error('engine_conflict');
          // An exact action body has no replay key: a restored selection is never toggled back.
          if (
            state.status === 'restored' ||
            (old?.restoredActiveVersion === state.activeVersion &&
              old.restoredPreviousVersion === state.previousVersion)
          )
            return;
          if (state.operationExpiresAt !== null && state.operationExpiresAt > at)
            throw new Error('engine_conflict');
        }
        if (!state.activeVersion) throw new Error('engine_unavailable');
        db.prepare(
          `INSERT INTO engine_requests(singleton,action,active_version,previous_version,requested_at,status)
          VALUES(1,?,?,?,?, 'pending') ON CONFLICT(singleton) DO UPDATE SET action=excluded.action,active_version=excluded.active_version,previous_version=excluded.previous_version,requested_at=excluded.requested_at,status='pending',owner=NULL,expires_at=NULL`,
        ).run(action, state.activeVersion, state.previousVersion, at);
      });
    },
    claim() {
      return database.transaction(() => {
        const at = now();
        const row = get();
        if (
          !row ||
          ['completed', 'failed'].includes(row.status) ||
          (row.expiresAt !== null && row.expiresAt > at)
        )
          return undefined;
        const owner = randomUUID();
        db.prepare(
          "UPDATE engine_requests SET status='running',owner=?,expires_at=? WHERE singleton=1",
        ).run(owner, at + engineOperationLeaseMs);
        return { ...row, owner };
      });
    },
    finish(owner: string, status: 'completed' | 'failed' | 'pending') {
      db.prepare(
        `UPDATE engine_requests SET status=?,
        restored_active_version=CASE WHEN action='restore_previous' AND ?='completed' THEN previous_version ELSE restored_active_version END,
        restored_previous_version=CASE WHEN action='restore_previous' AND ?='completed' THEN active_version ELSE restored_previous_version END,
        owner=NULL,expires_at=NULL WHERE singleton=1 AND owner=? AND expires_at>?`,
      ).run(status, status, status, owner, now());
    },
  };
}
