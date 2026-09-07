import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  createLegacyV2,
  createTestContext,
} from '../../../tests/support/session-storage-harness.js';

let ctx: Awaited<ReturnType<typeof createTestContext>> | undefined;

afterEach(() => {
  ctx?.cleanup();
  ctx = undefined;
});

async function makeSUT() {
  ctx = await createTestContext();
  return ctx;
}

function invoke<T>(target: object, name: string, ...args: unknown[]): T {
  const candidate = Reflect.get(target, name);
  if (typeof candidate !== 'function') throw new Error(`Missing repository method: ${name}`);
  return Reflect.apply(candidate, target, args) as T;
}

const identityKey = 'a'.repeat(64);
const operationIdHash = 'b'.repeat(64);
const requestHash = 'c'.repeat(64);

function jobInput(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    identityKey,
    libraryId: 'library-1',
    operationIdHash,
    requestHash,
    items: [
      { id: 'item-1', sourceId: 'video-1' },
      { id: 'item-2', sourceId: 'video-2' },
    ],
    ...overrides,
  };
}

describe('import storage schema', () => {
  /** Fresh storage exposes schema v3 and every import ledger table. */
  it('should create the complete v3 ledger for fresh storage', async () => {
    const c = await makeSUT();
    expect(c.db.connection.prepare('PRAGMA user_version').get()).toEqual({ user_version: 3 });
    expect(
      c.db.connection
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('import_jobs','import_items','media_links','download_events','engine_state','worker_state') ORDER BY name",
        )
        .all()
        .map((row) => row.name),
    ).toEqual([
      'download_events',
      'engine_state',
      'import_items',
      'import_jobs',
      'media_links',
      'worker_state',
    ]);
  });

  /** A real v2 database migrates without changing its session or playlist receipt rows. */
  it('should preserve v2 rows while migrating to v3', async () => {
    const c = await makeSUT();
    const legacyData = join(c.root, 'legacy-v2');
    createLegacyV2(legacyData);
    const legacy = c.open(legacyData);
    legacy.connection
      .prepare('INSERT INTO instance(singleton,id,policy_revision,key_id) VALUES(1,?,?,?)')
      .run('legacy-instance', 1, c.vault.keyId);
    legacy.connection
      .prepare(
        "INSERT INTO playlist_operations(identity_key,operation_id_hash,request_hash,kind,status,created_at) VALUES(?,?,?,'create','pending',?)",
      )
      .run('a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), 99);
    legacy.close();

    const migrated = c.open(legacyData);
    expect(migrated.connection.prepare('PRAGMA user_version').get()).toEqual({ user_version: 3 });
    expect(migrated.connection.prepare('SELECT id FROM instance').get()).toEqual({
      id: 'legacy-instance',
    });
    expect(migrated.connection.prepare('SELECT status FROM playlist_operations').get()).toEqual({
      status: 'pending',
    });
  });

  /** SQL constraints reject raw paths, incomplete leases, and invalid terminal state payloads. */
  it('should fail closed when import ledger invariants are violated', async () => {
    const c = await makeSUT();
    const db = c.db.connection;
    db.prepare(
      'INSERT INTO import_jobs(id,identity_key,library_id,operation_id_hash,request_hash,created_at) VALUES(?,?,?,?,?,?)',
    ).run('job-1', 'a'.repeat(64), 'library-1', 'b'.repeat(64), 'c'.repeat(64), 100);

    expect(() =>
      db
        .prepare(
          "INSERT INTO media_links(id,library_id,relative_file_key,gonic_song_id,revision,availability,created_at) VALUES('media-1','library-1','/private/song.mp3','song-1',1,'available',100)",
        )
        .run(),
    ).toThrow();
    expect(() =>
      db
        .prepare(
          "INSERT INTO import_items(id,job_id,item_order,source_id,stage,attempt,lease_owner,stage_changed_at) VALUES('item-1','job-1',0,'video-1','ready',1,'worker-1',100)",
        )
        .run(),
    ).toThrow();
    expect(() =>
      db
        .prepare(
          "INSERT INTO import_items(id,job_id,item_order,source_id,stage,failure_code,attempt,stage_changed_at) VALUES('item-2','job-1',1,'video-2','failed',NULL,1,100)",
        )
        .run(),
    ).toThrow();
  });

  /** Recent, runnable, and source duplicate queries stay on their dedicated indexes. */
  it('should use the import ledger indexes for bounded queries', async () => {
    const c = await makeSUT();
    const plans = [
      c.db.connection
        .prepare(
          'EXPLAIN QUERY PLAN SELECT id FROM download_events WHERE identity_key=? AND library_id=? AND download_completed_at>=? ORDER BY download_completed_at DESC,id DESC',
        )
        .all(identityKey, 'library-1', 0),
      c.db.connection
        .prepare(
          "EXPLAIN QUERY PLAN SELECT id FROM import_items WHERE stage='queued' AND (lease_expires_at IS NULL OR lease_expires_at<=?) ORDER BY id",
        )
        .all(0),
      c.db.connection
        .prepare(
          'EXPLAIN QUERY PLAN SELECT id FROM import_items WHERE source_id=? AND stage=? ORDER BY id',
        )
        .all('video-1', 'ready'),
    ].map((rows) => rows.map((row) => row.detail).join(' '));
    expect(plans[0]).toContain('download_events_recent');
    expect(plans[1]).toContain('import_items_runnable');
    expect(plans[2]).toContain('import_items_source_duplicate');
  });
});

describe('import storage repositories', () => {
  /** Storage exposes synchronous repository factories without a test-only facade. */
  it('should expose synchronous repository factories', async () => {
    const paths = [
      '../src/storage/import-repository.js',
      '../src/storage/media-link-repository.js',
      '../src/storage/engine-repository.js',
      '../src/storage/worker-state-repository.js',
    ];
    const modules = await Promise.all(paths.map((path) => import(path)));
    expect(modules).toEqual([
      expect.objectContaining({ createImportRepository: expect.any(Function) }),
      expect.objectContaining({ createMediaLinkRepository: expect.any(Function) }),
      expect.objectContaining({ createEngineRepository: expect.any(Function) }),
      expect.objectContaining({ createWorkerStateRepository: expect.any(Function) }),
    ]);
  });

  /** Same operation and request replays one job while a changed request conflicts. */
  it('should distinguish import creation replay and conflict', async () => {
    const c = await makeSUT();
    c.setNow(0);
    expect(invoke(c.imports, 'createJob', jobInput())).toMatchObject({
      outcome: 'created',
      job: { id: 'job-1', status: 'queued' },
    });
    expect(invoke(c.imports, 'createJob', jobInput({ id: 'ignored-job' }))).toMatchObject({
      outcome: 'existing',
      job: { id: 'job-1' },
    });
    expect(
      invoke(c.imports, 'createJob', jobInput({ id: 'conflict-job', requestHash: 'd'.repeat(64) })),
    ).toMatchObject({ outcome: 'conflict', job: { id: 'job-1' } });
  });

  /** Only an expired lease can be reclaimed and the stale owner cannot renew it. */
  it('should serialize claims and reject a stale lease owner', async () => {
    const c = await makeSUT();
    c.setNow(0);
    invoke(c.imports, 'createJob', jobInput({ items: [{ id: 'item-1', sourceId: 'video-1' }] }));
    const other = c.importsFor(c.open());
    const first = invoke<{ id: string; attempt: number } | null>(c.imports, 'claimNext', {
      workerId: 'worker-a',
      leaseDurationMs: 50,
      engineVersion: 'nightly-1',
    });
    expect(first).toMatchObject({ id: 'item-1', attempt: 1 });
    expect(
      invoke(other, 'claimNext', {
        workerId: 'worker-b',
        leaseDurationMs: 50,
        engineVersion: 'nightly-1',
      }),
    ).toBeNull();

    c.setNow(50);
    expect(() =>
      invoke(c.imports, 'renewLease', {
        itemId: 'item-1',
        workerId: 'worker-a',
        leaseDurationMs: 50,
      }),
    ).toThrow('Import lease lost');
    expect(
      invoke<{ id: string; attempt: number } | null>(other, 'claimNext', {
        workerId: 'worker-b',
        leaseDurationMs: 50,
        engineVersion: 'nightly-1',
      }),
    ).toMatchObject({ id: 'item-1', attempt: 2 });
    expect(() =>
      invoke(c.imports, 'renewLease', {
        itemId: 'item-1',
        workerId: 'worker-a',
        leaseDurationMs: 50,
      }),
    ).toThrow('Import lease lost');
    expect(
      invoke(other, 'renewLease', {
        itemId: 'item-1',
        workerId: 'worker-b',
        leaseDurationMs: 100,
      }),
    ).toMatchObject({ leaseExpiresAt: 150 });
  });

  /** Cancellation stops queued items but lets a published item finish registration exactly once. */
  it('should enforce transitions and preserve published work during cancellation', async () => {
    const c = await makeSUT();
    c.setNow(0);
    invoke(c.imports, 'createJob', jobInput());
    invoke(c.imports, 'claimNext', {
      workerId: 'worker-a',
      leaseDurationMs: 1000,
      engineVersion: 'nightly-1',
    });
    expect(() =>
      invoke(c.imports, 'advanceItem', {
        itemId: 'item-1',
        workerId: 'worker-a',
        stage: 'ready',
      }),
    ).toThrow('Invalid import transition');
    expect(
      invoke(c.imports, 'advanceItem', {
        itemId: 'item-1',
        workerId: 'worker-a',
        stage: 'downloading',
        observed: {
          title: 'Synthetic title',
          channel: 'Synthetic channel',
          channelId: 'channel-1',
        },
      }),
    ).toMatchObject({
      observedTitle: 'Synthetic title',
      observedChannel: 'Synthetic channel',
      observedChannelId: 'channel-1',
    });
    for (const stage of ['postprocessing', 'publishing']) {
      invoke(c.imports, 'advanceItem', { itemId: 'item-1', workerId: 'worker-a', stage });
    }
    expect(invoke(c.imports, 'requestCancel', 'job-1')).toMatchObject({
      status: 'running',
      items: [
        { id: 'item-1', stage: 'publishing' },
        { id: 'item-2', stage: 'cancelled' },
      ],
    });
    invoke(c.imports, 'recordPublished', {
      itemId: 'item-1',
      workerId: 'worker-a',
      eventId: 'event-1',
    });
    const media = invoke<{ id: string }>(c.mediaLinks, 'create', {
      id: 'media-1',
      libraryId: 'library-1',
      relativeFileKey: 'Channel [channel-1]/Song [video-1].mp3',
      gonicSongId: 'song-1',
    });
    expect(media.id).toBe('media-1');
    expect(
      invoke(c.imports, 'finishRegistration', {
        itemId: 'item-1',
        workerId: 'worker-a',
        mediaLinkId: 'media-1',
      }),
    ).toMatchObject({ stage: 'ready', mediaLinkId: 'media-1' });
    expect(() =>
      invoke(c.imports, 'recordPublished', {
        itemId: 'item-1',
        workerId: 'worker-a',
        eventId: 'event-2',
      }),
    ).toThrow();
    expect(invoke(c.imports, 'getDownloadEvent', 'event-1')).toMatchObject({
      importItemId: 'item-1',
      registeredAt: 0,
    });
  });

  /** Retry copies only failed items into a child job without mutating the source job. */
  it('should retry failed items only', async () => {
    const c = await makeSUT();
    c.setNow(0);
    invoke(c.imports, 'createJob', jobInput());
    invoke(c.imports, 'claimNext', {
      workerId: 'worker-a',
      leaseDurationMs: 100,
      engineVersion: 'nightly-1',
    });
    invoke(c.imports, 'failItem', {
      itemId: 'item-1',
      workerId: 'worker-a',
      failureCode: 'download_failed',
    });
    invoke(c.imports, 'claimNext', {
      workerId: 'worker-a',
      leaseDurationMs: 100,
      engineVersion: 'nightly-1',
    });
    c.mediaLinks.create({
      id: 'media-existing',
      libraryId: 'library-1',
      relativeFileKey: 'Existing [video-2].mp3',
      gonicSongId: 'song-existing',
    });
    expect(
      invoke(c.imports, 'markDuplicate', {
        itemId: 'item-2',
        workerId: 'worker-a',
        mediaLinkId: 'media-existing',
      }),
    ).toMatchObject({ stage: 'duplicate', mediaLinkId: 'media-existing' });
    expect(
      invoke(c.imports, 'retryFailed', {
        sourceJobId: 'job-1',
        id: 'job-retry',
        operationIdHash: 'd'.repeat(64),
        requestHash: 'e'.repeat(64),
        itemIds: ['item-1'],
      }),
    ).toMatchObject({
      outcome: 'created',
      job: {
        id: 'job-retry',
        retryOfJobId: 'job-1',
        items: [{ sourceId: 'video-1', stage: 'queued' }],
      },
    });
    expect(() =>
      invoke(c.imports, 'retryFailed', {
        sourceJobId: 'job-1',
        id: 'bad-retry',
        operationIdHash: 'f'.repeat(64),
        requestHash: '1'.repeat(64),
        itemIds: ['item-2'],
      }),
    ).toThrow('Only failed import items can be retried');
    expect(invoke(c.imports, 'getJob', 'job-1')).toMatchObject({
      items: [
        { id: 'item-1', stage: 'failed' },
        { id: 'item-2', stage: 'duplicate' },
      ],
    });
  });

  /** Media, engine, and worker singleton repositories reject unsafe state and persist safe updates. */
  it('should store validated media and singleton engine worker state', async () => {
    const c = await makeSUT();
    c.setNow(0);
    expect(() =>
      invoke(c.mediaLinks, 'create', {
        id: 'bad-media',
        libraryId: 'library-1',
        relativeFileKey: '../outside.mp3',
        gonicSongId: 'song-bad',
      }),
    ).toThrow('Invalid media link');
    expect(invoke(c.engines, 'initialize', 'nightly-1')).toMatchObject({
      activeVersion: 'nightly-1',
      status: 'idle',
    });
    c.setNow(10);
    expect(() =>
      invoke(c.engines, 'recordCheck', {
        status: 'candidate_ready',
        candidateVersion: 'nightly-2',
        succeeded: false,
      }),
    ).toThrow('Invalid engine state');
    invoke(c.engines, 'recordCheck', {
      status: 'candidate_ready',
      candidateVersion: 'nightly-2',
      succeeded: true,
    });
    expect(invoke(c.engines, 'activateCandidate')).toMatchObject({
      activeVersion: 'nightly-2',
      previousVersion: 'nightly-1',
      candidateVersion: null,
    });
    expect(invoke(c.engines, 'restorePrevious')).toMatchObject({
      activeVersion: 'nightly-1',
      previousVersion: 'nightly-2',
    });
    expect(
      invoke(c.workerStates, 'heartbeat', { workerId: 'worker-a', status: 'idle' }),
    ).toMatchObject({ workerId: 'worker-a', heartbeatAt: 10, status: 'idle' });
  });
});
