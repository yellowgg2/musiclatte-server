import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext } from '../../../tests/support/session-storage-harness.js';

let ctx: Awaited<ReturnType<typeof createTestContext>> | undefined;

afterEach(() => {
  ctx?.cleanup();
  ctx = undefined;
});

async function repositoryModule() {
  return import('../src/storage/external-watch-repository.js').catch(() => ({}));
}

describe('external watch storage', () => {
  /** External events use a direct MediaLink while provenance constraints reject mixed shapes. */
  it('should store import-independent recent events without changing recent ordering', async () => {
    ctx = await createTestContext();
    const db = ctx.db.connection;
    db.prepare(
      "INSERT INTO media_links(id,library_id,relative_file_key,gonic_song_id,revision,availability,created_at) VALUES('external-media','music','listener/new.mp3',NULL,1,'unavailable',10)",
    ).run();
    db.prepare(
      "INSERT INTO download_events(id,import_item_id,media_link_id,provenance,identity_key,library_id,download_completed_at) VALUES('external-event',NULL,'external-media','external',?,'music',10)",
    ).run('f'.repeat(64));

    expect(
      ctx.imports.listRecent({
        identityKey: 'f'.repeat(64),
        libraries: ['music'],
        from: 0,
        to: 20,
        asOf: 20,
        highWater: ctx.imports.recentHighWater(),
        limit: 10,
      }),
    ).toMatchObject([
      {
        id: 'external-event',
        importItemId: null,
        mediaLinkId: 'external-media',
        provenance: 'external',
      },
    ]);
    expect(() =>
      db
        .prepare(
          "INSERT INTO download_events(id,import_item_id,media_link_id,provenance,identity_key,library_id,download_completed_at) VALUES('invalid-external','missing','external-media','external',?,'music',10)",
        )
        .run('f'.repeat(64)),
    ).toThrow();
    expect(() =>
      db
        .prepare(
          "INSERT INTO download_events(id,import_item_id,media_link_id,provenance,identity_key,library_id,download_completed_at) VALUES('invalid-import',NULL,'external-media','musiclatte',?,'music',10)",
        )
        .run('f'.repeat(64)),
    ).toThrow();
  });

  /** Owner projection stays exact and rejects two usernames sharing one account directory. */
  it('should replace owner projections with exact account identity bindings', async () => {
    const module = await repositoryModule();
    expect(module).toHaveProperty('createExternalWatchRepository');
    if (!('createExternalWatchRepository' in module)) return;
    ctx = await createTestContext();
    const now = 10;
    const repository = module.createExternalWatchRepository({
      database: ctx.db,
      clock: () => now,
    });

    repository.syncOwners({
      instanceId: 'instance-1',
      policyRevision: 2,
      owners: [
        {
          libraryId: 'music',
          accountDirectory: 'yellowgg2',
          username: 'yellowgg2',
          identityKey: 'a'.repeat(64),
        },
      ],
    });

    expect(repository.listOwners()).toEqual([
      {
        libraryId: 'music',
        accountDirectory: 'yellowgg2',
        username: 'yellowgg2',
        identityKey: 'a'.repeat(64),
        instanceId: 'instance-1',
        policyRevision: 2,
        updatedAt: 10,
      },
    ]);
    expect(() =>
      repository.syncOwners({
        instanceId: 'instance-1',
        policyRevision: 3,
        owners: [
          {
            libraryId: 'music',
            accountDirectory: 'same',
            username: 'first',
            identityKey: 'b'.repeat(64),
          },
          {
            libraryId: 'music',
            accountDirectory: 'same',
            username: 'second',
            identityKey: 'c'.repeat(64),
          },
        ],
      }),
    ).toThrow('Invalid external watch owner');
  });

  /** One relative path is durable across reopen and an expired claim is reclaimed once. */
  it('should preserve path-once observations and reclaim expired leases', async () => {
    const module = await repositoryModule();
    expect(module).toHaveProperty('createExternalWatchRepository');
    if (!('createExternalWatchRepository' in module)) return;
    ctx = await createTestContext();
    let now = 0;
    const repository = module.createExternalWatchRepository({
      database: ctx.db,
      clock: () => now,
    });
    repository.syncOwners({
      instanceId: 'instance-1',
      policyRevision: 2,
      owners: [
        {
          libraryId: 'music',
          accountDirectory: 'listener',
          username: 'listener',
          identityKey: 'd'.repeat(64),
        },
      ],
    });
    repository.ensureRoot({
      libraryId: 'music',
      accountDirectory: 'listener',
      identityKey: 'd'.repeat(64),
    });
    repository.observe({
      libraryId: 'music',
      accountDirectory: 'listener',
      identityKey: 'd'.repeat(64),
      relativeFileKey: 'listener/nested/song.MP3',
      state: 'settling',
      fingerprint: { device: 1, inode: 2, size: 3, mtimeNs: 4, ctimeNs: 5, linkCount: 1 },
      nextAttemptAt: 0,
    });
    repository.observe({
      libraryId: 'music',
      accountDirectory: 'listener',
      identityKey: 'd'.repeat(64),
      relativeFileKey: 'listener/nested/song.MP3',
      state: 'settling',
      fingerprint: { device: 1, inode: 2, size: 3, mtimeNs: 4, ctimeNs: 5, linkCount: 1 },
      nextAttemptAt: 0,
    });
    expect(
      ctx.db.connection.prepare('SELECT count(*) AS count FROM external_file_observations').get(),
    ).toEqual({ count: 1 });

    const first = repository.claimObservations({
      workerId: 'worker-a',
      leaseDurationMs: 50,
      states: ['settling'],
      limit: 1,
    });
    expect(first).toMatchObject([
      { relativeFileKey: 'listener/nested/song.MP3', leaseOwner: 'worker-a', generation: 2 },
    ]);
    expect(
      repository.claimObservations({
        workerId: 'worker-b',
        leaseDurationMs: 50,
        states: ['settling'],
        limit: 1,
      }),
    ).toEqual([]);

    now = 50;
    const reopened = module.createExternalWatchRepository({
      database: ctx.open(),
      clock: () => now,
    });
    expect(
      reopened.claimObservations({
        workerId: 'worker-b',
        leaseDurationMs: 50,
        states: ['settling'],
        limit: 1,
      }),
    ).toMatchObject([{ leaseOwner: 'worker-b', leaseExpiresAt: 100, generation: 3 }]);
  });
});
