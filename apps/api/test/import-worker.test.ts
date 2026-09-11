import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext } from '../../../tests/support/session-storage-harness.js';

let context: Awaited<ReturnType<typeof createTestContext>> | undefined;
afterEach(() => context?.cleanup());
async function makeSUT() {
  context = await createTestContext();
  context.imports.createJob({
    id: 'job',
    identityKey: 'a'.repeat(64),
    libraryId: 'library',
    operationIdHash: 'b'.repeat(64),
    requestHash: 'c'.repeat(64),
    items: [
      { id: 'item', sourceId: 'abcdefghijk' },
      { id: 'queued', sourceId: 'lmnopqrstuv' },
    ],
  });
  return context;
}

describe('durable worker prerequisites', () => {
  /** Running cancellation retains ownership until process termination and cleanup are acknowledged. */
  it('should cancel queued items immediately and retain running leases', async () => {
    const c = await makeSUT();
    c.imports.claimNext({ workerId: 'worker', leaseDurationMs: 1000, engineVersion: 'seed' });
    expect(c.imports.requestCancel('job')?.items.map((item) => item.stage)).toEqual([
      'resolving',
      'cancelled',
    ]);
  });
  /** Pending media has no fabricated gonic ID and survives database reopening. */
  it('should support a pending media row without a gonic song ID', async () => {
    const c = await makeSUT();
    expect(() =>
      c.db.connection
        .prepare(
          "INSERT INTO media_links(id,library_id,relative_file_key,gonic_song_id,revision,availability,created_at) VALUES('pending','library','Song [abcdefghijk].mp3',NULL,1,'unavailable',1000)",
        )
        .run(),
    ).not.toThrow();
    expect(c.mediaLinksFor(c.open()).get('pending')).toMatchObject({
      gonicSongId: null,
      availability: 'unavailable',
    });
  });
});

import { createWorkerRunner, type WorkerOptions } from '../src/imports/worker-runner.js';
import { mkdirSync, realpathSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createImportProcessFixture } from '../../../tests/support/import-process-fixture.js';

async function workerSUT(mode = 'ok', checkpoint?: (stage: string) => void) {
  const c = await makeSUT();
  // Single item unless the scenario explicitly adds a second source.
  c.db.connection.prepare("DELETE FROM import_items WHERE id='queued'").run();
  const root = realpathSync(c.root);
  const musicRoot = join(root, 'music');
  const stagingRoot = join(root, 'staging');
  mkdirSync(musicRoot);
  mkdirSync(stagingRoot);
  const fixture = createImportProcessFixture(root, mode);
  let now = 1000;
  let acquired = 0;
  const logs: Record<string, string>[] = [];
  const options: WorkerOptions = {
    database: c.db,
    clock: () => now,
    musicRoot,
    stagingRoot,
    libraryRoot: () => 'imports',
    acquireEngine: async () => {
      acquired++;
      return { version: 'seed-1', executable: fixture.executable };
    },
    ffprobe: fixture.ffprobe,
    leaseDurationMs: 1000,
    timeoutMs: 2000,
    logger: (event) => logs.push(event),
    ...(checkpoint ? { checkpoint } : {}),
  };
  return {
    c,
    options,
    worker: createWorkerRunner(options),
    restart: () => createWorkerRunner({ ...options, database: c.open(), checkpoint: () => {} }),
    expire: () => {
      now += 2000;
      c.setNow(now);
    },
    acquired: () => acquired,
    logs,
    files: () =>
      readdirSync(musicRoot, { recursive: true }).filter((file) => String(file).endsWith('.mp3')),
    item: () => c.imports.getJob('job')!.items[0]!,
    events: () => c.db.connection.prepare('SELECT * FROM download_events').all(),
  };
}

describe('durable download worker', () => {
  /** Publication produces one file/event and a pending link; replay does not acquire an engine again. */
  it('should publish once and stop at registering across replay and restart', async () => {
    const s = await workerSUT();
    expect(await s.worker.runOnce()).toBe(true);
    expect(s.item()).toMatchObject({ stage: 'registering', engineVersion: 'seed-1' });
    expect(s.events()).toHaveLength(1);
    expect(
      s.c.db.connection
        .prepare("SELECT kind FROM curation_source_events WHERE kind='import_published'")
        .all(),
    ).toHaveLength(1);
    expect(s.files()).toHaveLength(1);
    expect(s.c.mediaLinks.get(s.item().mediaLinkId!)).toMatchObject({
      gonicSongId: null,
      availability: 'unavailable',
    });
    s.expire();
    expect(await s.restart().runOnce()).toBe(false);
    expect(s.acquired()).toBe(1);
    expect(s.events()).toHaveLength(1);
    expect(readdirSync(s.options.stagingRoot)).toEqual([]);
    expect(JSON.stringify(s.logs)).not.toMatch(/Synthetic|youtube|private|audio\.mp3/);
  });
  /** Same-source imports reuse verified files without manufacturing a new completion event. */
  it('should skip duplicate sources while keeping operation replay idempotent', async () => {
    const s = await workerSUT();
    await s.worker.runOnce();
    s.c.imports.createJob({
      id: 'second',
      identityKey: 'a'.repeat(64),
      libraryId: 'library',
      operationIdHash: 'd'.repeat(64),
      requestHash: 'c'.repeat(64),
      items: [{ id: 'second-item', sourceId: 'abcdefghijk' }],
    });
    await s.worker.runOnce();
    expect(s.c.imports.getJob('second')!.items[0]!.stage).toBe('duplicate');
    expect(s.events()).toHaveLength(1);
    expect(s.files()).toHaveLength(1);
    expect(s.acquired()).toBe(1);
  });
  /** Invalid output and process failures never publish payloads or events. */
  it.each([
    'exit',
    'wrong-id',
    'missing',
    'empty',
    'invalid-audio',
    'symlink',
    'outside',
    'multiple',
    'overflow',
    'hang',
  ])('should fail safely for %s output', async (mode) => {
    const s = await workerSUT(mode);
    if (mode === 'hang') s.options.timeoutMs = 100;
    await s.worker.runOnce();
    expect(s.item().stage).toBe('failed');
    const codes: Record<string, string> = {
      exit: 'download_failed',
      'wrong-id': 'invalid_metadata',
      missing: 'download_failed',
      empty: 'invalid_media',
      'invalid-audio': 'invalid_media',
      symlink: 'invalid_file_key',
      outside: 'invalid_media',
      multiple: 'invalid_media',
      overflow: 'process_output_limit',
      hang: 'process_aborted',
    };
    expect(s.item().failureCode).toBe(codes[mode]);
    expect(s.events()).toHaveLength(0);
    expect(s.files()).toHaveLength(0);
    expect(readdirSync(s.options.stagingRoot)).toEqual([]);
  });
  /** Every durable crash boundary resumes registration or fails before publication without redownload. */
  it.each(['claimed', 'downloading', 'postprocessing', 'intent', 'published', 'recorded'])(
    'should recover a crash at %s without duplicate output',
    async (point) => {
      const s = await workerSUT('ok', (stage) => {
        if (stage === point) throw new Error('simulated_crash');
      });
      await expect(s.worker.runOnce()).rejects.toThrow('simulated_crash');
      s.expire();
      await s.restart().runOnce();
      expect(s.item().stage).toBe(
        ['intent', 'published', 'recorded'].includes(point) ? 'registering' : 'failed',
      );
      expect(s.events()).toHaveLength(['intent', 'published', 'recorded'].includes(point) ? 1 : 0);
      expect(s.files()).toHaveLength(['intent', 'published', 'recorded'].includes(point) ? 1 : 0);
      expect(s.acquired()).toBe(point === 'claimed' ? 0 : 1);
      expect(readdirSync(s.options.stagingRoot)).toEqual([]);
    },
  );
  /** Lease ownership is exclusive while another runner is paused at a durable boundary. */
  it('should reject a competing claim while a lease is active', async () => {
    const s = await workerSUT('ok', (stage) => {
      if (stage === 'claimed') throw new Error('simulated_crash');
    });
    await expect(s.worker.runOnce()).rejects.toThrow();
    expect(await s.restart().runOnce()).toBe(false);
    expect(s.item().attempt).toBe(1);
  });
  /** A job cancellation is acknowledged only after child process and owned staging cleanup. */
  it('should stop a running process on cancellation', async () => {
    const s = await workerSUT('hang');
    const timer = setTimeout(() => s.c.imports.requestCancel('job'), 30);
    try {
      await s.worker.runOnce();
    } finally {
      clearTimeout(timer);
    }
    expect(s.item().stage).toBe('cancelled');
    expect(readdirSync(s.options.stagingRoot)).toEqual([]);
  });
  /** Cancellation at the publication boundary preserves the payload and completes the receipt. */
  it('should preserve published work when cancellation arrives', async () => {
    const s = await workerSUT();
    s.options.checkpoint = (stage) => {
      if (stage === 'published') s.c.imports.requestCancel('job');
    };
    await s.worker.runOnce();
    expect(s.item().stage).toBe('registering');
    expect(s.events()).toHaveLength(1);
    expect(s.files()).toHaveLength(1);
  });
});

import { linkSync, writeFileSync, rmSync } from 'node:fs';
import { prepareMediaFileKey } from '../src/imports/file-keys.js';

describe('publication and recovery boundaries', () => {
  /** A crash after atomic link leaves two names, which recovery reconciles using its durable token. */
  it('should recover an owned pending hard link without treating it as a foreign file', async () => {
    const s = await workerSUT();
    s.options.checkpoint = (stage) => {
      if (stage === 'published') {
        const row = s.c.db.connection.prepare('SELECT * FROM import_publish_intents').get()!;
        const target = join(s.options.musicRoot, String(row.relative_file_key));
        const pending = join(
          target.substring(0, target.lastIndexOf('/')),
          `.import-${String(row.event_id)}.pending`,
        );
        linkSync(target, pending);
        throw new Error('simulated_crash');
      }
    };
    await expect(s.worker.runOnce()).rejects.toThrow('simulated_crash');
    s.expire();
    await s.restart().runOnce();
    expect(s.item().stage).toBe('registering');
    expect(s.events()).toHaveLength(1);
    expect(
      readdirSync(s.options.musicRoot, { recursive: true }).some((key) =>
        String(key).endsWith('.pending'),
      ),
    ).toBe(false);
  });
  /** A missing artifact before final publication is a retryable failure, never an infinite publish loop. */
  it('should fail an unpublished intent whose staged artifact was lost', async () => {
    const s = await workerSUT('ok', (stage) => {
      if (stage === 'intent') throw new Error('simulated_crash');
    });
    await expect(s.worker.runOnce()).rejects.toThrow();
    for (const entry of readdirSync(s.options.stagingRoot))
      rmSync(join(s.options.stagingRoot, entry), { recursive: true });
    s.expire();
    await s.restart().runOnce();
    expect(s.item().stage).toBe('failed');
    expect(s.events()).toHaveLength(0);
    expect(s.files()).toHaveLength(0);
  });
  /** Pending links cannot be used to claim that gonic registration succeeded. */
  it('should reject ready transitions using a pending media link', async () => {
    const s = await workerSUT();
    await s.worker.runOnce();
    s.expire();
    s.c.imports.claimNext({
      workerId: 'registration-owner',
      leaseDurationMs: 1000,
      engineVersion: 'seed',
    });
    expect(() =>
      s.c.imports.finishRegistration({
        itemId: 'item',
        workerId: 'registration-owner',
        mediaLinkId: s.item().mediaLinkId!,
      }),
    ).toThrow();
  });
  /** Wrong-source existing payloads are preserved byte-for-byte and produce no receipt. */
  it('should preserve a conflicting legacy file', async () => {
    const s = await workerSUT();
    const key = prepareMediaFileKey(s.options.musicRoot, {
      relativeRoot: 'imports',
      channelName: 'Synthetic channel',
      channelId: 'channel-1',
      title: 'Synthetic song',
      videoId: 'abcdefghijk',
    });
    const bytes = JSON.stringify({ valid: true, sourceId: 'XXXXXXXXXXX' });
    writeFileSync(join(s.options.musicRoot, key), bytes);
    await s.worker.runOnce();
    expect(s.item().stage).toBe('failed');
    expect(s.events()).toHaveLength(0);
    expect(readFileSync(join(s.options.musicRoot, key), 'utf8')).toBe(bytes);
  });
  /** A losing lease cannot publish even when it has a validated artifact and durable intent. */
  it('should fence an expired owner before publication', async () => {
    const s = await workerSUT();
    s.options.checkpoint = (stage) => {
      if (stage === 'intent') s.expire();
    };
    await expect(s.worker.runOnce()).rejects.toThrow('worker_lease_lost');
    expect(s.files()).toHaveLength(0);
    expect(s.events()).toHaveLength(0);
    await s.restart().runOnce();
    expect(s.item().stage).toBe('registering');
  });
  /** Successful and failed siblings stay independent and only failed items can create a retry job. */
  it('should preserve mixed results and retry only failures', async () => {
    const s = await workerSUT();
    s.c.db.connection
      .prepare(
        "INSERT INTO import_items(id,job_id,item_order,source_id,stage,attempt,stage_changed_at) VALUES('sibling','job',1,'lmnopqrstuv','queued',0,1000)",
      )
      .run();
    const bad = createImportProcessFixture(realpathSync(s.c.root), 'exit');
    const acquire = s.options.acquireEngine;
    s.options.acquireEngine = (source) =>
      source === 'lmnopqrstuv'
        ? Promise.resolve({ version: 'seed-2', executable: bad.executable })
        : acquire(source);
    await s.worker.runOnce();
    await s.worker.runOnce();
    expect(s.c.imports.getJob('job')).toMatchObject({
      status: 'running',
      items: [{ stage: 'registering' }, { stage: 'failed' }],
    });
    const retry = s.c.imports.retryFailed({
      sourceJobId: 'job',
      id: 'retry',
      operationIdHash: 'd'.repeat(64),
      requestHash: 'e'.repeat(64),
      itemIds: ['sibling'],
    });
    expect(retry.job.items).toHaveLength(1);
    expect(() =>
      s.c.imports.retryFailed({
        sourceJobId: 'job',
        id: 'invalid-retry',
        operationIdHash: 'e'.repeat(64),
        requestHash: 'e'.repeat(64),
        itemIds: ['item'],
      }),
    ).toThrow();
    expect(s.files()).toHaveLength(1);
    expect(s.events()).toHaveLength(1);
  });
  /** Graceful loop shutdown stops its process and removes only its own signal listener and staging. */
  it('should stop its loop on SIGTERM without clearing another worker state', async () => {
    const s = await workerSUT('hang');
    const before = process.listenerCount('SIGTERM');
    const signal = new AbortController();
    const running = s.worker.run(signal.signal);
    const timer = setTimeout(() => process.emit('SIGTERM', 'SIGTERM'), 30);
    try {
      await running;
    } finally {
      clearTimeout(timer);
    }
    expect(process.listenerCount('SIGTERM')).toBe(before);
    expect(s.item().stage).toBe('failed');
    expect(s.files()).toHaveLength(0);
    expect(readdirSync(s.options.stagingRoot)).toEqual([]);
  });
});

import { spawnSync } from 'node:child_process';

/** SIGKILL-equivalent process exit bypasses JS finally, leaving actual fsync/link crash artifacts. */
it.each(['pending_synced', 'linked', 'directory_synced'])(
  'should recover a real worker process exit at %s',
  async (point) => {
    const s = await workerSUT();
    const fixture = createImportProcessFixture(realpathSync(s.c.root));
    const source = `import { openDatabase } from './apps/api/src/storage/database.ts';
import { createWorkerRunner } from './apps/api/src/imports/worker-runner.ts';
const database = openDatabase(${JSON.stringify(s.c.data)});
const worker = createWorkerRunner({ database, clock: () => 1000, musicRoot: ${JSON.stringify(s.options.musicRoot)}, stagingRoot: ${JSON.stringify(s.options.stagingRoot)}, libraryRoot: () => 'imports', acquireEngine: async () => ({ version: 'seed-1', executable: ${JSON.stringify(fixture.executable)} }), ffprobe: ${JSON.stringify(fixture.ffprobe)}, leaseDurationMs: 1000, timeoutMs: 2000, checkpoint: stage => { if (stage === ${JSON.stringify(point)}) process.exit(86); } });
await worker.runOnce(); database.close();`;
    const child = spawnSync(
      process.execPath,
      ['--import', import.meta.resolve('tsx'), '--input-type=module', '-e', source],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 5000 },
    );
    expect(child.status).toBe(86);
    s.expire();
    await s.restart().runOnce();
    expect(s.item().stage).toBe('registering');
    expect(s.events()).toHaveLength(1);
    expect(s.files()).toHaveLength(1);
    expect(
      readdirSync(s.options.musicRoot, { recursive: true }).some((key) =>
        String(key).endsWith('.pending'),
      ),
    ).toBe(false);
    expect(readdirSync(s.options.stagingRoot)).toEqual([]);
  },
);

/** An external same-source winner after intent is a duplicate even if the worker dies before observing it. */
it('should distinguish a foreign same-source winner from its own publish resume', async () => {
  const s = await workerSUT();
  s.options.checkpoint = (stage) => {
    if (stage === 'intent') {
      const row = s.c.db.connection.prepare('SELECT * FROM import_publish_intents').get()!;
      writeFileSync(
        join(s.options.musicRoot, String(row.relative_file_key)),
        JSON.stringify({ valid: true, sourceId: 'abcdefghijk' }),
      );
      throw new Error('simulated_crash');
    }
  };
  await expect(s.worker.runOnce()).rejects.toThrow();
  s.expire();
  await s.restart().runOnce();
  expect(s.item().stage).toBe('duplicate');
  expect(s.events()).toHaveLength(0);
  expect(s.files()).toHaveLength(1);
});

import { DatabaseSync } from 'node:sqlite';
import { createLegacyV2 } from '../../../tests/support/session-storage-harness.js';

/** Schema v3 media links and foreign-key relationships survive the additive worker migration. */
it('should migrate existing v3 links without changing their gonic mapping', async () => {
  const c = await makeSUT();
  const path = join(c.root, 'legacy-v3');
  createLegacyV2(path);
  const raw = new DatabaseSync(join(path, 'management.sqlite'));
  try {
    raw.exec(
      readFileSync(new URL('../src/storage/migrations/003-imports.sql', import.meta.url), 'utf8'),
    );
    raw
      .prepare(
        "INSERT INTO media_links(id,library_id,relative_file_key,gonic_song_id,revision,availability,created_at,validated_at) VALUES('legacy','library','legacy.mp3','opaque-song',2,'available',1000,1000)",
      )
      .run();
    raw
      .prepare(
        "INSERT INTO import_jobs(id,identity_key,library_id,operation_id_hash,request_hash,created_at) VALUES('legacy-job',?,'library',?,?,1000)",
      )
      .run('a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64));
    raw
      .prepare(
        "INSERT INTO import_items(id,job_id,item_order,source_id,stage,media_link_id,stage_changed_at,ready_at) VALUES('legacy-item','legacy-job',0,'abcdefghijk','ready','legacy',1000,1000)",
      )
      .run();
  } finally {
    raw.close();
  }
  const migrated = c.open(path);
  expect(c.mediaLinksFor(migrated).get('legacy')).toMatchObject({
    gonicSongId: 'opaque-song',
    revision: 2,
  });
  expect(c.importsFor(migrated).getJob('legacy-job')!.items[0]!.mediaLinkId).toBe('legacy');
  expect(migrated.connection.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  expect(migrated.connection.prepare('PRAGMA user_version').get()).toEqual({ user_version: 24 });
});

/** Backup restores pending publication receipts and rejects unsafe recovery paths before activation. */
it('should preserve pending worker state in backup and reject a corrupted intent', async () => {
  const s = await workerSUT();
  await s.worker.runOnce();
  const snapshot = join(s.c.root, 'worker-snapshot');
  await s.c.createBackup(s.c.db, s.c.keyPath, snapshot);
  const restored = join(s.c.root, 'worker-restored');
  await s.c.restoreBackup(snapshot, restored);
  const db = s.c.open(restored);
  expect(s.c.importsFor(db).getJob('job')!.items[0]!.stage).toBe('registering');
  expect(db.connection.prepare('SELECT count(*) AS n FROM import_publish_intents').get()?.n).toBe(
    1,
  );
  const raw = new DatabaseSync(join(snapshot, 'management.sqlite'));
  raw.prepare("UPDATE import_publish_intents SET staging_key='../outside/audio.mp3'").run();
  raw.close();
  await expect(s.c.restoreBackup(snapshot, join(s.c.root, 'invalid-restore'))).rejects.toThrow(
    'Restore failed',
  );
});

/** A stalled engine provider must not prevent the worker loop from acknowledging shutdown. */
it('should abort a stalled engine acquisition during graceful shutdown', async () => {
  const s = await workerSUT();
  s.options.acquireEngine = () => new Promise(() => {});
  const signal = new AbortController();
  const running = s.worker.run(signal.signal);
  const timer = setTimeout(() => signal.abort(), 30);
  try {
    const result = await Promise.race([
      running.then(() => 'stopped'),
      new Promise((resolve) => setTimeout(() => resolve('blocked'), 200)),
    ]);
    expect(result).toBe('stopped');
  } finally {
    clearTimeout(timer);
  }
});

/** An idle loop remains observable as healthy until shutdown, without claiming registration work. */
it('should heartbeat while idle and remove its state on shutdown', async () => {
  const s = await workerSUT();
  await s.worker.runOnce();
  const controller = new AbortController();
  const running = s.worker.run(controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 80));
  const state = s.c.workerStates.get();
  controller.abort();
  await running;
  expect(state).toMatchObject({ status: 'idle', heartbeatAt: 1000, activeItemId: null });
  expect(s.c.workerStates.get().status).toBe('stopped');
});

/** Completed staging cleanup is durably recorded so idle polling does not rescan historical attempts. */
it('should record completed staging cleanup without deleting attempt history', async () => {
  const s = await workerSUT();
  await s.worker.runOnce();
  const row = s.c.db.connection.prepare('SELECT * FROM import_attempts').get()!;
  expect(row).toMatchObject({ engine_version: 'seed-1', cleaned_at: 1000 });
});

/** Runtime-injected registration resumes published items without reacquiring the download engine. */
it('should resume registration through the worker runtime injection', async () => {
  const s = await workerSUT();
  await s.worker.runOnce();
  const key = s.c.mediaLinks.get(s.item().mediaLinkId!)!.relativeFileKey;
  const parts = key.split('/');
  const scanClient = {
    getScanStatus: async () => ({ scanning: false, count: 1 }),
    startScan: async () => {},
    indexes: async () => ({
      index: [{ name: '#', artist: [{ id: 'root', name: parts[0]!, album: [] }] }],
    }),
    registrationDirectory: async (id: string) => ({
      id,
      child:
        id === 'root'
          ? [{ id: 'channel', isDir: true as const, name: parts[1]! }]
          : [{ id: 'registered-song', isDir: false as const, path: key }],
    }),
  };
  const worker = createWorkerRunner(
    Object.assign({}, s.options, {
      registration: {
        scanClient,
        libraries: [{ id: 'library', musicFolderId: '0', relativeRoot: 'imports' }],
      },
    }),
  );
  expect(await worker.runOnce()).toBe(true);
  expect(s.item().stage).toBe('ready');
  expect(s.acquired()).toBe(1);
  expect(s.files()).toHaveLength(1);
  expect(s.events()).toHaveLength(1);
});

/** A finished attempt releases its engine only after the subprocess and staging cleanup settle. */
it.each(['ok', 'exit'])('should release the engine after %s completion', async (mode) => {
  const s = await workerSUT(mode);
  const acquire = s.options.acquireEngine;
  let releases = 0;
  s.options.acquireEngine = async (source) => ({
    ...(await acquire(source)),
    release: () => {
      expect(readdirSync(s.options.stagingRoot)).toEqual([]);
      releases++;
    },
  });
  await s.worker.runOnce();
  expect(releases).toBe(1);
});

/** A lease delivered after acquisition timeout is released instead of silently leaking. */
it('should release a late engine acquisition after the item timeout', async () => {
  const s = await workerSUT();
  s.options.timeoutMs = 50;
  const original = await s.options.acquireEngine('abcdefghijk');
  let deliver!: (engine: typeof original) => void;
  let released = 0;
  let acquisitionSignal: AbortSignal | undefined;
  s.options.acquireEngine = (_source, signal) =>
    new Promise((resolve) => {
      acquisitionSignal = signal;
      deliver = resolve;
    });
  await s.worker.runOnce();
  expect(s.item().stage).toBe('failed');
  expect(acquisitionSignal?.aborted).toBe(true);
  deliver({
    ...original,
    release: () => {
      released++;
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  expect(released).toBe(1);
});

/** Cancellation reaches the acquisition boundary and releases late results after cleanup. */
it('should release the engine when cancellation races acquisition', async () => {
  const s = await workerSUT();
  const original = await s.options.acquireEngine('abcdefghijk');
  let started!: () => void;
  const begun = new Promise<void>((resolve) => {
    started = resolve;
  });
  let released = 0;
  s.options.acquireEngine = (_source, signal) =>
    new Promise((resolve) => {
      started();
      signal?.addEventListener(
        'abort',
        () =>
          resolve({
            ...original,
            release: () => {
              released++;
            },
          }),
        { once: true },
      );
    });
  const work = s.worker.runOnce();
  await begun;
  s.c.imports.requestCancel('job');
  await work;
  await new Promise((resolve) => setImmediate(resolve));
  expect(s.item().stage).toBe('cancelled');
  expect(released).toBe(1);
  expect(readdirSync(s.options.stagingRoot)).toEqual([]);
});

/** Simulated worker crash releases the process lease while leaving durable staging for recovery. */
it('should release its engine when a checkpoint interrupts the worker', async () => {
  const s = await workerSUT('ok', (stage) => {
    if (stage === 'downloading') throw new Error('synthetic crash');
  });
  const acquire = s.options.acquireEngine;
  let released = 0;
  s.options.acquireEngine = async (source) => ({
    ...(await acquire(source)),
    release: () => {
      released++;
    },
  });
  await expect(s.worker.runOnce()).rejects.toThrow('synthetic crash');
  expect(released).toBe(1);
  expect(readdirSync(s.options.stagingRoot)).toHaveLength(1);
  s.expire();
  await s.restart().runOnce();
  expect(readdirSync(s.options.stagingRoot)).toEqual([]);
});

/** A long registration scan remains a live worker even though no download item lease is active. */
it('should keep a heartbeat while awaiting registration and stop it on shutdown', async () => {
  const s = await workerSUT();
  await s.worker.runOnce();
  let release!: () => void;
  let entered = false;
  const waiting = new Promise<void>((done) => {
    release = done;
  });
  let heartbeatNow = 1000;
  const worker = createWorkerRunner({
    ...s.options,
    leaseDurationMs: 60,
    clock: () => heartbeatNow,
    registration: {
      libraries: [{ id: 'library', musicFolderId: '0', relativeRoot: 'imports' }],
      scanClient: {
        getScanStatus: async () => {
          entered = true;
          await waiting;
          return { scanning: false, count: 0 };
        },
        startScan: async () => {},
        indexes: async () => ({ index: [] }),
        registrationDirectory: async () => ({ id: 'empty', child: [] }),
      },
    },
  });
  const abort = new AbortController();
  const running = worker.run(abort.signal);
  try {
    await expect.poll(() => entered).toBe(true);
    expect(s.c.workerStates.get()).toMatchObject({ status: 'idle', heartbeatAt: 1000 });
    heartbeatNow = 2000;
    await expect.poll(() => s.c.workerStates.get().heartbeatAt).toBe(2000);
  } finally {
    abort.abort();
    release();
    await running;
  }
  expect(s.c.workerStates.get().status).toBe('stopped');
});

describe('account import replacement', () => {
  it('downloads again into the account/channel/title path and reuses the media binding', async () => {
    const s = await workerSUT();
    s.c.db.connection
      .prepare("UPDATE import_jobs SET account_directory='listener' WHERE id='job'")
      .run();
    await s.worker.runOnce();
    expect(s.files()).toEqual(['imports/listener/Synthetic channel/Synthetic song.mp3']);
    const first = s.item().mediaLinkId!;
    s.c.imports.createJob({
      id: 'again',
      identityKey: 'a'.repeat(64),
      libraryId: 'library',
      accountDirectory: 'listener',
      operationIdHash: 'd'.repeat(64),
      requestHash: 'e'.repeat(64),
      deduplicate: true,
      items: [{ id: 'again-item', sourceId: 'lmnopqrstuv' }],
    });
    await s.worker.runOnce();
    expect(s.acquired()).toBe(2);
    expect(s.files()).toHaveLength(1);
    expect(
      JSON.parse(readFileSync(join(s.options.musicRoot, String(s.files()[0])), 'utf8')).sourceId,
    ).toBe('lmnopqrstuv');
    expect(s.c.imports.getJob('again')!.items[0]).toMatchObject({
      stage: 'registering',
      mediaLinkId: first,
    });
    expect(s.events()).toHaveLength(2);
    expect(s.c.mediaLinks.get(first)!.revision).toBe(2);
  });
});

it.each(['exit', 'invalid-audio'])(
  'preserves an existing account MP3 on %s failure',
  async (mode) => {
    const s = await workerSUT(mode);
    s.c.db.connection
      .prepare("UPDATE import_jobs SET account_directory='listener' WHERE id='job'")
      .run();
    const folder = join(s.options.musicRoot, 'imports/listener/Synthetic channel');
    mkdirSync(folder, { recursive: true });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(folder, 'Synthetic song.mp3'), 'original bytes');
    await s.worker.runOnce();
    expect(s.item().stage).toBe('failed');
    expect(readFileSync(join(folder, 'Synthetic song.mp3'), 'utf8')).toBe('original bytes');
    expect(s.events()).toHaveLength(0);
  },
);

it.each(['pending_synced', 'linked', 'published'])(
  'recovers account replacement after %s without a second download or event',
  async (point) => {
    let crashed = false;
    const s = await workerSUT('ok', (stage) => {
      if (!crashed && stage === point) {
        crashed = true;
        throw new Error('simulated crash');
      }
    });
    s.c.db.connection
      .prepare("UPDATE import_jobs SET account_directory='listener' WHERE id='job'")
      .run();
    await expect(s.worker.runOnce()).rejects.toThrow();
    s.expire();
    await s.restart().runOnce();
    expect(s.item().stage).toBe('registering');
    expect(s.acquired()).toBe(1);
    expect(s.events()).toHaveLength(1);
    expect(s.files()).toHaveLength(1);
  },
);

it('redownloads a completed source with a new operation and keeps the account after reopening', async () => {
  const s = await workerSUT();
  s.c.db.connection
    .prepare("UPDATE import_jobs SET account_directory='listener' WHERE id='job'")
    .run();
  await s.worker.runOnce();
  s.c.db.connection
    .prepare("UPDATE import_items SET stage='ready',ready_at=1000 WHERE id='item'")
    .run();
  s.c.db.connection
    .prepare("UPDATE media_links SET availability='available',gonic_song_id='song' ")
    .run();
  s.c.imports.createJob({
    id: 'again',
    identityKey: 'a'.repeat(64),
    libraryId: 'library',
    accountDirectory: 'listener',
    operationIdHash: 'd'.repeat(64),
    requestHash: 'e'.repeat(64),
    deduplicate: true,
    items: [{ id: 'again-item', sourceId: 'abcdefghijk' }],
  });
  expect(s.c.importsFor(s.c.open()).getJob('again')!.accountDirectory).toBe('listener');
  await s.worker.runOnce();
  expect(s.acquired()).toBe(2);
  expect(s.events()).toHaveLength(2);
  expect(s.files()).toHaveLength(1);
});

it('sanitizes channel and title without channel or video ID suffixes for account imports', async () => {
  const { buildMediaFileKey, sanitizeMediaName } = await import('../src/imports/file-keys.js');
  expect(
    buildMediaFileKey({
      relativeRoot: 'imports',
      accountDirectory: sanitizeMediaName('listener'),
      channelName: '../채널: "A"?*<>',
      channelId: 'channel-1',
      title: '노래/제목?*<>. ',
      videoId: 'abcdefghijk',
    }),
  ).toBe("imports/listener/- 채널 - 'A'/노래 - 제목.mp3");
});

it('refuses an account directory already assigned to another identity', async () => {
  const c = await makeSUT();
  c.db.connection
    .prepare("UPDATE import_jobs SET account_directory='Listener' WHERE id='job'")
    .run();
  expect(() =>
    c.imports.createJob({
      id: 'other',
      identityKey: 'f'.repeat(64),
      libraryId: 'library',
      accountDirectory: 'listener',
      operationIdHash: 'd'.repeat(64),
      requestHash: 'e'.repeat(64),
      items: [{ id: 'other-item', sourceId: 'abcdefghijk' }],
    }),
  ).toThrow('Import account directory conflict');
  expect(c.imports.getJob('other')).toBeNull();
});

it('publishes and recovers imports under the shared file fence with a durable dirty generation', async () => {
  const s = await workerSUT('ok', (stage) => {
    if (stage === 'published') throw new Error('synthetic crash');
  });
  const { createMediaFence, createMediaPublicationLedger } =
    await import('../src/metadata/media-fence.js');
  const { createMetadataRevision } = await import('../src/metadata/revision.js');
  const { createHash } = await import('node:crypto');
  const { resolve } = await import('node:path');
  const lockRoot = join(realpathSync(s.c.root), 'locks');
  mkdirSync(lockRoot, { mode: 0o700 });
  const fence = createMediaFence({
    root: lockRoot,
    python: '/usr/bin/python3',
    helperPath: resolve('apps/api/helpers/media_fence.py'),
    timeoutMs: 5000,
  });
  const revisions = createMetadataRevision(new Uint8Array(32));
  const protection = {
    fence,
    publications: createMediaPublicationLedger(s.c.db, () => 1000),
    fileIdentity: (libraryId: string, relativeFileKey: string) =>
      revisions.fileIdentity({ libraryId, relativeFileKey }),
    inspect: async (key: string) => ({
      digest: createHash('sha256')
        .update(readFileSync(join(s.options.musicRoot, key)))
        .digest('hex'),
    }),
  };
  const worker = createWorkerRunner({ ...s.options, mediaProtection: protection });
  await expect(worker.runOnce()).rejects.toThrow('synthetic crash');
  expect(
    s.c.db.connection.prepare('SELECT dirty,generation FROM media_publications').get(),
  ).toEqual({ dirty: 1, generation: 1 });
  expect(s.events()).toHaveLength(0);
  s.expire();
  const restart = createWorkerRunner({
    ...s.options,
    checkpoint: () => {},
    mediaProtection: protection,
  });
  expect(await restart.runOnce()).toBe(true);
  expect(s.events()).toHaveLength(1);
  expect(s.item().stage).toBe('registering');
  expect(
    s.c.db.connection.prepare('SELECT dirty,generation FROM media_publications').get(),
  ).toEqual({ dirty: 1, generation: 2 });
});
