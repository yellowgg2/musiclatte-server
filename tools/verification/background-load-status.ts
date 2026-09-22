import { existsSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_VERSION, validateSchema } from '../../apps/api/src/storage/database.js';

type CountRow = { state?: string; status?: string; count: number };
type WorkerAggregate = {
  worker: 'import' | 'metadata';
  status: string;
  heartbeatAgeBucket: string;
  count: number;
};

export interface BackgroundLoadAggregateInput {
  schemaVersion: number;
  databaseBytes: number;
  walBytes: number;
  workers: readonly WorkerAggregate[];
  externalRoots: readonly { state: string; count: number }[];
  externalObservations: readonly { state: string; count: number }[];
  curationRuns: readonly { status: string; count: number }[];
  curationQueue: readonly { status: string; count: number }[];
  failures: { unresolved: number; resolved: number };
  resolvedErrorCodes: readonly { code: string; count: number }[];
}

function countMap(rows: readonly { state?: string; status?: string; count: number }[]) {
  return Object.fromEntries(
    rows.map((row) => [String(row.state ?? row.status), Number(row.count)]),
  );
}

export function createBackgroundLoadSnapshot(input: BackgroundLoadAggregateInput) {
  const workers = Object.fromEntries(
    (['import', 'metadata'] as const).map((worker) => {
      const rows = input.workers.filter((row) => row.worker === worker);
      return [
        worker,
        {
          states: Object.fromEntries(rows.map((row) => [row.status, row.count])),
          heartbeatAgeBuckets: Object.fromEntries(
            rows.map((row) => [row.heartbeatAgeBucket, row.count]),
          ),
        },
      ];
    }),
  );
  return {
    schemaVersion: input.schemaVersion,
    storageBytes: { database: input.databaseBytes, wal: input.walBytes },
    workers,
    external: {
      roots: countMap(input.externalRoots),
      observations: countMap(input.externalObservations),
    },
    curation: {
      runs: countMap(input.curationRuns),
      queue: countMap(input.curationQueue),
      failures: {
        unresolved: input.failures.unresolved,
        resolved: input.failures.resolved,
        resolvedErrorCodes: Object.fromEntries(
          input.resolvedErrorCodes.map((row) => [row.code, row.count]),
        ),
      },
    },
  };
}

function fileBytes(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function heartbeatAgeBucket(now: number, heartbeatAt: unknown): string {
  if (typeof heartbeatAt !== 'number') return 'none';
  const age = Math.max(0, now - heartbeatAt);
  if (age < 60_000) return 'under_1m';
  if (age < 900_000) return 'under_15m';
  if (age < 3_600_000) return 'under_1h';
  return 'over_1h';
}

function grouped(db: DatabaseSync, table: string, column: 'state' | 'status'): CountRow[] {
  return db
    .prepare(
      `SELECT ${column},count(*) AS count FROM ${table} GROUP BY ${column} ORDER BY ${column}`,
    )
    .all() as CountRow[];
}

export function collectBackgroundLoadStatus(databasePath: string, now = Date.now()) {
  if (!existsSync(databasePath) || !statSync(databasePath).isFile())
    throw new Error('storage_unavailable');
  const db = new DatabaseSync(databasePath, { readOnly: true, timeout: 100 });
  try {
    try {
      validateSchema(db);
    } catch (error) {
      if (error instanceof Error && error.message === 'Unsupported storage schema')
        throw new Error('unsupported_schema');
      throw error;
    }
    const workers = (
      [
        ['import', 'worker_state'],
        ['metadata', 'metadata_worker_state'],
      ] as const
    ).flatMap(([worker, table]) =>
      (
        db.prepare(`SELECT status,heartbeat_at FROM ${table}`).all() as Array<{
          status: string;
          heartbeat_at: number | null;
        }>
      ).map((row) => ({
        worker,
        status: row.status,
        heartbeatAgeBucket: heartbeatAgeBucket(now, row.heartbeat_at),
        count: 1,
      })),
    );
    const failureCounts = db
      .prepare(
        'SELECT sum(CASE WHEN resolved_at IS NULL THEN 1 ELSE 0 END) AS unresolved,sum(CASE WHEN resolved_at IS NOT NULL THEN 1 ELSE 0 END) AS resolved FROM curation_inventory_failures',
      )
      .get() as { unresolved: number | null; resolved: number | null };
    const resolvedErrorCodes = (
      db
        .prepare(
          'SELECT last_error_code AS code,count(*) AS count FROM curation_inventory_failures WHERE resolved_at IS NOT NULL GROUP BY last_error_code ORDER BY last_error_code',
        )
        .all() as Array<{ code: string; count: number }>
    ).map((row) => ({
      code: /^[a-z][a-z0-9_]{0,63}$/.test(row.code) ? row.code : 'other',
      count: Number(row.count),
    }));
    if (db.prepare('SELECT total_changes() AS count').get()?.count !== 0)
      throw new Error('storage_unavailable');
    return createBackgroundLoadSnapshot({
      schemaVersion: SCHEMA_VERSION,
      databaseBytes: fileBytes(databasePath),
      walBytes: fileBytes(`${databasePath}-wal`),
      workers,
      externalRoots: grouped(db, 'external_watch_roots', 'state').map((row) => ({
        state: String(row.state),
        count: Number(row.count),
      })),
      externalObservations: grouped(db, 'external_file_observations', 'state').map((row) => ({
        state: String(row.state),
        count: Number(row.count),
      })),
      curationRuns: grouped(db, 'curation_inventory_runs', 'status').map((row) => ({
        status: String(row.status),
        count: Number(row.count),
      })),
      curationQueue: grouped(db, 'curation_inventory_queue', 'status').map((row) => ({
        status: String(row.status),
        count: Number(row.count),
      })),
      failures: {
        unresolved: Number(failureCounts.unresolved ?? 0),
        resolved: Number(failureCounts.resolved ?? 0),
      },
      resolvedErrorCodes,
    });
  } finally {
    db.close();
  }
}

function runCli(): void {
  if (process.argv.length !== 3) {
    process.stdout.write(`${JSON.stringify({ error: 'missing_argument' })}\n`);
    process.exitCode = 2;
    return;
  }
  try {
    process.stdout.write(`${JSON.stringify(collectBackgroundLoadStatus(process.argv[2]!))}\n`);
  } catch (error) {
    const code =
      error instanceof Error &&
      ['storage_unavailable', 'unsupported_schema'].includes(error.message)
        ? error.message
        : 'storage_unavailable';
    process.stdout.write(`${JSON.stringify({ error: code })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) runCli();
