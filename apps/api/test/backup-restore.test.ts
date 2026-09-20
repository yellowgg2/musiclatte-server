import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createExternalWatchRepository } from '../src/storage/external-watch-repository.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, proof } from '../../../tests/support/session-storage-harness.js';
let ctx: Awaited<ReturnType<typeof createTestContext>> | undefined;
afterEach(() => {
  ctx?.cleanup();
  ctx = undefined;
});
async function makeSUT() {
  ctx = await createTestContext();
  return ctx;
}
describe('management backup and offline restore', () => {
  /** Offline restore preserves watch history but releases process-owned observation leases. */
  it('should restore external watch observations with reclaimable leases', async () => {
    const c = await makeSUT();
    let now = 20;
    const watch = createExternalWatchRepository({ database: c.db, clock: () => now });
    watch.syncOwners({
      instanceId: 'instance-watch',
      policyRevision: 2,
      owners: [
        {
          libraryId: 'music',
          accountDirectory: 'listener',
          username: 'listener',
          identityKey: 'f'.repeat(64),
        },
      ],
    });
    watch.ensureRoot({
      libraryId: 'music',
      accountDirectory: 'listener',
      identityKey: 'f'.repeat(64),
    });
    watch.observe({
      libraryId: 'music',
      accountDirectory: 'listener',
      identityKey: 'f'.repeat(64),
      relativeFileKey: 'listener/song.mp3',
      state: 'settling',
      fingerprint: { device: 1, inode: 2, size: 3, mtimeNs: 4, ctimeNs: 5, linkCount: 1 },
      nextAttemptAt: 20,
    });
    expect(
      watch.claimObservations({
        workerId: 'worker-before-backup',
        leaseDurationMs: 1000,
        states: ['settling'],
        limit: 1,
      }),
    ).toHaveLength(1);

    const snapshot = join(c.root, 'external-watch-snapshot');
    await c.createBackup(c.db, c.keyPath, snapshot);
    const restoredPath = join(c.root, 'external-watch-restored');
    await c.restoreBackup(snapshot, restoredPath);
    now = 21;
    const restored = createExternalWatchRepository({
      database: c.open(restoredPath),
      clock: () => now,
    });
    expect(
      restored.claimObservations({
        workerId: 'worker-after-restore',
        leaseDurationMs: 100,
        states: ['settling'],
        limit: 1,
      }),
    ).toMatchObject([{ leaseOwner: 'worker-after-restore', generation: 4 }]);
  });

  /** Online backup includes committed WAL pages and the matching immutable key. */
  it('should restore WAL-backed session instance expiry and revocation state', async () => {
    const c = await makeSUT();
    c.db.connection.exec('PRAGMA wal_autocheckpoint=0');
    const live = c.sessions.create(proof);
    const revoked = c.sessions.create(proof);
    c.sessions.revoke(revoked.token);
    expect(statSync(join(c.data, 'management.sqlite-wal')).size).toBeGreaterThan(0);
    const backup = join(c.root, 'snapshot');
    await c.createBackup(c.db, c.keyPath, backup);
    const restored = join(c.root, 'restored');
    await c.restoreBackup(backup, restored);
    const db = c.open(restored);
    const vault = c.createCredentialVault(c.loadKey(join(restored, 'credential.key')));
    expect(c.createInstanceRepository(db, vault.keyId).get()).toEqual(c.instances.get());
    const sessions = c.createSessionRepository({
      database: db,
      vault,
      maxAgeMs: 1000,
      clock: () => 1500,
    });
    expect(sessions.find(live.token)?.proof).toEqual(proof);
    expect(sessions.find(revoked.token)).toBeNull();
    expect(
      c
        .createSessionRepository({ database: db, vault, maxAgeMs: 9999, clock: () => 2000 })
        .find(live.token),
    ).toBeNull();
  });
  /** Import rows and replay receipts survive backup while cross-ledger tampering is rejected. */
  it('should restore import replay state and reject a mismatched download ledger', async () => {
    const c = await makeSUT();
    c.setNow(0);
    const input = {
      id: 'job-1',
      identityKey: 'a'.repeat(64),
      libraryId: 'library-1',
      operationIdHash: 'b'.repeat(64),
      requestHash: 'c'.repeat(64),
      items: [{ id: 'item-1', sourceId: 'video-1' }],
    };
    c.imports.createJob(input);
    c.imports.claimNext({
      workerId: 'worker-1',
      leaseDurationMs: 100,
      engineVersion: 'nightly-1',
    });
    c.imports.advanceItem({
      itemId: 'item-1',
      workerId: 'worker-1',
      stage: 'downloading',
      observed: {
        title: 'Synthetic title',
        channel: 'Synthetic channel',
        channelId: 'channel-1',
      },
    });
    for (const stage of ['postprocessing', 'publishing'] as const)
      c.imports.advanceItem({ itemId: 'item-1', workerId: 'worker-1', stage });
    c.mediaLinks.create({
      id: 'media-1',
      libraryId: 'library-1',
      relativeFileKey: 'Channel [channel-1]/Song [video-1].mp3',
      gonicSongId: 'song-1',
    });
    c.imports.recordPublished({
      itemId: 'item-1',
      workerId: 'worker-1',
      eventId: 'event-1',
      mediaLinkId: 'media-1',
    });
    c.imports.finishRegistration({
      itemId: 'item-1',
      workerId: 'worker-1',
      mediaLinkId: 'media-1',
    });

    const snapshot = join(c.root, 'import-snapshot');
    await c.createBackup(c.db, c.keyPath, snapshot);
    const restored = join(c.root, 'import-restored');
    await c.restoreBackup(snapshot, restored);
    expect(c.importsFor(c.open(restored)).createJob({ ...input, id: 'ignored' })).toMatchObject({
      outcome: 'existing',
      job: { id: 'job-1', status: 'completed' },
    });

    const raw = new DatabaseSync(join(snapshot, 'management.sqlite'));
    raw.prepare("UPDATE download_events SET library_id='other-library'").run();
    raw.close();
    await expect(c.restoreBackup(snapshot, join(c.root, 'tampered-restore'))).rejects.toThrow(
      'Restore failed',
    );
  });
  /** Uncommitted records never enter a snapshot. */
  it('should capture committed data while another connection holds uncommitted changes', async () => {
    const c = await makeSUT();
    const other = c.open();
    const original = c.instances.get();
    other.connection.exec('BEGIN IMMEDIATE');
    other.connection.exec('UPDATE instance SET policy_revision=10');
    const backup = join(c.root, 'snapshot');
    try {
      await c.createBackup(c.db, c.keyPath, backup);
    } finally {
      other.connection.exec('ROLLBACK');
    }
    const restored = join(c.root, 'restored');
    await c.restoreBackup(backup, restored);
    expect(c.createInstanceRepository(c.open(restored), c.vault.keyId).get()).toEqual(original);
  });
  /** Backup and restore never overwrite an existing destination. */
  it('should refuse overwrite without altering live storage or existing snapshot', async () => {
    const c = await makeSUT();
    c.sessions.create(proof);
    const backup = join(c.root, 'snapshot');
    await c.createBackup(c.db, c.keyPath, backup);
    const before = readFileSync(join(backup, 'management.sqlite'));
    await expect(c.createBackup(c.db, c.keyPath, backup)).rejects.toThrow('Backup failed');
    await expect(c.restoreBackup(backup, c.data)).rejects.toThrow('Restore failed');
    expect(readFileSync(join(backup, 'management.sqlite'))).toEqual(before);
  });
  /** A snapshot without the original key cannot restore authenticated sessions. */
  it('should reject missing and mismatched snapshot keys and leave no partial restore', async () => {
    const c = await makeSUT();
    c.sessions.create(proof);
    const backup = join(c.root, 'snapshot');
    await c.createBackup(c.db, c.keyPath, backup);
    const key = join(backup, 'credential.key');
    writeFileSync(key, Buffer.alloc(32, 9));
    const restored = join(c.root, 'restored');
    await expect(c.restoreBackup(backup, restored)).rejects.toThrow('Restore failed');
    expect(existsSync(restored)).toBe(false);
    unlinkSync(key);
    await expect(c.restoreBackup(backup, restored)).rejects.toThrow('Restore failed');
    expect(existsSync(key)).toBe(false);
  });
  /** Failed backup cannot leave an artifact that looks complete. */
  it('should reject mismatched live key and unsupported or corrupt snapshot', async () => {
    const c = await makeSUT();
    c.sessions.create(proof);
    const backup = join(c.root, 'snapshot');
    const wrong = join(c.root, 'wrong.key');
    c.createKey(wrong);
    await expect(c.createBackup(c.db, wrong, backup)).rejects.toThrow('Backup failed');
    expect(existsSync(backup)).toBe(false);
    await c.createBackup(c.db, c.keyPath, backup);
    writeFileSync(join(backup, 'management.sqlite'), 'corrupt fixture');
    await expect(c.restoreBackup(backup, join(c.root, 'restored'))).rejects.toThrow(
      'Restore failed',
    );
  });
  /** Unsupported versions and altered authenticated rows are rejected before publication. */
  it('should reject future migration and tampered credentials during restore', async () => {
    const c = await makeSUT();
    c.sessions.create(proof);
    const snapshot = join(c.root, 'snapshot');
    await c.createBackup(c.db, c.keyPath, snapshot);
    const path = join(snapshot, 'management.sqlite');
    const raw = new DatabaseSync(path);
    raw.exec('PRAGMA user_version=99');
    raw.close();
    const destination = join(c.root, 'restored');
    await expect(c.restoreBackup(snapshot, destination)).rejects.toThrow('Restore failed');
    expect(existsSync(destination)).toBe(false);
    const altered = new DatabaseSync(path);
    altered.exec("PRAGMA user_version=1; UPDATE sessions SET encrypted_proof='invalid-envelope'");
    altered.close();
    await expect(c.restoreBackup(snapshot, destination)).rejects.toThrow('Restore failed');
    expect(existsSync(destination)).toBe(false);
  });
});
