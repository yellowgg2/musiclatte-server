import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve, join } from 'node:path';
import { createTestContext, proof } from '../../../tests/support/session-storage-harness.js';

let context: Awaited<ReturnType<typeof createTestContext>> | undefined;
afterEach(() => context?.cleanup());

describe('metadata storage', () => {
  /** Upgrade applies only the additive migration and retains the v8 import and binding values. */
  it('should preserve a real v8 ledger while adding metadata tables', async () => {
    context = await createTestContext();
    const directory = join(context.root, 'legacy-v8');
    mkdirSync(directory, { mode: 0o700 });
    const raw = new DatabaseSync(join(directory, 'management.sqlite'));
    try {
      const migrations = resolve('apps/api/src/storage/migrations');
      for (const file of readdirSync(migrations)
        .filter((file) => /^00[1-8]-.*\.sql$/.test(file))
        .sort())
        raw.exec(readFileSync(join(migrations, file), 'utf8'));
      raw
        .prepare(
          "INSERT INTO media_links(id,library_id,relative_file_key,gonic_song_id,revision,availability,created_at) VALUES('legacy-media','library-1','synthetic.mp3','song-1',7,'available',100)",
        )
        .run();
      raw
        .prepare(
          "INSERT INTO import_jobs(id,identity_key,library_id,operation_id_hash,request_hash,created_at) VALUES('legacy-job',?,'library-1',?,?,100)",
        )
        .run('a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64));
    } finally {
      raw.close();
    }
    const upgraded = context.open(directory);
    expect(upgraded.connection.prepare('PRAGMA user_version').get()).toEqual({ user_version: 14 });
    expect(
      upgraded.connection.prepare('SELECT revision,gonic_song_id FROM media_links').get(),
    ).toEqual({ revision: 7, gonic_song_id: 'song-1' });
    expect(upgraded.connection.prepare('SELECT id,created_at FROM import_jobs').get()).toEqual({
      id: 'legacy-job',
      created_at: 100,
    });
    expect(
      upgraded.connection.prepare('SELECT count(*) AS count FROM download_events').get(),
    ).toEqual({ count: 0 });
    expect(upgraded.connection.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
  /** Independent connections serialize a file across accounts and fence expired workers. */
  it('should replay identical jobs and fence expired claims across connections', async () => {
    const path = resolve('apps/api/src/storage/metadata-repository.ts');
    expect(existsSync(path)).toBe(true);
    const { createMetadataRepository } = await import(path);
    context = await createTestContext();
    const c = context;
    c.sessions.create(proof);
    const actorSessionId = c.db.connection.prepare('SELECT id_hash FROM sessions').get()?.id_hash;
    c.mediaLinks.create({
      id: 'media-1',
      libraryId: 'library-1',
      relativeFileKey: 'synthetic.mp3',
      gonicSongId: 'song-1',
    });
    let now = 1000;
    const a = createMetadataRepository({ database: c.db, clock: () => now });
    const b = createMetadataRepository({ database: c.open(), clock: () => now });
    const input = {
      id: 'job-1',
      identityKey: 'a'.repeat(64),
      libraryId: 'library-1',
      operationIdHash: 'b'.repeat(64),
      requestHash: 'c'.repeat(64),
      items: [
        {
          id: 'item-1',
          mediaLinkId: 'media-1',
          fileIdentity: 'd'.repeat(64),
          bindingRevision: 1,
          trackId: 'song-1',
          expectedRevision: 'revision-1',
          expectedDigest: 'e'.repeat(64),
          actorSessionId,
          policyRevision: 1,
          patch: { title: { op: 'set', value: 'Synthetic' } },
        },
      ],
    };
    const first = a.createOrReplay(input);
    expect(b.createOrReplay({ ...input, id: 'discarded-job' })).toEqual(first);
    expect(() => b.createOrReplay({ ...input, requestHash: 'f'.repeat(64) })).toThrow('conflict');
    b.createOrReplay({
      ...input,
      id: 'job-2',
      identityKey: 'f'.repeat(64),
      items: [{ ...input.items[0], id: 'item-2' }],
    });
    const claim = a.claimNext({ workerId: 'worker-a', leaseDurationMs: 100 });
    expect(claim.itemId).toBe('item-1');
    expect(b.claimNext({ workerId: 'worker-b', leaseDurationMs: 100 })).toBeNull();
    now = 1100;
    const reclaimed = b.claimNext({ workerId: 'worker-b', leaseDurationMs: 100 });
    expect(reclaimed.itemId).toBe('item-1');
    expect(reclaimed.generation).toBeGreaterThan(claim.generation);
    expect(() =>
      a.transition({ ...claim, stage: 'failed', errorCode: 'worker_interrupted' }),
    ).toThrow('conflict');
    b.transition({ ...reclaimed, stage: 'failed', errorCode: 'worker_interrupted' });
    expect(a.claimNext({ workerId: 'worker-a', leaseDurationMs: 100 }).itemId).toBe('item-2');
    expect(a.getJob('job-1', input.identityKey).status).toBe('failed');
    expect(a.getJob('job-1', '0'.repeat(64))).toBeNull();
    expect(typeof a.retryFailed).toBe('function');
    const retryInput = {
      ...input,
      id: 'retry-job',
      operationIdHash: '1'.repeat(64),
      requestHash: '2'.repeat(64),
      items: [{ ...input.items[0], id: 'retry-item', expectedRevision: 'fresh-revision' }],
    };
    const retried = a.retryFailed({
      request: retryInput,
      parentJobId: 'job-1',
      itemIds: ['item-1'],
    });
    expect(retried.kind).toBe('retry');
    expect(retried.parentJobId).toBe('job-1');
    expect(retried.items.map((item: { itemId: string }) => item.itemId)).toEqual(['retry-item']);
    expect(() =>
      a.retryFailed({
        request: { ...retryInput, id: 'wrong-retry', operationIdHash: '3'.repeat(64) },
        parentJobId: 'job-2',
        itemIds: ['item-2'],
      }),
    ).toThrow('conflict');
    const active = { itemId: 'item-2', workerId: 'worker-a', generation: 1 };
    expect(() => a.transition({ ...active, stage: 'backed_up' })).toThrow('conflict');
    expect(typeof a.recordBackup).toBe('function');
    a.recordBackup({
      ...active,
      backup: {
        id: 'backup-2',
        relativeKey: 'backup-2.original',
        preimageDigest: 'e'.repeat(64),
        size: 128,
        mode: 420,
        ownerProfile: { uid: 1000, gid: 1000 },
      },
    });
    a.transition({ ...active, stage: 'backed_up' });
    a.transition({ ...active, stage: 'prepared', candidateKey: 'candidate.pending' });
    a.transition({
      ...active,
      stage: 'file_saved',
      resultRevision: 'revision-2',
      resultDigest: '4'.repeat(64),
    });
    a.transition({ ...active, stage: 'reflecting' });
    const saved = a.transition({
      ...active,
      stage: 'recovery_required',
      errorCode: 'reference_conflict',
    });
    expect(saved.fileSavedAt).toBe(1100);
    expect(saved.restoreAvailable).toBe(true);
    expect(typeof a.createRestore).toBe('function');
    const restoreRequest = {
      ...input,
      id: 'restore-job',
      identityKey: 'f'.repeat(64),
      operationIdHash: '5'.repeat(64),
      requestHash: '6'.repeat(64),
      items: [
        {
          ...input.items[0],
          id: 'restore-item',
          expectedRevision: 'revision-2',
          expectedDigest: '4'.repeat(64),
          patch: {},
        },
      ],
    };
    const restoredJob = a.createRestore({
      request: restoreRequest,
      parentJobId: 'job-2',
      itemId: 'item-2',
    });
    expect(restoredJob.kind).toBe('restore');
    expect(
      c.db.connection
        .prepare('SELECT restore_backup_id FROM metadata_items WHERE id=?')
        .get('restore-item'),
    ).toEqual({ restore_backup_id: 'backup-2' });
    expect(() =>
      a.createRestore({
        request: { ...restoreRequest, identityKey: input.identityKey },
        parentJobId: 'job-2',
        itemId: 'item-2',
      }),
    ).toThrow('conflict');
    const snapshot = join(c.root, 'metadata-snapshot');
    await c.createBackup(c.db, c.keyPath, snapshot);
    await c.restoreBackup(snapshot, join(c.root, 'metadata-restored'));
    const restoredDb = c.open(join(c.root, 'metadata-restored'));
    expect(
      createMetadataRepository({ database: restoredDb, clock: () => now }).getJob(
        'restore-job',
        restoreRequest.identityKey,
      ),
    ).toEqual(restoredJob);
    c.db.connection
      .prepare("UPDATE metadata_backups SET identity_key=? WHERE id='backup-2'")
      .run('0'.repeat(64));
    await expect(
      c.createBackup(c.db, c.keyPath, join(c.root, 'invalid-metadata-snapshot')),
    ).rejects.toThrow();
  });
  /** A fresh database includes the durable metadata ledger without changing import data semantics. */
  it('should create the current schema with every metadata ledger table', async () => {
    context = await createTestContext();
    expect(context.db.connection.prepare('PRAGMA user_version').get()).toEqual({
      user_version: 14,
    });
    expect(
      context.db.connection
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'metadata_%' ORDER BY name",
        )
        .all()
        .map((row) => row.name),
    ).toEqual([
      'metadata_attempts',
      'metadata_backup_previews',
      'metadata_backups',
      'metadata_changes',
      'metadata_cover_uploads',
      'metadata_file_locks',
      'metadata_item_evidence',
      'metadata_items',
      'metadata_jobs',
      'metadata_rechecks',
      'metadata_worker_state',
    ]);
  });
});
