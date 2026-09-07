import type { DatabaseSync } from 'node:sqlite';
import type { ManagementDatabase } from './database.js';

export type EngineStatus = 'uninitialized' | 'idle' | 'checking' | 'candidate_ready' | 'failed';
export interface EngineState {
  lastCheckedAt: number | null;
  lastCheckSucceededAt: number | null;
  activeVersion: string | null;
  candidateVersion: string | null;
  previousVersion: string | null;
  status: EngineStatus;
}
const statuses = new Set<EngineStatus>([
  'uninitialized',
  'idle',
  'checking',
  'candidate_ready',
  'failed',
]);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
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
  };
  if (
    !(state.lastCheckedAt === null || time(state.lastCheckedAt)) ||
    !(state.lastCheckSucceededAt === null || time(state.lastCheckSucceededAt)) ||
    !(state.activeVersion === null || text(state.activeVersion)) ||
    !(state.candidateVersion === null || text(state.candidateVersion)) ||
    !(state.previousVersion === null || text(state.previousVersion)) ||
    typeof state.status !== 'string' ||
    !statuses.has(state.status as EngineStatus)
  )
    throw new Error('Storage unavailable');
  return state as EngineState;
}

export function validateEngineState(database: DatabaseSync): void {
  decode(database.prepare('SELECT * FROM engine_state WHERE singleton=1').get());
}

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
  return {
    get,
    initialize(version: string) {
      if (!text(version)) throw new Error('Invalid engine state');
      const current = get();
      if (current.status !== 'uninitialized' && current.activeVersion !== version)
        throw new Error('Engine already initialized');
      db.prepare("UPDATE engine_state SET active_version=?,status='idle' WHERE singleton=1").run(
        version,
      );
      return get();
    },
    recordCheck(input: {
      status: 'idle' | 'candidate_ready' | 'failed';
      candidateVersion?: string;
      succeeded: boolean;
    }) {
      if (
        !statuses.has(input.status) ||
        (input.status === 'candidate_ready') !== text(input.candidateVersion) ||
        (input.status === 'candidate_ready' && !input.succeeded)
      )
        throw new Error('Invalid engine state');
      const checkedAt = now();
      db.prepare(
        'UPDATE engine_state SET last_checked_at=?,last_check_succeeded_at=CASE WHEN ? THEN ? ELSE last_check_succeeded_at END,candidate_version=?,status=? WHERE singleton=1',
      ).run(
        checkedAt,
        input.succeeded ? 1 : 0,
        checkedAt,
        input.candidateVersion ?? null,
        input.status,
      );
      return get();
    },
    activateCandidate() {
      const current = get();
      if (!current.candidateVersion) throw new Error('No engine candidate');
      db.prepare(
        "UPDATE engine_state SET previous_version=active_version,active_version=candidate_version,candidate_version=NULL,status='idle' WHERE singleton=1",
      ).run();
      return get();
    },
    restorePrevious() {
      const current = get();
      if (!current.previousVersion) throw new Error('No previous engine');
      db.prepare(
        "UPDATE engine_state SET active_version=previous_version,previous_version=active_version,candidate_version=NULL,status='idle' WHERE singleton=1",
      ).run();
      return get();
    },
  };
}
