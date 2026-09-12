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

/** Prevents one internally timed-out track from starving every later inventory item. */
it('records an internally timed-out track as an error and continues with the next item', async () => {
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
    const reconciled: string[] = [];
    const failures: Array<{ kind: string; code: string; cause: string }> = [];
    const inventory = createCurationInventory({
      database: c.db,
      repository: repo,
      clock: () => 1000,
      libraries: [{ id: 'lib', musicFolderId: '0' }],
      batchSize: 1,
      itemTimeoutMs: 20,
      batchTimeMs: 200,
      sweepIntervalMs: 1000,
      maxQueueItems: 100,
      reportFailure: (failure) => failures.push(failure),
      reconcile: async (trackRef, signal) => {
        const trackId = String(
          c.db.connection.prepare('SELECT track_id FROM curation_tracks WHERE id=?').get(trackRef)
            ?.track_id,
        );
        if (trackId === 'a-slow')
          return new Promise((_, reject) =>
            signal!.addEventListener('abort', () => reject(new Error('cancelled')), {
              once: true,
            }),
          );
        reconciled.push(trackId);
      },
      source: {
        inventoryIndexes: async () => ({
          roots: [
            { id: 'a-slow', isDir: false },
            { id: 'b-next', isDir: false },
          ],
        }),
        registrationDirectory: async () => {
          throw new Error('unexpected');
        },
      },
    });

    await inventory.runBatch();
    await inventory.runBatch();

    expect(
      c.db.connection
        .prepare("SELECT status FROM curation_inventory_queue WHERE opaque_id='a-slow'")
        .get()?.status,
    ).toBe('error');
    expect(repo.coverage(['lib'])[0]?.lastErrorCode).toBe('inventory_upstream');
    expect(failures).toEqual([
      { kind: 'track', code: 'inventory_upstream', cause: 'item_timeout' },
    ]);

    await inventory.runBatch();

    expect(reconciled).toEqual(['b-next']);
  } finally {
    c.cleanup();
  }
});

/** Keeps an in-flight track replayable when the worker itself is shutting down. */
it('preserves a pending track when an external abort interrupts reconciliation', async () => {
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
    const inventory = createCurationInventory({
      database: c.db,
      repository: repo,
      clock: () => 1000,
      libraries: [{ id: 'lib', musicFolderId: '0' }],
      batchSize: 1,
      batchTimeMs: 1000,
      sweepIntervalMs: 1000,
      maxQueueItems: 100,
      reconcile: async (_trackRef, signal) =>
        new Promise((_, reject) =>
          signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }),
        ),
      source: {
        inventoryIndexes: async () => ({ roots: [{ id: 'track', isDir: false }] }),
        registrationDirectory: async () => {
          throw new Error('unexpected');
        },
      },
    });
    await inventory.runBatch();
    const external = new AbortController();
    const interrupted = inventory.runBatch(external.signal);
    external.abort();

    await interrupted;

    expect(
      c.db.connection.prepare('SELECT status FROM curation_inventory_queue').get()?.status,
    ).toBe('pending');
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

/** Separates item timeout failures from the larger batch budget and bounds retries across restarts. */
it('processes pending work before a due item retry and persists the retry ceiling', async () => {
  const { createCurationInventory } = await import('../src/curation/inventory.js');
  const c = await createTestContext();
  try {
    let now = 1000;
    let slow = true;
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
    const reconciled: string[] = [];
    const options = {
      database: c.db,
      repository: repo,
      clock: () => now,
      libraries: [{ id: 'lib', musicFolderId: '0' }],
      batchSize: 1,
      itemTimeoutMs: 20,
      batchTimeMs: 200,
      retryIntervalMs: 10,
      maxRetryAttempts: 1,
      sweepIntervalMs: 1000,
      maxQueueItems: 100,
      reconcile: async (trackRef: string, signal?: AbortSignal) => {
        const trackId = String(
          c.db.connection.prepare('SELECT track_id FROM curation_tracks WHERE id=?').get(trackRef)
            ?.track_id,
        );
        if (trackId === 'a-slow' && slow)
          return new Promise<void>((_, reject) =>
            signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }),
          );
        reconciled.push(trackId);
      },
      source: {
        inventoryIndexes: async () => ({
          roots: [
            { id: 'a-slow', isDir: false as const },
            { id: 'b-pending', isDir: false as const },
          ],
        }),
        registrationDirectory: async () => {
          throw new Error('unexpected');
        },
      },
    };
    const inventory = createCurationInventory(options);
    await inventory.runBatch();
    await inventory.runBatch();
    expect(
      c.db.connection
        .prepare(
          "SELECT status,attempt_count,next_attempt_at,terminal FROM curation_inventory_queue WHERE opaque_id='a-slow'",
        )
        .get(),
    ).toEqual({ status: 'error', attempt_count: 1, next_attempt_at: 1010, terminal: 0 });

    now = 1010;
    await inventory.runBatch();
    expect(reconciled).toEqual(['b-pending']);

    const restarted = createCurationInventory(options);
    await restarted.runBatch();
    expect(
      c.db.connection
        .prepare(
          "SELECT status,attempt_count,next_attempt_at,terminal FROM curation_inventory_queue WHERE opaque_id='a-slow'",
        )
        .get(),
    ).toEqual({ status: 'error', attempt_count: 2, next_attempt_at: null, terminal: 1 });
    expect(
      c.db.connection
        .prepare(
          "SELECT failure_count,last_cause,resolved_at FROM curation_inventory_failures WHERE opaque_id='a-slow'",
        )
        .get(),
    ).toEqual({ failure_count: 2, last_cause: 'item_timeout', resolved_at: null });

    slow = false;
    await restarted.runBatch();
    expect(reconciled).toEqual(['b-pending']);
  } finally {
    c.cleanup();
  }
});

/** Leaves an in-flight item replayable when the batch budget expires before its item deadline. */
it('does not classify a batch budget cancellation as an item failure', async () => {
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
    let calls = 0;
    const options = {
      database: c.db,
      repository: repo,
      clock: () => 1000,
      libraries: [{ id: 'lib', musicFolderId: '0' }],
      batchSize: 2,
      itemTimeoutMs: 1000,
      batchTimeMs: 1200,
      retryIntervalMs: 10,
      maxRetryAttempts: 1,
      sweepIntervalMs: 2000,
      maxQueueItems: 100,
      reconcile: async (_trackRef: string, signal?: AbortSignal): Promise<void> => {
        calls++;
        if (calls === 1) {
          await new Promise((resolve) => setTimeout(resolve, 700));
          return;
        }
        return new Promise<void>((_, reject) =>
          signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }),
        );
      },
      source: {
        inventoryIndexes: async () => ({
          roots: [
            { id: 'a-fast', isDir: false },
            { id: 'b-slow', isDir: false },
          ],
        }),
        registrationDirectory: async () => {
          throw new Error('unexpected');
        },
      },
    };
    await createCurationInventory({ ...options, batchSize: 1 }).runBatch();
    const inventory = createCurationInventory(options);
    const summary = await inventory.runBatch();

    expect(summary).toMatchObject({ retryScheduled: 0, terminal: 0 });
    expect(
      c.db.connection
        .prepare(
          "SELECT status,attempt_count FROM curation_inventory_queue WHERE opaque_id='b-slow'",
        )
        .get(),
    ).toEqual({ status: 'pending', attempt_count: 0 });
    expect(
      c.db.connection.prepare('SELECT count(*) AS n FROM curation_inventory_failures').get()?.n,
    ).toBe(0);
  } finally {
    c.cleanup();
  }
});

/** Anchors the next full sweep to reconciliation completion instead of discovery start. */
it('starts the next full sweep only after the completed reconciliation interval', async () => {
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
      reconcile: async () => {},
      source: {
        inventoryIndexes: async () => ({ roots: [] }),
        registrationDirectory: async () => {
          throw new Error('unexpected');
        },
      },
    });
    await inventory.runBatch();
    const generation = String(
      c.db.connection.prepare('SELECT generation FROM curation_inventory_runs').get()?.generation,
    );
    now = 5000;
    await inventory.runBatch();
    now = 5999;
    await inventory.runBatch();
    expect(
      c.db.connection.prepare('SELECT generation FROM curation_inventory_runs').get()?.generation,
    ).toBe(generation);
    now = 6000;
    await inventory.runBatch();
    expect(
      c.db.connection.prepare('SELECT generation FROM curation_inventory_runs').get()?.generation,
    ).not.toBe(generation);
  } finally {
    c.cleanup();
  }
});

/** Retries a failed directory and resolves its durable failure after discovering children. */
it('retries directory discovery and resolves its failure ledger entry', async () => {
  const { createCurationInventory } = await import('../src/curation/inventory.js');
  const c = await createTestContext();
  try {
    let now = 1000;
    let directoryCalls = 0;
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
      itemTimeoutMs: 100,
      batchTimeMs: 200,
      retryIntervalMs: 10,
      maxRetryAttempts: 1,
      sweepIntervalMs: 1000,
      maxQueueItems: 100,
      reconcile: async () => {},
      source: {
        inventoryIndexes: async () => ({ roots: [{ id: 'dir', isDir: true }] }),
        registrationDirectory: async (id) => {
          directoryCalls++;
          if (directoryCalls === 1) throw new Error('private upstream detail');
          return {
            id,
            child: [{ id: 'child', isDir: false as const, path: 'music/child.mp3' }],
          };
        },
      },
    });
    await inventory.runBatch();
    await inventory.runBatch();
    now = 1010;
    await inventory.runBatch();

    expect(
      c.db.connection
        .prepare("SELECT status FROM curation_inventory_queue WHERE opaque_id='dir'")
        .get()?.status,
    ).toBe('done');
    expect(
      c.db.connection
        .prepare("SELECT resolved_at FROM curation_inventory_failures WHERE opaque_id='dir'")
        .get()?.resolved_at,
    ).toBe(1010);
    expect(
      c.db.connection
        .prepare("SELECT status FROM curation_inventory_queue WHERE opaque_id='child'")
        .get()?.status,
    ).toBe('pending');
  } finally {
    c.cleanup();
  }
});

/** Adopts pre-migration error rows whose retry checkpoint columns still contain their defaults. */
it('retries a legacy error row without an explicit next-attempt timestamp', async () => {
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
    let reconciled = 0;
    const inventory = createCurationInventory({
      database: c.db,
      repository: repo,
      clock: () => 1000,
      libraries: [{ id: 'lib', musicFolderId: '0' }],
      batchSize: 1,
      itemTimeoutMs: 100,
      batchTimeMs: 200,
      retryIntervalMs: 10,
      maxRetryAttempts: 2,
      sweepIntervalMs: 1000,
      maxQueueItems: 100,
      reconcile: async () => {
        reconciled++;
      },
      source: {
        inventoryIndexes: async () => ({ roots: [{ id: 'legacy-error', isDir: false }] }),
        registrationDirectory: async () => {
          throw new Error('unexpected');
        },
      },
    });
    await inventory.runBatch();
    c.db.connection
      .prepare("UPDATE curation_inventory_queue SET status='error' WHERE opaque_id='legacy-error'")
      .run();

    await inventory.runBatch();

    expect(reconciled).toBe(1);
    expect(
      c.db.connection
        .prepare(
          "SELECT status,attempt_count,next_attempt_at,terminal FROM curation_inventory_queue WHERE opaque_id='legacy-error'",
        )
        .get(),
    ).toEqual({ status: 'done', attempt_count: 0, next_attempt_at: null, terminal: 0 });
  } finally {
    c.cleanup();
  }
});
