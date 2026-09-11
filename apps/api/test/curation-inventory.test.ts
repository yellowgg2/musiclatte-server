import { expect, it } from 'vitest';
import { createTestContext } from '../../../tests/support/session-storage-harness.js';
import { createCurationRepository } from '../src/storage/curation-repository.js';

it('resumes bounded directory traversal including root songs, shortcuts and cycles without doing IO during lists', async () => {
  const { createCurationInventory } = await import('../src/curation/inventory.js');
  const c = await createTestContext();
  try {
    let now = 1000;
    const repo = createCurationRepository({
      database: c.db,
      clock: () => now,
      cursorKey: new Uint8Array(32),
      limits: {
        claimLeaseMs: 1000,
        maxTargets: 10,
        snapshotMaxAgeMs: 1000,
        snapshotMaxItems: 100,
        snapshotMaxCount: 10,
      },
    });
    let reads = 0;
    let empty = false;
    const source = {
      inventoryIndexes: async (folder?: string) => {
        if (empty && folder !== 'broken') return { roots: [] };
        if (folder === 'broken') throw new Error('private upstream text');
        return {
          roots: [
            { id: 'root-track', isDir: false },
            { id: 'dir', isDir: true },
            { id: 'shortcut', isDir: true },
          ],
        };
      },
      registrationDirectory: async (id: string) => ({
        id,
        child:
          id === 'shortcut'
            ? [{ id: 'dir', isDir: true as const, name: 'Same' }]
            : [
                { id: 'dir', isDir: true as const, name: 'Cycle' },
                { id: 'one', isDir: false as const, path: 'music/same.mp3' },
                { id: 'two', isDir: false as const, path: 'music/other.mp3' },
              ],
      }),
    };
    const options = {
      database: c.db,
      repository: repo,
      source,
      clock: () => now,
      libraries: [
        { id: 'lib', musicFolderId: '0' },
        { id: 'broken', musicFolderId: 'broken' },
      ],
      batchSize: 1,
      batchTimeMs: 1000,
      sweepIntervalMs: 1000,
      maxQueueItems: 100,
      reconcile: async () => {
        reads++;
      },
    };
    const inventory = createCurationInventory(options);
    await inventory.runBatch();
    expect(repo.coverage(['lib'])[0]?.status).toBe('discovering');
    c.db.connection
      .prepare(
        'INSERT INTO curation_source_events(library_id,track_id,kind,source_key,created_at) VALUES(?,?,?,?,?)',
      )
      .run('lib', 'root-track', 'import_registered', 'test:fresh-root-track', now);
    const restarted = createCurationInventory(options);
    await restarted.runBatch();
    expect(
      c.db.connection
        .prepare('SELECT source_sequence FROM curation_tracks WHERE track_id=?')
        .get('root-track')?.source_sequence,
    ).toBeGreaterThan(0);
    await restarted.runBatch();
    await restarted.runBatch();
    expect(reads, 'freshly discovered tracks must not wait behind the entire directory tree').toBe(
      1,
    );
    for (let i = 0; i < 20; i++) await restarted.runBatch();
    expect(reads).toBe(3);
    const scope = {
      instanceId: 'instance',
      actorKey: 'actor',
      credentialId: 'session',
      scopes: ['metadata:read'],
      libraryIds: ['lib'],
      policyRevision: 1,
    };
    expect(repo.list(scope, {}).tracks.map((t) => t.trackId)).toEqual(['one', 'root-track', 'two']);
    expect(reads).toBe(3);
    expect(repo.coverage(['broken'])[0]?.lastErrorCode).toBe('inventory_upstream');
    expect(JSON.stringify(repo.coverage(['broken']))).not.toContain('private');
    now += 1000;
    for (let i = 0; i < 20; i++) await restarted.runBatch();
    expect(reads).toBe(6);
    empty = true;
    now += 1000;
    for (let i = 0; i < 20; i++) await restarted.runBatch();
    expect(repo.list(scope, {}).total).toBe(0);
    expect(
      c.db.connection.prepare('SELECT count(*) AS n FROM curation_tracks WHERE tombstoned=1').get()
        ?.n,
    ).toBe(3);
  } finally {
    c.cleanup();
  }
});

it('decodes root children and shortcuts from the actual adapter without changing the legacy indexes shape', async () => {
  const { createSubsonicClient } = await import('../src/subsonic/client.js');
  const { createCurationDiscoveryFixture } =
    await import('../../../packages/test-support/src/curation-fixtures.js');
  const fixture = createCurationDiscoveryFixture();
  const requests: URL[] = [];
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    requests.push(new URL(req.url!, 'http://127.0.0.1'));
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        'subsonic-response': { status: 'ok', version: '1.16.1', indexes: fixture.indexes },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as import('node:net').AddressInfo;
  const client = createSubsonicClient({
    upstream: `http://127.0.0.1:${address.port}`,
    timeoutMs: 1000,
    proof: { username: 'synthetic', s: 'salt', t: 'a'.repeat(32) },
  });
  try {
    expect((await client.inventoryIndexes('folder')).roots).toEqual([
      { id: 'dir', isDir: true },
      { id: 'shortcut', isDir: true },
      { id: 'root-track', isDir: false },
    ]);
    expect(requests[0]?.searchParams.get('musicFolderId')).toBe('folder');
    expect(await client.indexes('folder')).not.toHaveProperty('child');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('cancels a slow source at the batch budget and leaves its checkpoint replayable', async () => {
  const { createCurationInventory } = await import('../src/curation/inventory.js');
  const c = await createTestContext();
  try {
    const repo = createCurationRepository({
      database: c.db,
      clock: () => 1000,
      cursorKey: new Uint8Array(32),
      limits: {
        claimLeaseMs: 1000,
        maxTargets: 10,
        snapshotMaxAgeMs: 1000,
        snapshotMaxItems: 100,
        snapshotMaxCount: 10,
      },
    });
    let aborted = false;
    const inventory = createCurationInventory({
      database: c.db,
      repository: repo,
      clock: () => 1000,
      libraries: [{ id: 'lib', musicFolderId: '0' }],
      batchSize: 2,
      batchTimeMs: 20,
      sweepIntervalMs: 1000,
      maxQueueItems: 100,
      reconcile: async () => {},
      source: {
        inventoryIndexes: async (_folder, options) =>
          new Promise((_, reject) => {
            options!.signal!.addEventListener(
              'abort',
              () => {
                aborted = true;
                reject(new Error('cancelled'));
              },
              { once: true },
            );
          }),
        registrationDirectory: async () => {
          throw new Error('unexpected');
        },
      },
    });
    await inventory.runBatch();
    expect(aborted).toBe(true);
    expect(
      c.db.connection.prepare('SELECT checkpoint_json,status FROM curation_inventory_runs').get(),
    ).toEqual({ checkpoint_json: '{}', status: 'discovering' });
  } finally {
    c.cleanup();
  }
});

it('does not reset an incomplete partial generation at the sweep interval', async () => {
  const { createCurationInventory } = await import('../src/curation/inventory.js');
  const c = await createTestContext();
  try {
    let now = 1000;
    const repo = createCurationRepository({
      database: c.db,
      clock: () => now,
      cursorKey: new Uint8Array(32),
      limits: {
        claimLeaseMs: 1000,
        maxTargets: 10,
        snapshotMaxAgeMs: 1000,
        snapshotMaxItems: 100,
        snapshotMaxCount: 10,
      },
    });
    const inventory = createCurationInventory({
      database: c.db,
      repository: repo,
      clock: () => now,
      libraries: [{ id: 'lib', musicFolderId: '0' }],
      batchSize: 1,
      batchTimeMs: 1000,
      sweepIntervalMs: 1000,
      maxQueueItems: 100,
      reconcile: async () => {
        throw new Error('revision_conflict');
      },
      source: {
        inventoryIndexes: async () => ({ roots: [{ id: 'track', isDir: false }] }),
        registrationDirectory: async () => {
          throw new Error('unexpected');
        },
      },
    });
    await inventory.runBatch();
    await inventory.runBatch();
    const before = c.db.connection
      .prepare('SELECT generation,status,checkpoint_json FROM curation_inventory_runs')
      .get()!;
    expect(before.status).toBe('partial');
    expect(JSON.parse(String(before.checkpoint_json))).not.toHaveProperty('discoveryComplete');
    now += 1000;

    await inventory.runBatch();

    expect(
      c.db.connection.prepare('SELECT generation FROM curation_inventory_runs').get()?.generation,
    ).toBe(before.generation);
  } finally {
    c.cleanup();
  }
});
