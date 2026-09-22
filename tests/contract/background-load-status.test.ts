import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext } from '../support/session-storage-harness.js';
import {
  collectBackgroundLoadStatus,
  createBackgroundLoadSnapshot,
} from '../../tools/verification/background-load-status.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function digest(path: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return null;
  }
}

function runCli(...args: string[]) {
  return spawnSync(
    resolve('node_modules/.bin/tsx'),
    [resolve('tools/verification/background-load-status.ts'), ...args],
    {
      cwd: resolve('.'),
      encoding: 'utf8',
    },
  );
}

describe('background load aggregate status', () => {
  it('builds an allowlisted identifier-free snapshot from aggregate rows', () => {
    const snapshot = createBackgroundLoadSnapshot({
      schemaVersion: 32,
      databaseBytes: 10,
      walBytes: 20,
      workers: [
        { worker: 'import', status: 'working', heartbeatAgeBucket: 'under_1m', count: 1 },
        { worker: 'metadata', status: 'stopped', heartbeatAgeBucket: 'none', count: 1 },
      ],
      externalRoots: [{ state: 'active', count: 2 }],
      externalObservations: [{ state: 'ready', count: 40 }],
      curationRuns: [{ status: 'ready', count: 1 }],
      curationQueue: [{ status: 'error', count: 3 }],
      failures: { unresolved: 3, resolved: 7 },
      resolvedErrorCodes: [{ code: 'unsupported_format', count: 7 }],
    });

    expect(snapshot).toEqual({
      schemaVersion: 32,
      storageBytes: { database: 10, wal: 20 },
      workers: {
        import: { states: { working: 1 }, heartbeatAgeBuckets: { under_1m: 1 } },
        metadata: { states: { stopped: 1 }, heartbeatAgeBuckets: { none: 1 } },
      },
      external: { roots: { active: 2 }, observations: { ready: 40 } },
      curation: {
        runs: { ready: 1 },
        queue: { error: 3 },
        failures: {
          unresolved: 3,
          resolved: 7,
          resolvedErrorCodes: { unsupported_format: 7 },
        },
      },
    });
    expect(Object.keys(snapshot)).toEqual([
      'schemaVersion',
      'storageBytes',
      'workers',
      'external',
      'curation',
    ]);
  });

  it('reads only aggregate state and leaves the database and WAL unchanged', async () => {
    const c = await createTestContext();
    roots.push(c.root);
    const sentinel = 'PRIVATE-SENTINEL-account-library-track-session-path';
    c.db.connection.exec('PRAGMA wal_autocheckpoint=0');
    c.db.connection
      .prepare("UPDATE worker_state SET worker_id=?,status='working',heartbeat_at=99950")
      .run(`${sentinel}-import-worker`);
    c.db.connection
      .prepare("UPDATE metadata_worker_state SET worker_id=?,status='idle',heartbeat_at=100")
      .run(`${sentinel}-metadata-worker`);
    c.db.connection
      .prepare(
        'INSERT INTO external_watch_owners(library_id,account_directory,username,identity_key,instance_id,policy_revision,updated_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        `${sentinel}-library`,
        `${sentinel}-account`,
        `${sentinel}-user`,
        'a'.repeat(64),
        sentinel,
        1,
        1,
      );
    c.db.connection
      .prepare(
        "INSERT INTO external_watch_roots(library_id,account_directory,identity_key,state,scan_completed_at,next_reconcile_at,updated_at) VALUES(?,?,?,'active',1,2,1)",
      )
      .run(`${sentinel}-library`, `${sentinel}-account`, 'a'.repeat(64));
    c.db.connection
      .prepare(
        "INSERT INTO external_file_observations(library_id,relative_file_key,account_directory,identity_key,state,first_seen_at,last_seen_at,next_attempt_at) VALUES(?,?,?,?,'baseline',1,1,1)",
      )
      .run(`${sentinel}-library`, `${sentinel}/song.mp3`, `${sentinel}-account`, 'a'.repeat(64));
    c.db.connection
      .prepare(
        "INSERT INTO curation_inventory_runs(library_id,generation,status,last_reconciled_at,checkpoint_json) VALUES(?,?,'ready',1000,'{}')",
      )
      .run(`${sentinel}-library`, `${sentinel}-generation`);
    c.db.connection
      .prepare(
        "INSERT INTO curation_inventory_failures(library_id,kind,opaque_id,failure_count,last_error_code,last_cause,first_failed_at,last_failed_at,resolved_at) VALUES(?,'track',?,2,'unsupported_format','upstream',1,2,1000)",
      )
      .run(`${sentinel}-library`, `${sentinel}-track`);
    const path = join(c.data, 'management.sqlite');
    const walPath = `${path}-wal`;
    const before = { database: digest(path), wal: digest(walPath) };

    const status = collectBackgroundLoadStatus(path, 100000);

    expect(status).toMatchObject({
      schemaVersion: 32,
      workers: {
        import: { states: { working: 1 }, heartbeatAgeBuckets: { under_1m: 1 } },
        metadata: { states: { idle: 1 }, heartbeatAgeBuckets: { under_15m: 1 } },
      },
      external: { roots: { active: 1 }, observations: { baseline: 1 } },
      curation: {
        runs: { ready: 1 },
        failures: {
          unresolved: 0,
          resolved: 1,
          resolvedErrorCodes: { unsupported_format: 1 },
        },
      },
    });
    expect(JSON.stringify(status)).not.toContain(sentinel);
    expect({ database: digest(path), wal: digest(walPath) }).toEqual(before);
    const cli = runCli(path);
    expect(cli).toMatchObject({ status: 0, stderr: '' });
    expect(JSON.parse(cli.stdout)).toMatchObject({
      schemaVersion: status.schemaVersion,
      storageBytes: status.storageBytes,
      external: status.external,
      curation: status.curation,
    });
    expect(cli.stdout).not.toContain(path);
  });

  it('fails closed for missing arguments, unavailable files and foreign schemas without echoing paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'musiclatte-background-status-'));
    roots.push(root);
    const unavailable = join(root, 'PRIVATE-unavailable.sqlite');
    const foreign = join(root, 'PRIVATE-foreign.sqlite');
    mkdirSync(root, { recursive: true });
    const db = new DatabaseSync(foreign);
    db.exec('CREATE TABLE foreign_data(secret TEXT) STRICT');
    db.close();
    writeFileSync(join(root, 'sentinel.txt'), 'PRIVATE');

    for (const [result, code, secret] of [
      [runCli(), 'missing_argument', root],
      [runCli(unavailable), 'storage_unavailable', unavailable],
      [runCli(foreign), 'unsupported_schema', foreign],
    ] as const) {
      expect(result.status).not.toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ error: code });
      expect(`${result.stdout}${result.stderr}`).not.toContain(secret);
    }
  });
});
