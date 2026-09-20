import { lstatSync, mkdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createImportProcessFixture } from '../../../tests/support/import-process-fixture.js';
import { createTestContext } from '../../../tests/support/session-storage-harness.js';
import { createExternalWatchRepository } from '../src/storage/external-watch-repository.js';

let ctx: Awaited<ReturnType<typeof createTestContext>> | undefined;
let now = 0;

afterEach(() => {
  ctx?.cleanup();
  ctx = undefined;
});

async function makeSUT(
  content: unknown = { valid: true, sourceId: '' },
  checkpoint?: (stage: string, path: string) => void,
) {
  const module = await import('../src/imports/external-watch-service.js').catch(() => ({}));
  expect(module).toHaveProperty('createExternalWatchService');
  if (!('createExternalWatchService' in module)) return undefined;
  ctx ??= await createTestContext();
  const musicRootPath = join(ctx.root, 'music');
  mkdirSync(musicRootPath, { recursive: true });
  const musicRoot = realpathSync(musicRootPath);
  const key = 'jojo-music/alice/new.mp3';
  const file = join(musicRoot, key);
  mkdirSync(join(musicRoot, 'jojo-music', 'alice'), { recursive: true });
  writeFileSync(file, JSON.stringify(content));
  const repository = createExternalWatchRepository({ database: ctx.db, clock: () => now });
  repository.syncOwners({
    instanceId: 'instance-1',
    policyRevision: 1,
    owners: [
      {
        libraryId: 'music',
        accountDirectory: 'alice',
        username: 'alice',
        identityKey: 'a'.repeat(64),
      },
    ],
  });
  const stat = lstatSync(file, { bigint: true });
  repository.observe({
    libraryId: 'music',
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
  const fixture = createImportProcessFixture(ctx.root);
  const service = module.createExternalWatchService({
    database: ctx.db,
    musicRoot,
    ffprobe: fixture.ffprobe,
    timeoutMs: 2_000,
    clock: () => now,
    workerId: 'watch-worker',
    instanceId: 'instance-1',
    policyRevision: 1,
    expectedOwners: [{ libraryId: 'music', accountDirectory: 'alice', username: 'alice' }],
    ...(checkpoint ? { checkpoint } : {}),
  });
  return { service, repository, musicRoot, key, file };
}

function observeAgain(c: Awaited<ReturnType<typeof makeSUT>> & {}) {
  const stat = lstatSync(c.file, { bigint: true });
  return c.repository.discover({
    libraryId: 'music',
    relativeFileKey: c.key,
    accountDirectory: 'alice',
    identityKey: 'a'.repeat(64),
    baseline: false,
    seenAt: now,
    fingerprint: {
      device: stat.dev,
      inode: stat.ino,
      size: stat.size,
      mtimeNs: stat.mtimeNs,
      ctimeNs: stat.ctimeNs,
      linkCount: Number(stat.nlink),
    },
  });
}

describe('external watch admission', () => {
  it('should require a second observation and ten seconds before one atomic external event', async () => {
    now = 100;
    const c = await makeSUT();
    if (!c) return;
    now = 10_100;
    expect(await c.service.runOnce()).toBe('deferred');
    expect(
      ctx!.db.connection.prepare('SELECT count(*) AS count FROM download_events').get(),
    ).toEqual({
      count: 0,
    });

    observeAgain(c);
    now = 15_100;
    expect(await c.service.runOnce()).toBe('admitted');
    expect(
      ctx!.db.connection
        .prepare(
          'SELECT provenance,identity_key,library_id,download_completed_at,registered_at FROM download_events',
        )
        .get(),
    ).toEqual({
      provenance: 'external',
      identity_key: 'a'.repeat(64),
      library_id: 'music',
      download_completed_at: 15_100,
      registered_at: null,
    });
    expect(c.repository.getObservation('music', c.key)).toMatchObject({
      state: 'registering',
      eventId: expect.any(String),
      mediaLinkId: expect.any(String),
      leaseOwner: null,
    });
    expect(await c.service.runOnce()).toBe('idle');
    expect(
      ctx!.db.connection.prepare('SELECT count(*) AS count FROM download_events').get(),
    ).toEqual({
      count: 1,
    });
  });

  it('should back off invalid media and reset validation after its fingerprint changes', async () => {
    now = 0;
    const c = await makeSUT({ valid: false, sourceId: '' });
    if (!c) return;
    now = 1;
    observeAgain(c);
    now = 10_000;
    expect(await c.service.runOnce()).toBe('rejected');
    expect(c.repository.getObservation('music', c.key)).toMatchObject({
      state: 'settling',
      failureCode: 'invalid_media',
      leaseOwner: null,
      attempt: 1,
    });

    now = 20_000;
    writeFileSync(c.file, JSON.stringify({ valid: true, sourceId: '' }));
    observeAgain(c);
    expect(c.repository.getObservation('music', c.key)).toMatchObject({
      failureCode: null,
      attempt: 0,
      stableSinceAt: 20_000,
    });
    now = 20_001;
    observeAgain(c);
    now = 30_000;
    expect(await c.service.runOnce()).toBe('admitted');
  });

  it('should close a path explained by a Musiclatte publish intent as internal', async () => {
    now = 0;
    const c = await makeSUT();
    if (!c) return;
    ctx!.imports.createJob({
      id: 'internal-job',
      identityKey: 'a'.repeat(64),
      libraryId: 'music',
      accountDirectory: 'alice',
      operationIdHash: 'b'.repeat(64),
      requestHash: 'c'.repeat(64),
      items: [{ id: 'internal-item', sourceId: 'abcdefghijk' }],
      deduplicate: false,
    });
    ctx!.db.connection
      .prepare(
        "INSERT INTO import_publish_intents(item_id,relative_file_key,staging_key,event_id,media_link_id,intended_at,completed_at,disposition) VALUES(?,?,?,?,?,?,NULL,'new')",
      )
      .run('internal-item', c.key, 'staging/audio.mp3', 'internal-event', 'internal-media', 0);
    now = 1;
    observeAgain(c);
    now = 10_000;
    expect(await c.service.runOnce()).toBe('internal');
    expect(c.repository.getObservation('music', c.key)).toMatchObject({
      state: 'rejected',
      failureCode: 'internal_path',
    });
    expect(
      ctx!.db.connection.prepare('SELECT count(*) AS count FROM download_events').get(),
    ).toEqual({
      count: 0,
    });
  });

  it('should reject a rename-over-open race before the admission transaction', async () => {
    now = 0;
    const c = await makeSUT(undefined, (stage, path) => {
      if (stage !== 'before-admission') return;
      renameSync(path, `${path}.old`);
      writeFileSync(path, JSON.stringify({ valid: true, sourceId: '' }));
    });
    if (!c) return;
    now = 1;
    observeAgain(c);
    now = 10_000;
    expect(await c.service.runOnce()).toBe('changed');
    expect(
      ctx!.db.connection.prepare('SELECT count(*) AS count FROM download_events').get(),
    ).toEqual({
      count: 0,
    });
    expect(c.repository.getObservation('music', c.key)).toMatchObject({
      state: 'settling',
      failureCode: 'file_changed',
      leaseOwner: null,
    });
  });
});
