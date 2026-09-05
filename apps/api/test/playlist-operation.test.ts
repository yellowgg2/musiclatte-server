import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext } from '../../../tests/support/session-storage-harness.js';

let ctx: Awaited<ReturnType<typeof createTestContext>> | undefined;
afterEach(() => {
  ctx?.cleanup();
  ctx = undefined;
});
async function makeSUT() {
  ctx = await createTestContext();
  return { ...ctx, create: ctx.playlistOperationsFor, repository: ctx.playlistOperations };
}
const identity = '1'.repeat(64);
const operation = '2'.repeat(64);
const request = '3'.repeat(64);

describe('playlist operation receipt repository', () => {
  /** A claim is durable across restart and separates request reuse from account isolation. */
  it('should claim once and distinguish replay conflict and identity isolation', async () => {
    const c = await makeSUT();
    const first = c.repository.claim({
      identityKey: identity,
      operationIdHash: operation,
      requestHash: request,
      kind: 'append',
    });
    expect(first).toMatchObject({ outcome: 'claimed', receipt: { status: 'pending' } });
    expect(c.repository.claim({ ...first.receipt })).toEqual({
      outcome: 'existing',
      receipt: first.receipt,
    });
    expect(
      c.repository.claim({
        identityKey: identity,
        operationIdHash: operation,
        requestHash: '4'.repeat(64),
        kind: 'append',
      }),
    ).toMatchObject({ outcome: 'conflict', receipt: first.receipt });
    expect(
      c.repository.claim({
        identityKey: '5'.repeat(64),
        operationIdHash: operation,
        requestHash: request,
        kind: 'append',
      }).outcome,
    ).toBe('claimed');
    c.db.close();
    expect(c.create(c.open()).get(identity, operation)).toEqual(first.receipt);
  });

  /** Uncertain work may be reconciled as applied while terminal receipts reject rewrites. */
  it('should enforce recovery-safe status transitions and terminal metadata', async () => {
    const c = await makeSUT();
    c.repository.claim({
      identityKey: identity,
      operationIdHash: operation,
      requestHash: request,
      kind: 'rename',
    });
    c.setNow(1100);
    expect(c.repository.markUncertain(identity, operation)).toMatchObject({
      status: 'uncertain',
      finishedAt: 1100,
    });
    c.setNow(1200);
    expect(
      c.repository.markApplied(identity, operation, {
        resourceId: 'playlist-1',
        beforeRevision: 'revision-1',
        afterRevision: 'revision-2',
      }),
    ).toMatchObject({ status: 'applied', finishedAt: 1200, resourceId: 'playlist-1' });
    expect(() => c.repository.markFailed(identity, operation)).toThrow(
      'Invalid playlist operation transition',
    );
    expect(() => c.repository.markUncertain(identity, '9'.repeat(64))).toThrow(
      'Playlist operation not found',
    );
    const failedOperation = '8'.repeat(64);
    c.repository.claim({
      identityKey: identity,
      operationIdHash: failedOperation,
      requestHash: request,
      kind: 'remove',
    });
    expect(c.repository.markFailed(identity, failedOperation)).toMatchObject({
      status: 'failed',
      finishedAt: 1200,
    });
    expect(() =>
      c.repository.markApplied(identity, failedOperation, {
        resourceId: 'playlist-1',
        beforeRevision: 'revision-1',
        afterRevision: 'revision-2',
      }),
    ).toThrow('Invalid playlist operation transition');
  });

  /** Receipt persistence contains only fingerprints and reconciliation metadata. */
  it('should reject invalid input and never add playlist content or credential columns', async () => {
    const c = await makeSUT();
    expect(() =>
      c.repository.claim({
        identityKey: 'raw-account',
        operationIdHash: operation,
        requestHash: request,
        kind: 'create',
      }),
    ).toThrow('Invalid playlist operation');
    const columns = c.db.connection
      .prepare('PRAGMA table_info(playlist_operations)')
      .all()
      .map((row) => row.name);
    expect(columns).toEqual([
      'identity_key',
      'operation_id_hash',
      'request_hash',
      'kind',
      'resource_id',
      'before_revision',
      'after_revision',
      'status',
      'created_at',
      'finished_at',
    ]);
    expect(columns).not.toEqual(
      expect.arrayContaining(['operation_id', 'name', 'song_ids', 'credential']),
    );
  });

  /** Online backup and offline restore preserve a completed replay receipt. */
  it('should preserve applied replay through WAL backup and restore', async () => {
    const c = await makeSUT();
    c.db.connection.exec('PRAGMA wal_autocheckpoint=0');
    c.repository.claim({
      identityKey: identity,
      operationIdHash: operation,
      requestHash: request,
      kind: 'delete',
    });
    c.repository.markApplied(identity, operation, {
      resourceId: 'playlist-1',
      beforeRevision: 'revision-1',
      afterRevision: null,
    });
    const snapshot = join(c.root, 'receipt-snapshot');
    await c.createBackup(c.db, c.keyPath, snapshot);
    const restored = join(c.root, 'receipt-restored');
    await c.restoreBackup(snapshot, restored);
    const repository = c.create(c.open(restored));
    expect(
      repository.claim({
        identityKey: identity,
        operationIdHash: operation,
        requestHash: request,
        kind: 'delete',
      }),
    ).toMatchObject({ outcome: 'existing', receipt: { status: 'applied' } });

    const snapshotDatabase = new DatabaseSync(join(snapshot, 'management.sqlite'));
    snapshotDatabase.exec(
      "PRAGMA ignore_check_constraints=ON; UPDATE playlist_operations SET status='tampered'",
    );
    snapshotDatabase.close();
    await expect(c.restoreBackup(snapshot, join(c.root, 'tampered-restored'))).rejects.toThrow(
      'Restore failed',
    );
  });
});
