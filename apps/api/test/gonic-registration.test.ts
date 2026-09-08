import { afterEach, expect, it } from 'vitest';
import { createTestContext } from '../../../tests/support/session-storage-harness.js';
import { createFakeSubsonic } from '../../../packages/test-support/src/fake-subsonic.js';
import type { RegistrationFixture } from '../../../packages/test-support/src/subsonic-fixtures.js';
import { createSubsonicClient } from '../src/subsonic/client.js';
import { proof } from '../../../tests/support/subsonic-harness.js';
import { createWorkerLedger } from '../src/imports/worker-state.js';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
type Options = import('../src/imports/registration-service.js').RegistrationOptions;
async function factory(options: Options) {
  const { createRegistrationService } = await import('../src/imports/registration-service.js');
  return createRegistrationService(options);
}
async function makeSUT(change: Partial<RegistrationFixture> = {}, count = 2) {
  const c = await createTestContext();
  cleanups.push(c.cleanup);
  let now = 1000;
  const clock = () => now;
  const fixture: RegistrationFixture = {
    statuses: [
      { scanning: false, count: 0 },
      { scanning: true, count: 1 },
      { scanning: false, count: 2 },
    ],
    roots: [
      { id: 'user', name: 'user' },
      { id: 'unrelated', name: 'elsewhere' },
    ],
    directories: {
      user: [
        { id: 'channel', title: 'channel', isDir: true },
        { id: 'other', title: 'other', isDir: true },
      ],
      channel: [
        { id: 'song-a', title: 'Same', isDir: false, path: 'user/channel/a.mp3' },
        { id: 'song-b', title: 'Same', isDir: false, path: 'user/channel/b.mp3' },
      ],
    },
    ...change,
  };
  const upstream = await createFakeSubsonic({ registration: fixture });
  cleanups.push(() => upstream.close());
  const scanClient = createSubsonicClient({
    upstream: upstream.url,
    proof: { ...proof, username: 'fixture-worker' },
    timeoutMs: 100,
  });
  const job = c.imports.createJob({
    id: 'job',
    identityKey: 'a'.repeat(64),
    libraryId: 'library',
    operationIdHash: 'b'.repeat(64),
    requestHash: 'c'.repeat(64),
    items: Array.from({ length: count }, (_, i) => ({ id: `item-${i}`, sourceId: `video-${i}` })),
  });
  const ledger = createWorkerLedger(c.db, clock, 'publisher', 1000);
  for (let i = 0; i < count; i++) {
    const claim = ledger.claim()!;
    ledger.advance(claim.item.id, 'downloading', {
      title: 'Same',
      channel: 'channel',
      channelId: 'channel-id',
    });
    ledger.advance(claim.item.id, 'postprocessing');
    ledger.saveIntent(
      claim.item.id,
      ledger.newIntent(`user/channel/${String.fromCharCode(97 + i)}.mp3`, `attempt-${i}/audio.mp3`),
    );
    ledger.complete(claim.item.id, false);
  }
  const options: Options = {
    database: c.db,
    scanClient,
    clock,
    libraries: [{ id: 'library', musicFolderId: '0', relativeRoot: 'user' }],
    timeoutMs: 100,
    pollMs: 10,
    retryMs: 1000,
    wait: async (ms, signal) => {
      signal.throwIfAborted();
      now += ms;
    },
  };
  return {
    c,
    job,
    fixture,
    upstream,
    options,
    service: await factory(options),
    advance: (ms: number) => {
      now += ms;
    },
    items: () => c.imports.getJob('job')!.items,
  };
}

/** Two same-title files resolve by exact path with one shared scan and branch cache. */
it('should register a job atomically by exact nested paths and avoid full traversal', async () => {
  const s = await makeSUT();
  expect(await s.service.runOnce()).toBe(true);
  expect(s.items().map((x) => x.stage)).toEqual(['ready', 'ready']);
  expect(s.items().map((x) => s.c.mediaLinks.get(x.mediaLinkId!)!.gonicSongId)).toEqual([
    'song-a',
    'song-b',
  ]);
  expect(
    s.c.db.connection
      .prepare('SELECT registered_at FROM download_events')
      .all()
      .every((x) => typeof x.registered_at === 'number'),
  ).toBe(true);
  expect(s.upstream.requests.filter((x) => x.pathname.endsWith('startScan'))).toHaveLength(1);
  expect(
    s.upstream.requests
      .filter((x) => x.pathname.endsWith('getMusicDirectory'))
      .map((x) => x.searchParams.get('id')),
  ).toEqual(['user', 'channel']);
  expect(
    s.upstream.requests
      .find((x) => x.pathname.endsWith('getIndexes'))!
      .searchParams.get('musicFolderId'),
  ).toBe('0');
  expect(await s.service.runOnce()).toBe(false);
});
/** An empty gonic library omits count until the first scan discovers the published track. */
it('should start the first scan with omitted zero count and register exactly one event', async () => {
  const s = await makeSUT(
    {
      statuses: [{ scanning: false }, { scanning: true }, { scanning: false, count: 1 }],
    },
    1,
  );
  expect(await s.service.runOnce()).toBe(true);
  expect(s.items().map((item) => item.stage)).toEqual(['ready']);
  expect(
    s.upstream.requests.filter((request) => request.pathname.endsWith('startScan')),
  ).toHaveLength(1);
  expect(s.c.mediaLinks.get(s.items()[0]!.mediaLinkId!)!.gonicSongId).toBe('song-a');
  expect(
    s.c.db.connection
      .prepare('SELECT count(*) AS total, count(registered_at) AS registered FROM download_events')
      .get(),
  ).toEqual({ total: 1, registered: 1 });
  expect(await s.service.runOnce()).toBe(false);
});
/** Existing scans are joined; delayed folder visibility is retried without another scan. */
it('should join scanning and retry delayed visibility within a bounded cycle', async () => {
  const s = await makeSUT({
    statuses: [
      { scanning: true, count: 0 },
      { scanning: false, count: 2 },
    ],
    visibleAfter: 2,
  });
  await s.service.runOnce();
  expect(s.items().every((x) => x.stage === 'ready')).toBe(true);
  expect(s.upstream.requests.some((x) => x.pathname.endsWith('startScan'))).toBe(false);
});
/** Ambiguity, missing paths, malformed paths and scan errors retain publication with durable backoff. */
it.each(['denial', 'timeout', 'zero', 'two', 'malformed'] as const)(
  'should retain registering with backoff on %s and resume after restart',
  async (mode) => {
    const s = await makeSUT({}, 1);
    if (mode === 'denial') s.fixture.scanError = 50;
    if (mode === 'timeout') s.fixture.statuses = [{ scanning: true, count: 0 }];
    if (mode === 'zero') s.fixture.directories.channel = [];
    if (mode === 'two')
      s.fixture.directories.channel!.push({
        id: 'duplicate-id',
        title: 'Other',
        isDir: false,
        path: 'user/channel/a.mp3',
      });
    if (mode === 'malformed') s.fixture.directories.channel![0]!.path = '../user/channel/a.mp3';
    await s.service.runOnce();
    expect(s.items()[0]!.stage).toBe('registering');
    expect(s.c.db.connection.prepare('SELECT registered_at FROM download_events').get()).toEqual({
      registered_at: null,
    });
    const retry = s.c.db.connection
      .prepare('SELECT failure_code,next_attempt_at FROM registration_attempts')
      .get();
    expect(retry?.failure_code).toBeTypeOf('string');
    const calls = s.upstream.requests.length;
    const reopened = s.c.open();
    const restarted = await factory({ ...s.options, database: reopened });
    expect(await restarted.runOnce()).toBe(false);
    expect(s.upstream.requests).toHaveLength(calls);
    s.advance(10000);
    s.fixture.scanError = 0;
    s.fixture.statuses = [{ scanning: false, count: 1 }];
    s.fixture.directories.channel = [
      { id: 'song-a', title: 'Unrelated title', isDir: false, path: './user//channel/a.mp3' },
    ];
    await restarted.runOnce();
    expect(s.items()[0]!.stage).toBe('ready');
    expect(s.c.db.connection.prepare('SELECT count(*) AS n FROM download_events').get()).toEqual({
      n: 1,
    });
  },
);
/** Concurrent service instances cannot launch overlapping scan cycles. */
it('should fence concurrent cycles and preserve pending work on cancellation', async () => {
  const s = await makeSUT();
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((r) => {
    entered = r;
  });
  const blocked = await factory({
    ...s.options,
    wait: async () => {
      entered();
      await new Promise<void>((r) => {
        release = r;
      });
    },
  });
  const abort = new AbortController();
  const run = blocked.runOnce(abort.signal);
  await waiting;
  expect(await s.service.runOnce()).toBe(false);
  abort.abort();
  release();
  await run;
  expect(s.items().every((x) => x.stage === 'registering')).toBe(true);
});

/** A failed final event update rolls back its preceding mapping update and keeps its sibling independent. */
it('should roll back mapping when event finalization fails while registering valid siblings', async () => {
  const s = await makeSUT();
  s.c.db.connection.exec(
    "CREATE TRIGGER refuse_registration BEFORE UPDATE OF registered_at ON download_events WHEN NEW.import_item_id='item-0' BEGIN SELECT RAISE(ABORT,'synthetic-conflict'); END;",
  );
  await s.service.runOnce();
  expect(s.items().map((item) => item.stage)).toEqual(['registering', 'ready']);
  expect(s.c.mediaLinks.get(s.items()[0]!.mediaLinkId!)!).toMatchObject({
    gonicSongId: null,
    revision: 1,
    validatedAt: null,
  });
  expect(s.c.mediaLinks.get(s.items()[1]!.mediaLinkId!)!).toMatchObject({
    gonicSongId: 'song-b',
    revision: 2,
  });
});
/** An expired owner cannot commit a late response after another process has resumed the cycle. */
it('should fence stale ownership across durable restart', async () => {
  const s = await makeSUT({}, 1);
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((r) => {
    entered = r;
  });
  const old = await factory({
    ...s.options,
    wait: async () => {
      entered();
      await new Promise<void>((r) => {
        release = r;
      });
    },
  });
  const oldRun = old.runOnce();
  await waiting;
  s.advance(10000);
  s.fixture.statuses = [{ scanning: false, count: 1 }];
  await s.service.runOnce();
  release();
  await oldRun;
  expect(s.items()[0]!.stage).toBe('ready');
  expect(s.c.mediaLinks.get(s.items()[0]!.mediaLinkId!)!.revision).toBe(2);
});
/** Upstream HTTP failure and stalled bodies remain retryable and never register a song. */
it.each([{ status: 503 }, { stall: 'body' as const }])(
  'should bound transport failure %j',
  async (scenario) => {
    const s = await makeSUT({}, 1);
    const upstream = await createFakeSubsonic(scenario);
    cleanups.push(() => upstream.close());
    const service = await factory({
      ...s.options,
      scanClient: createSubsonicClient({ upstream: upstream.url, proof, timeoutMs: 30 }),
    });
    await service.runOnce();
    expect(s.items()[0]!.stage).toBe('registering');
    expect(s.c.mediaLinks.get(s.items()[0]!.mediaLinkId!)!.gonicSongId).toBeNull();
  },
);
/** Root and folder ambiguity, case mismatches and invalid leaf paths must not use first-result fallbacks. */
it.each([
  'root-duplicate',
  'branch-duplicate',
  'root-case',
  'outside-root',
  'absolute',
  'backslash',
  'nul',
] as const)('should reject %s identity evidence', async (mode) => {
  const s = await makeSUT({}, 1);
  if (mode === 'root-duplicate') s.fixture.roots.push({ id: 'another-root', name: 'user' });
  if (mode === 'branch-duplicate')
    s.fixture.directories.user!.push({ id: 'another-channel', title: 'channel', isDir: true });
  if (mode === 'root-case') s.fixture.roots[0]!.name = 'USER';
  if (mode === 'outside-root')
    s.options.libraries = [{ id: 'library', musicFolderId: '0', relativeRoot: 'another' }];
  if (mode === 'absolute') s.fixture.directories.channel![0]!.path = '/user/channel/a.mp3';
  if (mode === 'backslash') s.fixture.directories.channel![0]!.path = 'user\\channel\\a.mp3';
  if (mode === 'nul') s.fixture.directories.channel![0]!.path = 'user/channel/a.mp3\0';
  const service = await factory(s.options);
  await service.runOnce();
  expect(s.items()[0]!.stage).toBe('registering');
  expect(s.c.mediaLinks.get(s.items()[0]!.mediaLinkId!)!.gonicSongId).toBeNull();
});
/** Durable registration backoff is preserved in the existing backup/restore flow. */
it('should preserve registration attempts and singleton scheduling in backup restore', async () => {
  const s = await makeSUT({ scanError: 50 }, 1);
  await s.service.runOnce();
  const { join } = await import('node:path');
  const backup = join(s.c.root, 'backup');
  await s.c.createBackup(s.c.db, s.c.keyPath, backup);
  const target = join(s.c.root, 'restored');
  await s.c.restoreBackup(backup, target);
  const restored = s.c.open(target);
  expect(restored.connection.prepare('SELECT * FROM registration_attempts').all()).toEqual(
    s.c.db.connection.prepare('SELECT * FROM registration_attempts').all(),
  );
});

/** Current-account getSong uses its own proof and never inherits fixed worker identity or private paths. */
it('should keep current-account getSong separate from fixed-worker registration proof', async () => {
  const { createTestContext: authContext, native } =
    await import('../../../tests/support/auth-harness.js');
  const auth = await authContext();
  cleanups.push(() => auth.cleanup());
  auth.state.registration = {
    statuses: [{ scanning: false, count: 1 }],
    roots: [{ id: 'root', name: 'user' }],
    directories: { root: [{ id: 'tr-opaque', title: 'Same', isDir: false, path: 'user/a.mp3' }] },
  };
  const account = createSubsonicClient({
    upstream: auth.options.upstream,
    proof: { username: native.username, t: native.t, s: native.s },
    timeoutMs: 100,
  });
  const worker = createSubsonicClient({
    upstream: auth.options.upstream,
    proof: { username: 'fixed-fixture-worker', t: native.t, s: native.s },
    timeoutMs: 100,
  });
  await worker.getScanStatus();
  await worker.registrationDirectory('root');
  expect(await account.getSong('tr-opaque')).toEqual({
    id: 'tr-opaque',
    title: 'Same',
    isDir: false,
  });
  expect(auth.requests.map((url) => url.searchParams.get('u'))).toEqual([
    'fixed-fixture-worker',
    'fixed-fixture-worker',
    native.username,
  ]);
  expect(auth.requests.every((url) => url.searchParams.get('c') === 'musiclatte-web')).toBe(true);
  await expect(account.getSong('missing')).rejects.toMatchObject({ kind: 'not_found' });
});

/** Batch consumers receive explicit ready or registration_pending outcomes for each claimed item. */
it('should return item outcomes from registerPending', async () => {
  const s = await makeSUT();
  s.fixture.directories.channel!.pop();
  expect(await s.service.registerPending()).toEqual([
    { itemId: 'item-0', status: 'ready' },
    { itemId: 'item-1', status: 'registration_pending' },
  ]);
});

/** Additive v4 migration retains an unpublished mapping's exact key without inventing a song ID. */
it('should migrate an existing v4 pending mapping to v5 without rewriting it', async () => {
  const s = await makeSUT({}, 1);
  const { createLegacyV2 } = await import('../../../tests/support/session-storage-harness.js');
  const { DatabaseSync } = await import('node:sqlite');
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const legacy = join(s.c.root, 'legacy');
  createLegacyV2(legacy);
  const db = new DatabaseSync(join(legacy, 'management.sqlite'));
  try {
    for (const name of ['003-imports', '004-import-worker'])
      db.exec(
        readFileSync(new URL(`../src/storage/migrations/${name}.sql`, import.meta.url), 'utf8'),
      );
    db.prepare(
      "INSERT INTO media_links VALUES('pending','library','user/channel/a.mp3',NULL,1,'unavailable',1000,NULL)",
    ).run();
  } finally {
    db.close();
  }
  const migrated = s.c.open(legacy);
  expect(migrated.connection.prepare('PRAGMA user_version').get()).toEqual({ user_version: 13 });
  expect(s.c.mediaLinksFor(migrated).get('pending')).toMatchObject({
    relativeFileKey: 'user/channel/a.mp3',
    gonicSongId: null,
    revision: 1,
  });
  expect(migrated.connection.prepare('SELECT * FROM registration_cycle').get()).toEqual({
    singleton: 1,
    owner: null,
    expires_at: 0,
    next_scan_at: 0,
  });
});
