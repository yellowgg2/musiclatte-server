import {
  mkdirSync,
  realpathSync,
  existsSync,
  readFileSync,
  chmodSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext } from '../../../tests/support/session-storage-harness.js';
import { createEngineProcessFixture } from '../../../tests/support/engine-process-fixture.js';
import { createEngineProvider } from '../src/engine/provider.js';
import { createEngineRequestRepository } from '../src/storage/engine-request-repository.js';
import { engineCheckIntervalMs } from '../src/storage/engine-repository.js';

describe('durable engine requests', () => {
  const cleanups: (() => void)[] = [];
  async function makeSUT(mode = 'ok') {
    const c = await createTestContext();
    cleanups.push(c.cleanup);
    const root = realpathSync(c.root);
    const fixture = createEngineProcessFixture(root, mode);
    const engineRoot = join(root, 'engines');
    mkdirSync(engineRoot, { mode: 0o700 });
    let now = 1000;
    const options = { database: c.db, clock: () => now, root: engineRoot, ...fixture };
    const provider = createEngineProvider(options);
    await provider.initialize();
    const repository = createEngineRequestRepository(options);
    const path = resolve('apps/api/src/engine/request-worker.ts');
    expect(existsSync(path), 'worker must consume durable requests outside the HTTP handler').toBe(
      true,
    );
    const module = await import(path);
    const worker: { processNext: () => Promise<boolean> } = module.createEngineRequestWorker({
      ...options,
      provider,
    });
    return {
      c,
      options,
      provider,
      repository,
      worker,
      setNow: (value: number) => {
        now = value;
        c.setNow(value);
      },
    };
  }
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  /** Only a worker consumes the persisted check; concurrent consumers and restart cannot duplicate it. */
  it('should consume a check exactly once and preserve the daily budget', async () => {
    const s = await makeSUT();
    s.repository.request('check_now');
    expect(s.c.engines.get().lastCheckedAt).toBeNull();
    expect(await Promise.all([s.worker.processNext(), s.worker.processNext()])).toEqual([
      true,
      false,
    ]);
    expect(s.c.engines.get()).toMatchObject({
      activeVersion: 'nightly-1',
      candidateVersion: 'nightly-2',
      status: 'candidate_pending_validation',
      lastCheckedAt: 1000,
    });
    expect(s.repository.get()?.status).toBe('completed');
    s.repository.request('check_now');
    expect(await s.worker.processNext()).toBe(false);
    expect(
      createEngineRequestRepository({ ...s.options, database: s.c.open() }).get()?.status,
    ).toBe('completed');
  });

  /** Restore preserves running bytes, pins its target, and replays never alternate active/previous. */
  it('should restore only the next-job selection and remain idempotent after subsequent checks', async () => {
    const s = await makeSUT('no-update');
    // Install a genuine second validated candidate using the existing provider fixture lifecycle.
    const upgraded = await makeSUT();
    await upgraded.provider.checkDue();
    const running = await upgraded.provider.acquire('abcdefghijk');
    const bytes = readFileSync(running.executable);
    upgraded.repository.request('restore_previous');
    expect(upgraded.c.engines.get().activeVersion).toBe('nightly-2');
    expect(await upgraded.worker.processNext()).toBe(true);
    expect(upgraded.c.engines.get()).toMatchObject({
      activeVersion: 'nightly-1',
      previousVersion: 'nightly-2',
      status: 'restored',
    });
    expect(readFileSync(running.executable)).toEqual(bytes);
    expect(running.version).toBe('nightly-2');
    upgraded.repository.request('restore_previous');
    expect(await upgraded.worker.processNext()).toBe(false);
    // A later status change must not erase the successful restore receipt.
    upgraded.c.engines.recordCheck({ status: 'idle', succeeded: true });
    upgraded.repository.request('restore_previous');
    expect(await upgraded.worker.processNext()).toBe(false);
    running.release();
    s.repository.request('check_now');
    await s.worker.processNext();
    expect(s.c.engines.get().status).toBe('up_to_date');
  });

  /** Corrupt previous executables fail in the worker without exposing their contents or changing active. */
  it('should reject an invalid previous file and retain current selection', async () => {
    const s = await makeSUT();
    const previous = await s.provider.acquire();
    await s.provider.checkDue();
    const active = await s.provider.acquire('abcdefghijk');
    chmodSync(previous.executable, 0o700);
    writeFileSync(previous.executable, 'synthetic-private-stderr');
    s.repository.request('restore_previous');
    expect(await s.worker.processNext()).toBe(true);
    expect(s.repository.get()?.status).toBe('failed');
    expect(s.c.engines.get().activeVersion).toBe('nightly-2');
    expect(JSON.stringify(s.repository.get())).not.toContain('synthetic-private-stderr');
    previous.release();
    active.release();
  });

  /** A crash after selection commit is replayed as completion rather than a second swap. */
  it('should recover an expired restore receipt after the selection committed', async () => {
    const s = await makeSUT();
    await s.provider.checkDue();
    (await s.provider.acquire('abcdefghijk')).release();
    s.repository.request('restore_previous');
    const abandoned = s.repository.claim()!;
    await s.provider.restorePrevious();
    s.setNow(122_000);
    expect(await s.worker.processNext()).toBe(true);
    expect(s.c.engines.get().activeVersion).toBe('nightly-1');
    expect(s.repository.get()?.status).toBe('completed');
    s.repository.finish(abandoned.owner, 'failed');
    expect(s.repository.get()?.status).toBe('completed');
  });

  /** The queue rejects incompatible concurrent actions and stale restores rather than guessing targets. */
  it('should reject conflicting intent and avoid restoring a changed selection', async () => {
    const s = await makeSUT();
    s.repository.request('check_now');
    expect(() => s.repository.request('restore_previous')).toThrow('engine_conflict');
    await s.worker.processNext();
    (await s.provider.acquire('abcdefghijk')).release();
    s.repository.request('restore_previous');
    // A different authoritative selection superseded the requested pair.
    s.c.engines.recordCheck({ status: 'idle', succeeded: true });
    const pointerPath = join(s.options.root, 'active.json');
    const pointer = JSON.parse(readFileSync(pointerPath, 'utf8'));
    pointer.previous = null;
    writeFileSync(pointerPath, JSON.stringify(pointer), { mode: 0o600 });
    expect(await s.worker.processNext()).toBe(true);
    expect(s.repository.get()?.status).toBe('failed');
    expect(s.c.engines.get().activeVersion).toBe('nightly-2');
  });

  /** Failed checks still consume the 24-hour allowance, without catch-up loops or process storms. */
  it('should retain failed check budget and allow one due retry', async () => {
    const s = await makeSUT('check-failure');
    s.repository.request('check_now');
    await s.worker.processNext();
    expect(s.c.engines.get().status).toBe('update_failed');
    s.repository.request('check_now');
    expect(await s.worker.processNext()).toBe(false);
    s.setNow(1000 + engineCheckIntervalMs);
    s.repository.request('check_now');
    expect(await s.worker.processNext()).toBe(true);
    expect(s.c.engines.get().lastCheckedAt).toBe(1000 + engineCheckIntervalMs);
  });
  /** The additive migration preserves v7 selection/session rows and backs up pending action receipts. */
  it('should migrate v7 without changing existing rows and restore the durable mailbox', async () => {
    const s = await makeSUT();
    const proof = { username: 'synthetic-manager', t: 'synthetic-token', s: 'synthetic-salt' };
    const session = s.c.sessions.create(proof);
    const before = s.c.engines.get();
    // Remove only the empty newer ledgers to recreate the historical v7 fixture.
    s.c.db.connection.exec(`
      DROP TABLE metadata_rechecks;
      DROP TABLE metadata_item_evidence;
      DROP TABLE metadata_worker_state;
      DROP TABLE metadata_changes;
      DROP TABLE metadata_cover_uploads;
      DROP TABLE metadata_file_locks;
      DROP TABLE metadata_attempts;
      DROP TABLE metadata_backup_previews;
      DROP TABLE metadata_backups;
      DROP TABLE metadata_items;
      DROP TABLE metadata_jobs;
      DROP TABLE engine_requests;
      ALTER TABLE import_jobs DROP COLUMN account_directory;
      DROP TABLE scan_schedule;
      DROP TABLE curation_snapshot_items;
      DROP TABLE curation_snapshots;
      DROP TABLE curation_inventory_queue;
      DROP TABLE curation_inventory_runs;
      DROP TABLE curation_operations;
      DROP TABLE curation_claim_items;
      DROP TABLE curation_claims;
      DROP TABLE curation_events;
      DROP TABLE curation_field_states;
      DROP TABLE curation_receipts;
      DROP TABLE curation_tracks;
      DROP TABLE curation_state;
      DROP TABLE access_tokens;
      DROP TABLE automation_state;
      PRAGMA user_version=7;
    `);
    const migrated = s.c.open();
    expect(migrated.connection.prepare('PRAGMA user_version').get()).toEqual({ user_version: 17 });
    expect(s.c.enginesFor(migrated).get()).toEqual(before);
    expect(s.c.sessionsFor(migrated).find(session.token)?.proof).toEqual(proof);
    const mailbox = createEngineRequestRepository({ ...s.options, database: migrated });
    mailbox.request('check_now');
    const snapshot = join(s.c.root, 'snapshot');
    await s.c.createBackup(migrated, s.c.keyPath, snapshot);
    const restoredRoot = join(s.c.root, 'restored');
    await s.c.restoreBackup(snapshot, restoredRoot);
    const restored = createEngineRequestRepository({
      ...s.options,
      database: s.c.open(restoredRoot),
    });
    expect(restored.get()).toEqual(mailbox.get());
    expect(restored.claim()?.action).toBe('check_now');
    expect(restored.claim()).toBeUndefined();
  });
});
