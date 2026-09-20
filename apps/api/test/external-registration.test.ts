import { lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeSubsonic } from '../../../packages/test-support/src/fake-subsonic.js';
import type { RegistrationFixture } from '../../../packages/test-support/src/subsonic-fixtures.js';
import { proof } from '../../../tests/support/subsonic-harness.js';
import { createTestContext } from '../../../tests/support/session-storage-harness.js';
import { createExternalWatchRepository } from '../src/storage/external-watch-repository.js';
import { createSubsonicClient } from '../src/subsonic/client.js';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function makeSUT(change: Partial<RegistrationFixture> = {}, count = 2) {
  const module = await import('../src/imports/external-registration-service.js').catch(() => ({}));
  expect(module).toHaveProperty('createExternalRegistrationService');
  if (!('createExternalRegistrationService' in module)) return undefined;
  const c = await createTestContext();
  cleanups.push(c.cleanup);
  let now = 1_000;
  const fixture: RegistrationFixture = {
    statuses: [
      { scanning: false, count: 0 },
      { scanning: true, count: 1 },
      { scanning: false, count },
    ],
    roots: [{ id: 'user', name: 'user' }],
    directories: {
      user: [{ id: 'alice', title: 'alice', isDir: true }],
      alice: Array.from({ length: count }, (_, index) => ({
        id: `external-song-${index}`,
        title: 'Synthetic external',
        isDir: false,
        path: `user/alice/external-${index}.mp3`,
      })),
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
  const musicPath = join(c.root, 'music');
  mkdirSync(join(musicPath, 'user', 'alice'), { recursive: true });
  const musicRoot = realpathSync(musicPath);
  const repository = createExternalWatchRepository({ database: c.db, clock: () => now });
  repository.syncOwners({
    instanceId: 'instance-1',
    policyRevision: 1,
    owners: [
      {
        libraryId: 'library',
        accountDirectory: 'alice',
        username: 'alice',
        identityKey: 'a'.repeat(64),
      },
    ],
  });
  for (let index = 0; index < count; index += 1) {
    const key = `user/alice/external-${index}.mp3`;
    const file = join(musicRoot, key);
    writeFileSync(file, `external-${index}`);
    const stat = lstatSync(file, { bigint: true });
    repository.observe({
      libraryId: 'library',
      relativeFileKey: key,
      accountDirectory: 'alice',
      identityKey: 'a'.repeat(64),
      state: 'settling',
      fingerprint: {
        device: stat.dev,
        inode: stat.ino,
        size: stat.size,
        mtimeNs: stat.mtimeNs,
        ctimeNs: stat.ctimeNs,
        linkCount: Number(stat.nlink),
      },
      nextAttemptAt: now,
    });
    const claim = repository.claimObservations({
      workerId: 'admission',
      leaseDurationMs: 100,
      states: ['settling'],
      limit: 1,
    })[0]!;
    repository.admitExternal({
      libraryId: 'library',
      relativeFileKey: key,
      accountDirectory: 'alice',
      identityKey: 'a'.repeat(64),
      instanceId: 'instance-1',
      policyRevision: 1,
      workerId: 'admission',
      generation: claim.generation,
      fingerprint: claim.fingerprint!,
      eventId: `external-event-${index}`,
      mediaLinkId: `external-media-${index}`,
    });
  }
  const options = {
    database: c.db,
    musicRoot,
    scanClient,
    clock: () => now,
    libraries: [{ id: 'library', musicFolderId: '0', relativeRoot: 'user' }],
    timeoutMs: 100,
    pollMs: 10,
    retryMs: 30_000,
    wait: async (ms: number, signal: AbortSignal) => {
      signal.throwIfAborted();
      now += ms;
    },
  };
  const factory = (overrides: Partial<typeof options> = {}) =>
    module.createExternalRegistrationService({ ...options, ...overrides });
  return {
    c,
    repository,
    service: factory(),
    factory,
    fixture,
    options,
    upstream,
    musicRoot,
    advance: (ms: number) => (now += ms),
  };
}

describe('external Gonic registration', () => {
  it('should register up to one shared-cycle batch by exact path', async () => {
    const s = await makeSUT();
    if (!s) return;
    expect(await s.service.runOnce()).toBe(true);
    expect(s.repository.listObservations('library').map((row) => row.state)).toEqual([
      'ready',
      'ready',
    ]);
    expect(
      s.c.db.connection
        .prepare('SELECT gonic_song_id,availability FROM media_links ORDER BY relative_file_key')
        .all(),
    ).toEqual([
      { gonic_song_id: 'external-song-0', availability: 'available' },
      { gonic_song_id: 'external-song-1', availability: 'available' },
    ]);
    expect(
      s.c.db.connection.prepare('SELECT count(registered_at) AS count FROM download_events').get(),
    ).toEqual({ count: 2 });
    expect(
      s.upstream.requests.filter((request) => request.pathname.endsWith('startScan')),
    ).toHaveLength(1);
    expect(await s.service.runOnce()).toBe(false);
  });

  it('should yield the coordinator while an import item is registering', async () => {
    const s = await makeSUT({}, 1);
    if (!s) return;
    s.c.imports.createJob({
      id: 'priority-job',
      identityKey: 'b'.repeat(64),
      libraryId: 'library',
      accountDirectory: 'bob',
      operationIdHash: 'c'.repeat(64),
      requestHash: 'd'.repeat(64),
      items: [{ id: 'priority-item', sourceId: 'abcdefghijk' }],
      deduplicate: false,
    });
    s.c.db.connection
      .prepare(
        "INSERT INTO media_links(id,library_id,relative_file_key,gonic_song_id,revision,availability,created_at) VALUES('priority-media','library','user/bob/import.mp3',NULL,1,'unavailable',0)",
      )
      .run();
    s.c.db.connection
      .prepare(
        "UPDATE import_items SET stage='registering',media_link_id='priority-media',registering_at=0,stage_changed_at=0 WHERE id='priority-item'",
      )
      .run();
    expect(await s.service.runOnce()).toBe(false);
    expect(s.upstream.requests).toHaveLength(0);
    expect(s.repository.listObservations('library')[0]?.state).toBe('registering');
  });

  it('should back off ambiguous exact paths without losing history', async () => {
    const duplicate = {
      id: 'duplicate',
      title: 'Duplicate',
      isDir: false,
      path: 'user/alice/external-0.mp3',
    };
    const s = await makeSUT(
      {
        directories: {
          user: [{ id: 'alice', title: 'alice', isDir: true }],
          alice: [{ id: 'first', title: 'First', isDir: false, path: duplicate.path }, duplicate],
        },
      },
      1,
    );
    if (!s) return;
    expect(await s.service.runOnce()).toBe(true);
    expect(s.repository.listObservations('library')[0]).toMatchObject({
      state: 'registering',
      failureCode: 'registration_ambiguous',
      leaseOwner: null,
    });
    expect(
      s.c.db.connection
        .prepare('SELECT count(*) AS total,count(registered_at) AS ready FROM download_events')
        .get(),
    ).toEqual({ total: 1, ready: 0 });
  });

  it('should claim no more than 50 external targets in one scan cycle', async () => {
    const s = await makeSUT({}, 51);
    if (!s) return;
    expect(await s.service.runOnce()).toBe(true);
    expect(
      s.repository
        .listObservations('library')
        .filter((observation) => observation.state === 'ready'),
    ).toHaveLength(50);
    expect(
      s.repository
        .listObservations('library')
        .filter((observation) => observation.state === 'registering'),
    ).toHaveLength(1);
  });

  it('should join an existing scan without starting a duplicate', async () => {
    const s = await makeSUT(
      {
        statuses: [
          { scanning: true, count: 0 },
          { scanning: false, count: 1 },
        ],
      },
      1,
    );
    if (!s) return;
    expect(await s.service.runOnce()).toBe(true);
    expect(s.repository.listObservations('library')[0]?.state).toBe('ready');
    expect(
      s.upstream.requests.filter((request) => request.pathname.endsWith('startScan')),
    ).toHaveLength(0);
  });

  it('should share one scan across external targets from different libraries', async () => {
    const s = await makeSUT({}, 1);
    if (!s) return;
    s.repository.syncOwners({
      instanceId: 'instance-1',
      policyRevision: 1,
      owners: [
        {
          libraryId: 'library',
          accountDirectory: 'alice',
          username: 'alice',
          identityKey: 'a'.repeat(64),
        },
        {
          libraryId: 'library-2',
          accountDirectory: 'bob',
          username: 'bob',
          identityKey: 'b'.repeat(64),
        },
      ],
    });
    const key = 'user/bob/external.mp3';
    const file = join(s.musicRoot, key);
    mkdirSync(join(s.musicRoot, 'user', 'bob'), { recursive: true });
    writeFileSync(file, 'external-bob');
    const stat = lstatSync(file, { bigint: true });
    s.repository.observe({
      libraryId: 'library-2',
      relativeFileKey: key,
      accountDirectory: 'bob',
      identityKey: 'b'.repeat(64),
      state: 'settling',
      fingerprint: {
        device: stat.dev,
        inode: stat.ino,
        size: stat.size,
        mtimeNs: stat.mtimeNs,
        ctimeNs: stat.ctimeNs,
        linkCount: Number(stat.nlink),
      },
      nextAttemptAt: 1_000,
    });
    const claim = s.repository.claimObservations({
      workerId: 'admission-bob',
      leaseDurationMs: 100,
      states: ['settling'],
      limit: 1,
    })[0]!;
    s.repository.admitExternal({
      libraryId: 'library-2',
      relativeFileKey: key,
      accountDirectory: 'bob',
      identityKey: 'b'.repeat(64),
      instanceId: 'instance-1',
      policyRevision: 1,
      workerId: 'admission-bob',
      generation: claim.generation,
      fingerprint: claim.fingerprint!,
      eventId: 'external-event-bob',
      mediaLinkId: 'external-media-bob',
    });
    s.fixture.directories.user!.push({ id: 'bob', title: 'bob', isDir: true });
    s.fixture.directories.bob = [
      { id: 'external-song-bob', title: 'Bob', isDir: false, path: key },
    ];
    const service = s.factory({
      libraries: [
        { id: 'library', musicFolderId: '0', relativeRoot: 'user' },
        { id: 'library-2', musicFolderId: '0', relativeRoot: 'user' },
      ],
    });
    expect(await service.runOnce()).toBe(true);
    expect(s.repository.listObservations().map((observation) => observation.state)).toEqual([
      'ready',
      'ready',
    ]);
    expect(
      s.upstream.requests.filter((request) => request.pathname.endsWith('startScan')),
    ).toHaveLength(1);
  });

  it.each([
    ['missing', 'registration_pending'],
    ['malformed', 'registration_path'],
    ['wrong-library', 'registration_path'],
    ['scan-error', 'registration_upstream'],
  ] as const)('should classify %s evidence without registering it', async (mode, failureCode) => {
    const s = await makeSUT({}, 1);
    if (!s) return;
    if (mode === 'missing') s.fixture.directories.alice = [];
    if (mode === 'malformed') s.fixture.directories.alice![0]!.path = '../external-0.mp3';
    if (mode === 'scan-error') s.fixture.scanError = 50;
    const service =
      mode === 'wrong-library'
        ? s.factory({
            libraries: [{ id: 'other-library', musicFolderId: '0', relativeRoot: 'user' }],
          })
        : s.service;
    expect(await service.runOnce()).toBe(true);
    expect(s.repository.listObservations('library')[0]).toMatchObject({
      state: 'registering',
      failureCode,
    });
    expect(
      s.c.db.connection.prepare('SELECT count(registered_at) AS ready FROM download_events').get(),
    ).toEqual({ ready: 0 });
  });

  it('should persist timeout backoff and resume after database reopen without a duplicate event', async () => {
    const s = await makeSUT({ statuses: [{ scanning: true, count: 0 }] }, 1);
    if (!s) return;
    expect(await s.service.runOnce()).toBe(true);
    expect(s.repository.listObservations('library')[0]).toMatchObject({
      state: 'registering',
      failureCode: 'registration_timeout',
    });
    const calls = s.upstream.requests.length;
    const reopened = s.c.open();
    const restarted = s.factory({ database: reopened });
    expect(await restarted.runOnce()).toBe(false);
    expect(s.upstream.requests).toHaveLength(calls);
    s.advance(30_000);
    s.fixture.statuses = [{ scanning: false, count: 1 }];
    expect(await restarted.runOnce()).toBe(true);
    expect(s.repository.listObservations('library')[0]?.state).toBe('ready');
    expect(
      s.c.db.connection.prepare('SELECT count(*) AS total FROM download_events').get(),
    ).toEqual({ total: 1 });
  });

  it('should retain a conflicting existing Gonic binding with exponential retry', async () => {
    const s = await makeSUT({}, 1);
    if (!s) return;
    s.c.db.connection
      .prepare("UPDATE media_links SET gonic_song_id='different-song' WHERE id='external-media-0'")
      .run();
    expect(await s.service.runOnce()).toBe(true);
    expect(s.repository.listObservations('library')[0]).toMatchObject({
      state: 'registering',
      failureCode: 'registration_conflict',
      nextAttemptAt: 31_100,
    });
    expect(
      s.c.db.connection
        .prepare("SELECT gonic_song_id,availability FROM media_links WHERE id='external-media-0'")
        .get(),
    ).toEqual({ gonic_song_id: 'different-song', availability: 'unavailable' });
  });

  it('should cap registration retry backoff at one hour', async () => {
    const s = await makeSUT({}, 1);
    if (!s) return;
    s.c.db.connection
      .prepare(
        "UPDATE external_file_observations SET attempt=20 WHERE library_id='library' AND relative_file_key='user/alice/external-0.mp3'",
      )
      .run();
    s.c.db.connection
      .prepare("UPDATE media_links SET gonic_song_id='different-song' WHERE id='external-media-0'")
      .run();
    expect(await s.service.runOnce()).toBe(true);
    expect(s.repository.listObservations('library')[0]?.nextAttemptAt).toBe(3_601_100);
  });

  it('should roll back media mapping when event completion fails', async () => {
    const s = await makeSUT({}, 1);
    if (!s) return;
    s.c.db.connection.exec(
      "CREATE TRIGGER refuse_external_registration BEFORE UPDATE OF registered_at ON download_events WHEN NEW.id='external-event-0' BEGIN SELECT RAISE(ABORT,'synthetic-conflict'); END;",
    );
    expect(await s.service.runOnce()).toBe(true);
    expect(
      s.c.db.connection
        .prepare(
          "SELECT gonic_song_id,availability,revision,validated_at FROM media_links WHERE id='external-media-0'",
        )
        .get(),
    ).toEqual({
      gonic_song_id: null,
      availability: 'unavailable',
      revision: 1,
      validated_at: null,
    });
    expect(
      s.c.db.connection
        .prepare("SELECT registered_at FROM download_events WHERE id='external-event-0'")
        .get(),
    ).toEqual({ registered_at: null });
    expect(s.repository.listObservations('library')[0]).toMatchObject({
      state: 'registering',
      failureCode: 'registration_upstream',
    });
  });

  it('should preserve the event when the file disappears before completion', async () => {
    const { unlinkSync } = await import('node:fs');
    const s = await makeSUT({}, 1);
    if (!s) return;
    unlinkSync(join(s.musicRoot, 'user/alice/external-0.mp3'));
    expect(await s.service.runOnce()).toBe(true);
    expect(s.repository.listObservations('library')[0]).toMatchObject({
      state: 'registering',
      failureCode: 'registration_conflict',
    });
    expect(
      s.c.db.connection
        .prepare('SELECT count(*) AS total,count(registered_at) AS ready FROM download_events')
        .get(),
    ).toEqual({ total: 1, ready: 0 });
  });

  it('should fence concurrent cycles and preserve pending work on cancellation', async () => {
    const s = await makeSUT({ statuses: [{ scanning: true, count: 0 }] }, 1);
    if (!s) return;
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = s.factory({
      wait: async () => {
        entered();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    });
    const abort = new AbortController();
    const run = blocked.runOnce(abort.signal);
    await waiting;
    expect(await s.service.runOnce()).toBe(false);
    abort.abort();
    release();
    expect(await run).toBe(true);
    expect(s.repository.listObservations('library')[0]).toMatchObject({
      state: 'registering',
      failureCode: 'registration_cancelled',
    });
  });
});
