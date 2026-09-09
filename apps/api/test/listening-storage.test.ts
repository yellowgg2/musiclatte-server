import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { createTestContext } from '../../../tests/support/session-storage-harness.js';
const contexts: Awaited<ReturnType<typeof createTestContext>>[] = [];
afterEach(() => {
  for (const c of contexts.splice(0)) c.cleanup();
});
async function setup() {
  const path = resolve('apps/api/src/storage/listening-repository.ts');
  expect(existsSync(path), 'durable listening repository is required').toBe(true);
  const module: typeof import('../src/storage/listening-repository.js') = await import(path);
  const c = await createTestContext();
  contexts.push(c);
  return {
    ...c,
    module,
    repo: module.createListeningRepository({ database: c.db, clock: () => 5000 }),
  };
}
const event = {
  identityKey: 'a'.repeat(64),
  eventIdHash: 'b'.repeat(64),
  requestHash: 'c'.repeat(64),
  songId: 'synthetic-track',
  startedAt: 1000,
  qualifiedAt: 2000,
};
/** Replayed events and competing claims across connections cannot duplicate a dispatch. */
it('should insert one event and permit exactly one claim across connections', async () => {
  const c = await setup();
  const other = c.module.createListeningRepository({ database: c.open(), clock: () => 5000 });
  const first = c.repo.insert(event);
  expect(other.insert(event)).toEqual(first);
  expect(c.repo.history(event.identityKey).items).toHaveLength(1);
  expect(c.repo.claim(first.sequence)).toBe(true);
  expect(other.claim(first.sequence)).toBe(false);
  expect(other.receipt(event.identityKey, event.eventIdHash)?.status).toBe('dispatching');
  expect(() => other.insert({ ...event, songId: 'other' })).toThrow('Listening conflict');
});
/** Recovery is an explicit startup boundary, never a constructor or live request takeover. */
it('should recover interrupted dispatches as uncertain without retransmission', async () => {
  const c = await setup();
  const stored = c.repo.insert(event);
  c.repo.claim(stored.sequence);
  c.db.close();
  const repo = c.module.createListeningRepository({ database: c.open(), clock: () => 6000 });
  expect(repo.receipt(event.identityKey, event.eventIdHash)?.status).toBe('dispatching');
  expect(repo.recoverDispatching()).toBe(1);
  expect(repo.receipt(event.identityKey, event.eventIdHash)?.status).toBe('uncertain');
  expect(repo.claim(stored.sequence)).toBe(false);
});
/** Query snapshots, exclusive time bounds and deterministic ties isolate each account. */
it('should fence history and ranked counts using immutable high water', async () => {
  const c = await setup();
  c.repo.insert(event);
  c.repo.insert({ ...event, eventIdHash: 'd'.repeat(64), songId: 'second' });
  const history = c.repo.history(event.identityKey, { limit: 1 });
  const top = c.repo.top(event.identityKey, { limit: 1, from: 2000, to: 3000 });
  expect(top.items[0]?.songId).toBe('second');
  c.repo.insert({ ...event, eventIdHash: 'e'.repeat(64), qualifiedAt: 2500 });
  expect(
    c.repo.history(event.identityKey, { highWater: history.highWater, anchor: history.next! })
      .items,
  ).toHaveLength(1);
  expect(
    c.repo.top(event.identityKey, {
      highWater: top.highWater,
      anchor: top.next!,
      from: 2000,
      to: 3000,
    }).items[0]?.count,
  ).toBe(1);
  expect(c.repo.history('f'.repeat(64)).items).toEqual([]);
  expect(c.repo.top(event.identityKey, { to: 2000 }).items).toEqual([]);
});
/** Failure while preparing delivery rolls back the event; saved events are append only. */
it('should atomically persist event and receipt and reject event mutation', async () => {
  const c = await setup();
  c.db.connection.exec(
    "CREATE TRIGGER fail_delivery BEFORE INSERT ON listening_deliveries BEGIN SELECT RAISE(ABORT,'fixture'); END",
  );
  expect(() => c.repo.insert(event)).toThrow();
  expect(c.repo.history(event.identityKey).items).toHaveLength(0);
  c.db.connection.exec('DROP TRIGGER fail_delivery');
  const stored = c.repo.insert(event);
  expect(() =>
    c.db.connection.prepare('UPDATE listening_events SET song_id=?').run('other'),
  ).toThrow();
  expect(c.repo.finish(stored.sequence, 'submitted')).toBe(false);
  expect(c.repo.claim(stored.sequence)).toBe(true);
  expect(c.repo.finish(stored.sequence, 'submitted')).toBe(true);
  expect(c.repo.finish(stored.sequence, 'uncertain')).toBe(false);
});
/** A real backup preserves both records; invalid or missing receipts block restore. */
it('should restore validated events and delivery receipts together', async () => {
  const c = await setup();
  const stored = c.repo.insert(event);
  c.repo.claim(stored.sequence);
  c.repo.finish(stored.sequence, 'submitted');
  const snapshot = join(c.root, 'snapshot');
  await c.createBackup(c.db, c.keyPath, snapshot);
  const target = join(c.root, 'restored');
  await c.restoreBackup(snapshot, target);
  const repo = c.module.createListeningRepository({ database: c.open(target), clock: () => 8000 });
  expect(repo.receipt(event.identityKey, event.eventIdHash)?.status).toBe('submitted');
  const raw = new DatabaseSync(join(snapshot, 'management.sqlite'));
  raw.exec('DELETE FROM listening_deliveries');
  raw.close();
  await expect(c.restoreBackup(snapshot, join(c.root, 'invalid'))).rejects.toThrow(
    'Restore failed',
  );
});
/** Separate Node processes race the same SQLite insert and dispatch compare-and-set. */
it('should serialize real concurrent inserts and claims', async () => {
  const c = await setup();
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const script = `import { openDatabase } from './apps/api/src/storage/database.ts';
import { createListeningRepository } from './apps/api/src/storage/listening-repository.ts';
const database = openDatabase(process.env.LISTENING_TEST_DIRECTORY);
const repo = createListeningRepository({ database, clock: () => 5000 });
const event = JSON.parse(process.env.LISTENING_TEST_EVENT);
const stored = repo.insert(event);
process.stdout.write(JSON.stringify({ sequence: stored.sequence, claimed: repo.claim(stored.sequence) }));
database.close();`;
  const results = await Promise.all(
    [0, 1].map(() =>
      run(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
        env: {
          ...process.env,
          LISTENING_TEST_DIRECTORY: c.data,
          LISTENING_TEST_EVENT: JSON.stringify(event),
        },
      }),
    ),
  );
  const values = results.map((result) => JSON.parse(result.stdout));
  expect(values[0].sequence).toBe(values[1].sequence);
  expect(values.filter((result) => result.claimed)).toHaveLength(1);
  expect(c.repo.history(event.identityKey).items).toHaveLength(1);
});
/** Indexed queries remain account bounded; timing is observed, not an invented latency SLA. */
it('should use account indexes for small and larger synthetic histories', async () => {
  const c = await setup();
  const measurements = [];
  for (const count of [100, 10000]) {
    c.db.transaction(() => {
      const insert = c.db.connection.prepare(
        'INSERT INTO listening_events(identity_key,event_id_hash,request_hash,song_id,started_at,qualified_at,received_at) VALUES(?,?,?,?,?,?,?)',
      );
      const delivery = c.db.connection.prepare(
        "INSERT INTO listening_deliveries(event_sequence,status) VALUES(?,'not_sent')",
      );
      for (let i = count === 100 ? 0 : 100; i < count; i++) {
        const result = insert.run(
          event.identityKey,
          i.toString(16).padStart(64, '0'),
          event.requestHash,
          `fixture-${i % 100}`,
          1000,
          2000 + i,
          20000,
        );
        delivery.run(result.lastInsertRowid);
      }
    });
    const started = performance.now();
    const top = c.repo.top(event.identityKey);
    const elapsedMs = performance.now() - started;
    expect(top.items).toHaveLength(50);
    measurements.push({ events: count, elapsedMs });
  }
  const historyPlan = c.db.connection
    .prepare(
      'EXPLAIN QUERY PLAN SELECT sequence FROM listening_events WHERE identity_key=? AND sequence<=? ORDER BY sequence DESC LIMIT 50',
    )
    .all(event.identityKey, 10000);
  const rangePlan = c.db.connection
    .prepare(
      'EXPLAIN QUERY PLAN SELECT song_id,count(*),max(qualified_at) FROM listening_events WHERE identity_key=? AND qualified_at>=? AND qualified_at<? AND sequence<=? GROUP BY song_id',
    )
    .all(event.identityKey, 1000, 20000, 10000);
  expect(JSON.stringify(historyPlan)).toContain('listening_history_owner');
  expect(JSON.stringify(rangePlan)).toContain('listening_range_owner');
  console.info(JSON.stringify({ syntheticListening: measurements, historyPlan, rangePlan }));
});
