import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext } from '../../../tests/support/session-storage-harness.js';

let context: Awaited<ReturnType<typeof createTestContext>> | undefined;
afterEach(() => context?.cleanup());

describe('engine lifecycle storage', () => {
  /** Seeding is distinct from a successful update check and preserves the persisted check time. */
  it('should expose never_checked for a seeded engine', async () => {
    context = await createTestContext();
    expect(context.engines.initialize('nightly-1')).toMatchObject({
      status: 'never_checked',
      lastCheckedAt: null,
    });
  });
});

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { createEngineProvider } from '../src/engine/provider.js';
import { createEngineStore } from '../src/engine/engine-store.js';
import { createEngineProcessFixture } from '../../../tests/support/engine-process-fixture.js';
import { engineCheckIntervalMs } from '../src/storage/engine-repository.js';

async function makeSUT(mode = 'ok') {
  context = await createTestContext();
  const c = context;
  const root = realpathSync(c.root);
  const fixture = createEngineProcessFixture(root, mode);
  const engineRoot = join(root, 'engines');
  mkdirSync(engineRoot, { mode: 0o700 });
  let now = 1000;
  const options = { database: c.db, clock: () => now, root: engineRoot, ...fixture };
  const provider = createEngineProvider(options);
  await provider.initialize();
  return {
    c,
    fixture,
    options,
    root: engineRoot,
    provider,
    store: createEngineStore(engineRoot),
    state: () => c.engines.get(),
    setNow: (value: number) => {
      now = value;
      c.setNow(value);
    },
    restart: () => createEngineProvider({ ...options, database: c.open() }),
  };
}

describe('managed engine lifecycle', () => {
  /** First boot verifies the pinned seed and creates an immutable active manifest exactly once. */
  it('should seed once and preserve active bytes and pointer on restart', async () => {
    const s = await makeSUT();
    const lease = await s.provider.acquire();
    expect(lease.version).toBe('nightly-1');
    expect(lease.executable).not.toBe(s.fixture.seed.executable);
    expect(readFileSync(lease.executable)).toEqual(readFileSync(s.fixture.seed.executable));
    const pointer = readFileSync(join(s.root, 'active.json'));
    await s.restart().initialize();
    expect(readFileSync(join(s.root, 'active.json'))).toEqual(pointer);
    lease.release();
    lease.release();
    expect(existsSync(lease.executable)).toBe(true);
  });
  /** SQLite claims survive restart and collapse concurrent ticks at the exact 24 hour boundary. */
  it('should check once at 24 hours including restart and concurrent schedulers', async () => {
    const s = await makeSUT('no-update');
    expect(await s.provider.checkDue()).toBe(true);
    expect(s.state()).toMatchObject({ status: 'up_to_date', lastCheckedAt: 1000 });
    s.setNow(1000 + engineCheckIntervalMs - 1);
    const restarted = s.restart();
    await restarted.initialize();
    expect(await restarted.checkDue()).toBe(false);
    s.setNow(1000 + engineCheckIntervalMs);
    expect((await Promise.all([s.provider.checkDue(), restarted.checkDue()])).sort()).toEqual([
      false,
      true,
    ]);
    s.setNow(1000 + 10 * engineCheckIntervalMs);
    expect(await restarted.checkDue()).toBe(true);
    expect(await s.provider.checkDue()).toBe(false);
    expect(s.state().lastCheckedAt).toBe(1000 + 10 * engineCheckIntervalMs);
  });
  /** Candidate preparation never writes the active file, and only a real source probe activates. */
  it('should persist a candidate across restart and activate only for the next allowed source', async () => {
    const s = await makeSUT();
    const old = await s.provider.acquire();
    const bytes = readFileSync(old.executable);
    const pointer = readFileSync(join(s.root, 'active.json'));
    await s.provider.checkDue();
    expect(s.state()).toMatchObject({
      status: 'candidate_pending_validation',
      activeVersion: 'nightly-1',
      candidateVersion: 'nightly-2',
    });
    expect(readFileSync(join(s.root, 'active.json'))).toEqual(pointer);
    expect((await s.provider.acquire()).version).toBe('nightly-1');
    const restarted = s.restart();
    await restarted.initialize();
    const next = await restarted.acquire('abcdefghijk');
    expect(next.version).toBe('nightly-2');
    expect(s.state()).toMatchObject({
      status: 'active',
      activeVersion: 'nightly-2',
      previousVersion: 'nightly-1',
      candidateVersion: null,
    });
    expect(readFileSync(old.executable)).toEqual(bytes);
    expect(Object.isFrozen(next)).toBe(true);
    expect(readdirSync(join(s.root, 'candidates'))).toEqual([]);
    old.release();
    next.release();
  });
  /** Each deterministic update failure is redacted and keeps the last working executable. */
  it.each([
    ['check-failure', 'update_failed', 'update_failed'],
    ['corrupt', 'validation_failed', 'invalid_executable'],
    ['symlink', 'validation_failed', 'invalid_executable'],
    ['mode', 'validation_failed', 'invalid_executable'],
    ['bad-version', 'validation_failed', 'invalid_version'],
  ])('should retain active after %s', async (mode, status, failureCode) => {
    const s = await makeSUT(mode);
    const active = await s.provider.acquire();
    const bytes = readFileSync(active.executable);
    await s.provider.checkDue();
    expect(s.state()).toMatchObject({
      status,
      failureCode,
      activeVersion: 'nightly-1',
      candidateVersion: null,
    });
    expect(readFileSync(active.executable)).toEqual(bytes);
    expect((await s.provider.acquire('abcdefghijk')).version).toBe('nightly-1');
    expect(await s.provider.checkDue()).toBe(false);
    expect(readdirSync(join(s.root, 'candidates'))).toEqual([]);
    expect(JSON.stringify(s.state())).not.toMatch(/private|https:|youtube/);
  });
  /** Dependency execution and candidate digest are independent validation gates. */
  it.each(['dependency', 'hash'])('should reject a candidate with a changed %s', async (mode) => {
    const s = await makeSUT();
    await s.provider.checkDue();
    if (mode === 'dependency')
      writeFileSync(s.fixture.ffmpeg, `#!${process.execPath}\nprocess.exit(1);\n`);
    else
      writeFileSync(
        join(s.root, 'candidates', s.state().candidateKey!, 'yt-dlp'),
        'corrupted candidate',
      );
    const lease = await s.provider.acquire('abcdefghijk');
    expect(lease.version).toBe('nightly-1');
    expect(s.state()).toMatchObject({
      status: 'validation_failed',
      failureCode: mode === 'dependency' ? 'dependency_failed' : 'invalid_hash',
    });
  });
  /** Metadata extraction failures and ID mismatches fall back for the same item. */
  it.each([
    ['probe-failure', 'source_probe_failed'],
    ['source-mismatch', 'source_mismatch'],
  ])('should reject %s and continue with active', async (mode, failureCode) => {
    const s = await makeSUT(mode);
    await s.provider.checkDue();
    expect((await s.provider.acquire('abcdefghijk')).version).toBe('nightly-1');
    expect(s.state()).toMatchObject({
      status: 'validation_failed',
      failureCode,
      candidateVersion: null,
    });
    expect(readdirSync(join(s.root, 'candidates'))).toEqual([]);
  });
  /** Restoring a validated previous changes selection without deleting either running executable. */
  it('should restore previous while preserving running leases and unrelated ledgers', async () => {
    const s = await makeSUT();
    await expect(s.provider.restorePrevious()).rejects.toThrow('no_previous_engine');
    await s.provider.checkDue();
    const running = await s.provider.acquire('abcdefghijk');
    const bytes = readFileSync(running.executable);
    await s.provider.restorePrevious();
    expect(s.state()).toMatchObject({
      status: 'restored',
      activeVersion: 'nightly-1',
      previousVersion: 'nightly-2',
    });
    expect((await s.provider.acquire()).version).toBe('nightly-1');
    expect(readFileSync(running.executable)).toEqual(bytes);
    expect(s.c.db.connection.prepare('SELECT count(*) AS n FROM download_events').get()).toEqual({
      n: 0,
    });
    running.release();
  });
  /** Invalid previous bytes cannot silently become the active executable. */
  it('should reject damaged previous without changing active selection', async () => {
    const s = await makeSUT();
    const old = await s.provider.acquire();
    await s.provider.checkDue();
    await s.provider.acquire('abcdefghijk');
    chmodSync(old.executable, 0o700);
    writeFileSync(old.executable, 'bad');
    await expect(s.provider.restorePrevious()).rejects.toThrow('invalid_hash');
    expect(s.state().activeVersion).toBe('nightly-2');
  });
  /** The atomic filesystem commit is recovered when a crash precedes the DB projection. */
  it('should reconcile a committed pointer after database projection interruption', async () => {
    const s = await makeSUT();
    await s.provider.checkDue();
    const state = s.state();
    const candidate = s.store.promote({
      version: state.candidateVersion!,
      key: state.candidateKey!,
      hash: state.candidateHash!,
    });
    const old = s.store.readPointer()!;
    s.store.writePointer({ active: candidate, previous: old.active, status: 'active' });
    await s.restart().initialize();
    expect(s.state()).toMatchObject({
      activeVersion: 'nightly-2',
      previousVersion: 'nightly-1',
      candidateVersion: null,
      status: 'active',
    });
  });
  /** Invalid public source text cannot consume or validate a pending candidate. */
  it('should reject invalid source input before any candidate process', async () => {
    const s = await makeSUT();
    await s.provider.checkDue();
    await expect(s.provider.acquire('--exec=bad')).rejects.toThrow('invalid_source');
    expect(s.state().status).toBe('candidate_pending_validation');
  });
  /** An expired operation can recover without retrying a check before the daily deadline. */
  it('should fence stale results and record interrupted checks on restart', async () => {
    const s = await makeSUT();
    const token = s.c.engines.claim('check')!;
    expect(s.c.engines.claim('check')).toBeNull();
    s.setNow(121_000);
    await s.restart().initialize();
    expect(s.state()).toMatchObject({
      status: 'update_failed',
      failureCode: 'check_interrupted',
      lastCheckedAt: 1000,
    });
    expect(() => s.c.engines.finishCheck(token)).toThrow('engine_claim_lost');
    expect(await s.provider.checkDue()).toBe(false);
  });
  /** A configured symlink root is rejected without following it or writing its target. */
  it('should reject a symlink root and an untrusted seed checksum', async () => {
    const s = await makeSUT();
    const link = join(realpathSync(s.c.root), 'engine-link');
    symlinkSync(s.root, link);
    expect(() => createEngineStore(link)).toThrow('invalid_executable');
    const fresh = join(realpathSync(s.c.root), 'fresh');
    mkdirSync(fresh);
    const untrusted = createEngineProvider({
      ...s.options,
      root: fresh,
      database: s.c.open(join(realpathSync(s.c.root), 'untrusted-db')),
      seed: { ...s.fixture.seed, hash: '0'.repeat(64) },
    });
    await expect(untrusted.initialize()).rejects.toThrow('invalid_hash');
    expect(existsSync(join(fresh, 'active.json'))).toBe(false);
  });
});

import { createWorkerRunner } from '../src/imports/worker-runner.js';
import { createImportProcessFixture } from '../../../tests/support/import-process-fixture.js';

/** Real worker attempts use the source-validated version and release after publication/failure. */
it.each([
  ['ok', 'nightly-2'],
  ['probe-failure', 'nightly-1'],
])('should import the same source with %s engine validation', async (mode, version) => {
  const s = await makeSUT(mode);
  const root = realpathSync(s.c.root);
  const musicRoot = join(root, 'music');
  const stagingRoot = join(root, 'staging');
  mkdirSync(musicRoot);
  mkdirSync(stagingRoot);
  const fixture = createImportProcessFixture(root);
  s.c.imports.createJob({
    id: 'job',
    identityKey: 'a'.repeat(64),
    libraryId: 'library',
    operationIdHash: 'b'.repeat(64),
    requestHash: 'c'.repeat(64),
    items: [{ id: 'item', sourceId: 'abcdefghijk' }],
  });
  await s.provider.checkDue();
  let released = 0;
  const worker = createWorkerRunner({
    database: s.c.db,
    clock: () => 1000,
    musicRoot,
    stagingRoot,
    libraryRoot: () => 'imports',
    ffprobe: fixture.ffprobe,
    timeoutMs: 3000,
    leaseDurationMs: 1000,
    acquireEngine: async (source, signal) => {
      const lease = await s.provider.acquire(source, signal);
      return {
        ...lease,
        release() {
          expect(readdirSync(stagingRoot)).toEqual([]);
          released++;
          lease.release();
        },
      };
    },
  });
  await worker.runOnce();
  expect(s.c.imports.getJob('job')!.items[0]).toMatchObject({
    stage: 'registering',
    engineVersion: version,
  });
  expect(
    s.c.db.connection.prepare('SELECT engine_version,cleaned_at FROM import_attempts').get(),
  ).toEqual({ engine_version: version, cleaned_at: 1000 });
  expect(released).toBe(1);
});

/** Permission failure before atomic rename cannot change the active pointer or block fallback. */
it('should retain active when atomic pointer replacement cannot be written', async () => {
  const s = await makeSUT();
  await s.provider.checkDue();
  const pointer = readFileSync(join(s.root, 'active.json'));
  chmodSync(s.root, 0o500);
  try {
    expect((await s.provider.acquire('abcdefghijk')).version).toBe('nightly-1');
    expect(s.state()).toMatchObject({
      status: 'validation_failed',
      failureCode: 'activation_failed',
    });
    expect(readFileSync(join(s.root, 'active.json'))).toEqual(pointer);
  } finally {
    chmodSync(s.root, 0o700);
  }
});

/** Timeout kills a synthetic updater and leaves no candidate or active mutation. */
it('should bound a hung nightly check and preserve active fallback', async () => {
  const s = await makeSUT('hang-update');
  const provider = createEngineProvider({ ...s.options, timeoutMs: 200 });
  await provider.checkDue();
  expect(s.state()).toMatchObject({ status: 'update_failed', failureCode: 'update_failed' });
  expect((await provider.acquire()).version).toBe('nightly-1');
  expect(readdirSync(join(s.root, 'candidates'))).toEqual([]);
});

import { unlinkSync } from 'node:fs';
/** Losing an existing manifest must fail closed rather than silently resetting to the image seed. */
it('should refuse reseeding when the committed active pointer is missing', async () => {
  const s = await makeSUT();
  unlinkSync(join(s.root, 'active.json'));
  await expect(s.restart().initialize()).rejects.toThrow('invalid_executable');
  expect(existsSync(join(s.root, 'active.json'))).toBe(false);
});

import { DatabaseSync } from 'node:sqlite';
import { createLegacyV2 } from '../../../tests/support/session-storage-harness.js';
/** A v6 migration preserves active/previous/check times while discarding an unverifiable old candidate. */
it('should migrate v6 engine state and preserve its daily check deadline', async () => {
  context = await createTestContext();
  const legacyRoot = join(context.root, 'legacy-engine');
  createLegacyV2(legacyRoot);
  const legacy = new DatabaseSync(join(legacyRoot, 'management.sqlite'));
  try {
    for (const name of ['003-imports', '004-import-worker', '005-registration', '006-import-api']) {
      legacy.exec(
        readFileSync(new URL(`../src/storage/migrations/${name}.sql`, import.meta.url), 'utf8'),
      );
    }
    legacy
      .prepare(
        "UPDATE engine_state SET active_version='nightly-2',previous_version='nightly-1',candidate_version='nightly-3',last_checked_at=1000,last_check_succeeded_at=1000,status='candidate_ready'",
      )
      .run();
  } finally {
    legacy.close();
  }
  const repository = context.enginesFor(context.open(legacyRoot));
  expect(repository.get()).toMatchObject({
    activeVersion: 'nightly-2',
    previousVersion: 'nightly-1',
    candidateVersion: null,
    lastCheckedAt: 1000,
    lastCheckSucceededAt: 1000,
    status: 'validation_failed',
    failureCode: 'invalid_executable',
  });
  expect(repository.claim('check')).toBeNull();
});

/** A DB failure after atomic activation is recovered without rerunning extraction on restart. */
it('should recover activation after the pointer commits but SQLite rejects the projection', async () => {
  const s = await makeSUT();
  await s.provider.checkDue();
  s.c.db.connection.exec(
    "CREATE TRIGGER engine_projection_failure BEFORE UPDATE OF active_version ON engine_state WHEN NEW.active_version='nightly-2' BEGIN SELECT RAISE(ABORT,'synthetic projection failure'); END",
  );
  await expect(s.provider.acquire('abcdefghijk')).rejects.toThrow('synthetic projection failure');
  expect(s.store.readPointer()!.active.version).toBe('nightly-2');
  expect(s.state().activeVersion).toBe('nightly-1');
  s.c.db.connection.exec('DROP TRIGGER engine_projection_failure');
  await s.restart().initialize();
  expect(s.state()).toMatchObject({
    status: 'active',
    activeVersion: 'nightly-2',
    candidateVersion: null,
  });
  expect(readdirSync(join(s.root, 'candidates'))).toEqual([]);
});

/** A worker that already owns an old lease finishes with that version after another job activates. */
it('should finish a running worker attempt with its originally acquired version', async () => {
  const s = await makeSUT();
  const root = realpathSync(s.c.root);
  const musicRoot = join(root, 'music');
  const stagingRoot = join(root, 'staging');
  mkdirSync(musicRoot);
  mkdirSync(stagingRoot);
  const fixture = createImportProcessFixture(root);
  s.c.imports.createJob({
    id: 'job',
    identityKey: 'a'.repeat(64),
    libraryId: 'library',
    operationIdHash: 'b'.repeat(64),
    requestHash: 'c'.repeat(64),
    items: [{ id: 'item', sourceId: 'abcdefghijk' }],
  });
  const old = await s.provider.acquire();
  let acquired!: () => void;
  const begun = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  let resume!: () => void;
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const worker = createWorkerRunner({
    database: s.c.db,
    clock: () => 1000,
    musicRoot,
    stagingRoot,
    libraryRoot: () => 'imports',
    ffprobe: fixture.ffprobe,
    timeoutMs: 3000,
    leaseDurationMs: 1000,
    acquireEngine: async () => {
      acquired();
      await gate;
      return old;
    },
  });
  const running = worker.runOnce();
  try {
    await begun;
    await s.provider.checkDue();
    const next = await s.provider.acquire('lmnopqrstuv');
    expect(next.version).toBe('nightly-2');
    next.release();
  } finally {
    resume();
    await running;
  }
  expect(s.c.imports.getJob('job')!.items[0]).toMatchObject({
    stage: 'registering',
    engineVersion: 'nightly-1',
  });
  expect(s.state().activeVersion).toBe('nightly-2');
  expect(existsSync(old.executable)).toBe(true);
});

/** A stale updater cannot overwrite recovered state and cleans only its own uncommitted candidate. */
it('should fence an asynchronous update result after another process recovers its expired claim', async () => {
  const s = await makeSUT();
  const checking = s.provider.checkDue();
  expect(s.state().status).toBe('checking');
  s.setNow(121_000);
  await s.restart().initialize();
  await expect(checking).rejects.toThrow('engine_claim_lost');
  expect(s.state()).toMatchObject({
    status: 'update_failed',
    failureCode: 'check_interrupted',
    candidateVersion: null,
    activeVersion: 'nightly-1',
  });
  expect(readdirSync(join(s.root, 'candidates'))).toEqual([]);
});

/** Cancelling candidate validation keeps it pending and does not label a user abort as a bad engine. */
it('should preserve pending validation when the acquiring item is cancelled', async () => {
  const s = await makeSUT();
  await s.provider.checkDue();
  const abort = new AbortController();
  const acquiring = s.provider.acquire('abcdefghijk', abort.signal);
  abort.abort();
  await expect(acquiring).rejects.toThrow();
  expect(s.state()).toMatchObject({
    status: 'candidate_pending_validation',
    activeVersion: 'nightly-1',
    candidateVersion: 'nightly-2',
    failureCode: null,
    operationToken: null,
  });
  expect((await s.provider.acquire('abcdefghijk')).version).toBe('nightly-2');
});

/** Online backup preserves candidate hash/key and check time for a matching engine-volume restore. */
it('should preserve lifecycle state in a validated database backup and restore', async () => {
  const s = await makeSUT();
  await s.provider.checkDue();
  const before = s.state();
  const snapshot = join(s.c.root, 'snapshot');
  const restored = join(s.c.root, 'restored');
  await s.c.createBackup(s.c.db, s.c.keyPath, snapshot);
  await s.c.restoreBackup(snapshot, restored);
  const database = s.c.open(restored);
  expect(s.c.enginesFor(database).get()).toEqual(before);
  const provider = createEngineProvider({ ...s.options, database });
  await provider.initialize();
  expect(await provider.checkDue()).toBe(false);
  const lease = await provider.acquire('abcdefghijk');
  expect(lease.version).toBe('nightly-2');
  lease.release();
});

import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { vi } from 'vitest';
/** A directory-sync error after rename is an uncertain commit, never a successful old-active fallback. */
it('should project a visible committed pointer and surface its durability failure', async () => {
  const s = await makeSUT();
  await s.provider.checkDue();
  const originalSync = fs.fsyncSync;
  let failed = false;
  const fault = vi.spyOn(fs, 'fsyncSync').mockImplementation((fd) => {
    if (
      !failed &&
      fs.fstatSync(fd).isDirectory() &&
      s.store.readPointer()!.active.version === 'nightly-2'
    ) {
      failed = true;
      throw new Error('synthetic directory sync failure');
    }
    return originalSync(fd);
  });
  syncBuiltinESMExports();
  try {
    await expect(s.provider.acquire('abcdefghijk')).rejects.toThrow('activation_failed');
    expect(failed).toBe(true);
    expect(s.state()).toMatchObject({
      status: 'active',
      activeVersion: 'nightly-2',
      candidateVersion: null,
    });
    expect(s.store.readPointer()!.active.version).toBe('nightly-2');
  } finally {
    fault.mockRestore();
    syncBuiltinESMExports();
  }
});
