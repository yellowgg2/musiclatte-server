import type { DatabaseSync } from 'node:sqlite';
import type { ManagementDatabase } from './database.js';

export type WorkerStatus = 'stopped' | 'idle' | 'working' | 'unhealthy';
export interface WorkerState {
  workerId: string | null;
  status: WorkerStatus;
  heartbeatAt: number | null;
  activeItemId: string | null;
}
const statuses = new Set<WorkerStatus>(['stopped', 'idle', 'working', 'unhealthy']);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const time = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function decode(row: Record<string, unknown> | undefined): WorkerState {
  if (!row) throw new Error('Storage unavailable');
  const state = {
    workerId: row.worker_id,
    status: row.status,
    heartbeatAt: row.heartbeat_at,
    activeItemId: row.active_item_id,
  };
  if (
    !(state.workerId === null || text(state.workerId)) ||
    typeof state.status !== 'string' ||
    !statuses.has(state.status as WorkerStatus) ||
    !(state.heartbeatAt === null || time(state.heartbeatAt)) ||
    !(state.activeItemId === null || text(state.activeItemId))
  )
    throw new Error('Storage unavailable');
  return state as WorkerState;
}

export function validateWorkerState(database: DatabaseSync): void {
  decode(database.prepare('SELECT * FROM worker_state WHERE singleton=1').get());
}

export function createWorkerStateRepository(options: {
  database: ManagementDatabase;
  clock: () => number;
}) {
  const { database, clock } = options;
  const db = database.connection;
  const get = () => decode(db.prepare('SELECT * FROM worker_state WHERE singleton=1').get());
  return {
    get,
    heartbeat(input: {
      workerId: string;
      status: Exclude<WorkerStatus, 'stopped'>;
      activeItemId?: string;
    }) {
      if (
        !text(input.workerId) ||
        !statuses.has(input.status) ||
        (input.status === 'working') !== text(input.activeItemId)
      )
        throw new Error('Invalid worker state');
      const heartbeatAt = clock();
      if (!time(heartbeatAt)) throw new Error('Invalid worker state');
      db.prepare(
        'UPDATE worker_state SET worker_id=?,status=?,heartbeat_at=?,active_item_id=? WHERE singleton=1',
      ).run(input.workerId, input.status, heartbeatAt, input.activeItemId ?? null);
      return get();
    },
    stop() {
      db.prepare(
        "UPDATE worker_state SET worker_id=NULL,status='stopped',heartbeat_at=NULL,active_item_id=NULL WHERE singleton=1",
      ).run();
      return get();
    },
  };
}
