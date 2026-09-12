import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { createTestContext } from '../../../tests/support/session-storage-harness.js';
const contexts: Awaited<ReturnType<typeof createTestContext>>[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) ctx.cleanup();
});
async function makeSUT() {
  const ctx = await createTestContext();
  contexts.push(ctx);
  const path = resolve('apps/api/src/storage/mix-repository.ts');
  expect(existsSync(path), 'durable mix repository must exist').toBe(true);
  const module: typeof import('../src/storage/mix-repository.js') = await import(path);
  return {
    ...ctx,
    repository: module.createMixRepository({ database: ctx.db, clock: () => 1000 }),
    module,
  };
}
const identityKey = 'a'.repeat(64);
const request = {
  identityKey,
  operationIdHash: 'b'.repeat(64),
  requestHash: 'c'.repeat(64),
  kind: 'create' as const,
  input: { name: 'Mix', conditions: { size: 50 } },
};
/** Account-scoped receipt replay returns the original result after a connection is reopened. */
it('should persist conditions and replay while isolating accounts', async () => {
  const c = await makeSUT();
  const created = c.repository.mutate(request);
  expect(mixOf(created)).toMatchObject({
    name: 'Mix',
    revision: 1,
    createdAt: 1000,
    conditions: { size: 50 },
  });
  c.db.close();
  const repo = c.module.createMixRepository({ database: c.open(), clock: () => 2000 });
  expect(repo.mutate(request)).toEqual(created);
  expect(repo.get('d'.repeat(64), mixOf(created).id)).toBeNull();
  expect(() => repo.mutate({ ...request, requestHash: 'e'.repeat(64) })).toThrow('Mix conflict');
});
/** Optimistic revisions and deletion receipts make retries safe across updates and removals. */
it('should reject stale revisions and preserve deletion replay', async () => {
  const c = await makeSUT();
  const initial = mixOf(c.repository.mutate(request));
  const patch = {
    ...request,
    kind: 'update' as const,
    id: initial.id,
    revision: 1,
    operationIdHash: 'd'.repeat(64),
    input: { name: 'Updated', conditions: { size: 4 } },
  };
  expect(mixOf(c.repository.mutate(patch)).revision).toBe(2);
  expect(() => c.repository.mutate({ ...patch, operationIdHash: 'e'.repeat(64) })).toThrow(
    'Mix conflict',
  );
  const deletion = {
    identityKey,
    requestHash: request.requestHash,
    kind: 'delete' as const,
    id: initial.id,
    revision: 2,
    operationIdHash: 'f'.repeat(64),
  };
  expect(c.repository.mutate(deletion)).toEqual({ deleted: true, id: initial.id });
  expect(c.repository.mutate(deletion)).toEqual({ deleted: true, id: initial.id });
  expect(c.repository.get(identityKey, initial.id)).toBeNull();
});
/** An insertion fence excludes later inserts even when timestamps tie or clocks move backwards. */
it('should fence paginated membership and retain immutable sort keys', async () => {
  const c = await makeSUT();
  const first = mixOf(c.repository.mutate(request));
  const page = c.repository.list(identityKey, { limit: 1 });
  c.repository.mutate({ ...request, operationIdHash: 'd'.repeat(64) });
  expect(c.repository.list(identityKey, { limit: 100, highWater: page.highWater }).items).toEqual([
    first,
  ]);
  expect(c.repository.list('e'.repeat(64), {}).items).toEqual([]);
});
/** Mix content and receipts survive a real backup, and malformed persisted payloads cannot restore. */
it('should validate mix rows and receipts during backup and restore', async () => {
  const c = await makeSUT();
  const created = c.repository.mutate(request);
  const snapshot = join(c.root, 'snapshot');
  await c.createBackup(c.db, c.keyPath, snapshot);
  const restored = join(c.root, 'restored');
  await c.restoreBackup(snapshot, restored);
  expect(
    c.module.createMixRepository({ database: c.open(restored), clock: () => 4000 }).mutate(request),
  ).toEqual(created);
  const raw = new DatabaseSync(join(snapshot, 'management.sqlite'));
  raw.prepare("UPDATE saved_mixes SET conditions_json='{}'").run();
  raw.close();
  await expect(c.restoreBackup(snapshot, join(c.root, 'invalid'))).rejects.toThrow(
    'Restore failed',
  );
});
/** Existing v12 and current v19 databases migrate additively and reopen idempotently. */
it.each([12, 19, 20])(
  'should migrate version %i without changing the instance',
  async (version) => {
    const c = await makeSUT();
    const dir = join(c.root, `v${version}`);
    mkdirSync(dir);
    const raw = new DatabaseSync(join(dir, 'management.sqlite'));
    const migrations = resolve('apps/api/src/storage/migrations');
    for (const file of readdirSync(migrations).sort().slice(0, version))
      raw.exec(readFileSync(join(migrations, file), 'utf8'));
    raw.close();
    const one = c.open(dir);
    const two = c.open(dir);
    expect(one.connection.prepare('PRAGMA user_version').get()?.user_version).toBe(26);
    expect(two.connection.prepare('SELECT count(*) AS count FROM saved_mixes').get()?.count).toBe(
      0,
    );
  },
);

/** Receipt write failure rolls back the resource, so retry can safely create exactly one mix. */
it('should rollback a failed receipt transaction', async () => {
  const c = await makeSUT();
  c.db.connection.exec(
    "CREATE TRIGGER fail_mix_receipt BEFORE INSERT ON mix_operations BEGIN SELECT RAISE(ABORT, 'test rollback'); END;",
  );
  expect(() => c.repository.mutate(request)).toThrow();
  expect(c.repository.list(identityKey).items).toEqual([]);
  c.db.connection.exec('DROP TRIGGER fail_mix_receipt');
  expect(c.repository.mutate(request)).toHaveProperty('mix');
  expect(c.repository.list(identityKey).items).toHaveLength(1);
});

function mixOf(result: import('../src/storage/mix-repository.js').MixMutationResult) {
  if (!('mix' in result)) throw new Error('Expected mix result');
  return result.mix;
}
