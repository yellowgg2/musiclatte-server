import { describe, expect, it } from 'vitest';
import { createTestContext } from '../../../tests/support/session-storage-harness.js';
import { join, resolve } from 'node:path';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const limits = {
  claimLeaseMs: 1000,
  maxTargets: 10,
  snapshotMaxAgeMs: 1000,
  snapshotMaxItems: 100,
  snapshotMaxCount: 10,
};
const observation = {
  revision: 'r1',
  requiredFingerprint: 'required',
  audioIdentity: 'audio',
  policyVersion: 'required-v1',
  trusted: true,
  title: 'Synthetic',
  artist: ['Artist'],
  fields: { title: true, artist: true, album: false, cover: false, lyrics: false },
  changedFields: ['title', 'artist', 'album', 'cover', 'lyrics'] as const,
};
describe('durable curation storage', () => {
  it('preserves append-only receipts, evidence and frozen selection across live changes', async () => {
    const { createCurationRepository } = await import('../src/storage/curation-repository.js');
    const c = await createTestContext();
    let now = 1000;
    try {
      const repo = createCurationRepository({
        database: c.db,
        clock: () => now,
        cursorKey: new Uint8Array(32).fill(7),
        limits,
      });
      const a = repo.discover({
        libraryId: 'lib',
        trackId: 'a',
        format: 'mp3',
        fileIdentity: 'file-a',
      });
      repo.discover({ libraryId: 'lib', trackId: 'b', format: 'mp3', fileIdentity: 'file-b' });
      expect(repo.get(a)?.curationStatus).toBe('unreviewed');
      expect(repo.get(a)?.fieldStates.lyrics.status).toBe('unknown');
      repo.observe(a, observation);
      const receipt = repo.complete(
        a,
        { username: 'synthetic', credentialKind: 'session', tokenId: null, clientLabel: null },
        null,
      );
      repo.attempt(a, 'lyrics', 'unavailable', 'No usable source', null, 'actor');
      repo.observe(a, {
        ...observation,
        revision: 'r2',
        fields: { ...observation.fields, album: true },
        changedFields: ['album'],
      });
      expect(repo.get(a)).toMatchObject({
        curationStatus: 'completed',
        fileRevision: 'r2',
        receipt: { id: receipt.id, verifiedRevision: 'r1' },
        lyricsState: 'unavailable',
      });
      const scope = {
        instanceId: 'instance',
        actorKey: 'actor',
        credentialId: 'token',
        scopes: ['metadata:read'],
        libraryIds: ['lib'],
        policyRevision: 1,
      };
      const first = repo.list(scope, {}, 1);
      expect(first.total).toBe(2);
      expect(first.tracks[0]?.fileRevision).toBe('r2');
      repo.observe(a, { ...observation, revision: 'r3', requiredFingerprint: 'changed' });
      repo.discover({ libraryId: 'lib', trackId: 'c', format: 'mp3', fileIdentity: 'file-c' });
      const second = repo.list(scope, {}, 1, first.nextCursor!);
      expect(second.total).toBe(2);
      expect(second.tracks.map((t) => t.trackId)).toEqual(['b']);
      expect(repo.get(a)?.curationStatus).toBe('needs_review');
      expect(() =>
        c.db.connection.prepare('UPDATE curation_receipts SET verified_revision=?').run('fake'),
      ).toThrow('append-only');
      expect(() => c.db.connection.exec('DELETE FROM curation_events')).toThrow('append-only');
      expect(() =>
        repo.list({ ...scope, credentialId: 'other' }, {}, 1, first.nextCursor!),
      ).toThrow('snapshot_scope_changed');
      expect(() => repo.list(scope, {}, 1, first.nextCursor! + 'a')).toThrow('invalid_cursor');
      now = 2000;
      expect(() => repo.list(scope, {}, 1, first.nextCursor!)).toThrow('snapshot_expired');
    } finally {
      c.cleanup();
    }
  });
  it('uses effective leases, exact missing filters and bounded snapshots; restore invalidates claims only', async () => {
    const { createCurationRepository } = await import('../src/storage/curation-repository.js');
    const c = await createTestContext();
    let now = 1000;
    try {
      const options = {
        database: c.db,
        clock: () => now,
        cursorKey: new Uint8Array(32).fill(7),
        limits: { ...limits, snapshotMaxCount: 2 },
      };
      const repo = createCurationRepository(options);
      const id = repo.discover({
        libraryId: 'lib',
        trackId: 'a',
        format: 'mp3',
        fileIdentity: 'file-a',
      });
      repo.observe(id, observation);
      const receipt = repo.complete(
        id,
        { username: 'test', credentialKind: 'session', tokenId: null, clientLabel: null },
        null,
      );
      const epoch = c.db.connection.prepare('SELECT claim_epoch FROM curation_state').get()!
        .claim_epoch!;
      c.db.connection
        .prepare(
          "INSERT INTO curation_claims VALUES('claim','actor','required_review','[\"title\"]',1,?,1000,2000,NULL)",
        )
        .run(epoch);
      c.db.connection
        .prepare("INSERT INTO curation_claim_items VALUES('claim',?,'file-a',1,'r1')")
        .run(id);
      expect(repo.get(id)?.curationStatus).toBe('in_progress');
      now = 2000;
      expect(repo.get(id)?.curationStatus).toBe('completed');
      now = 1000;
      const scope = {
        instanceId: 'instance',
        actorKey: 'actor',
        credentialId: 'token',
        scopes: ['metadata:read'],
        libraryIds: ['lib'],
        policyRevision: 1,
      };
      expect(repo.list(scope, { missingField: 'lyrics' }).total).toBe(1);
      expect(repo.list(scope, { field: 'lyrics', fieldStatus: 'missing' }).total).toBe(1);
      expect(() => repo.list(scope, {})).toThrow('snapshot_capacity');
      expect(() =>
        repo.attempt(id, 'title' as 'lyrics', 'unavailable', 'reason', null, 'actor'),
      ).toThrow();
      await c.createBackup(c.db, c.keyPath, join(c.root, 'backup'));
      await c.restoreBackup(join(c.root, 'backup'), join(c.root, 'restored'));
      const restored = createCurationRepository({
        ...options,
        database: c.open(join(c.root, 'restored')),
      });
      expect(restored.get(id)).toMatchObject({
        curationStatus: 'completed',
        validation: 'stale',
        receipt: { id: receipt.id },
      });
      expect(repo.get(id)?.curationStatus).toBe('in_progress');
    } finally {
      c.cleanup();
    }
  });
  it('migrates v14 and v16 and rolls back failed v17 DDL atomically', async () => {
    const c = await createTestContext();
    try {
      for (const version of [14, 16]) {
        for (const fail of [false, true]) {
          const dir = join(c.root, `old-${version}-${fail}`);
          mkdirSync(dir);
          const db = new DatabaseSync(join(dir, 'management.sqlite'));
          const migrations = resolve('apps/api/src/storage/migrations');
          for (const name of readdirSync(migrations)
            .filter((name) => Number(name.slice(0, 3)) <= version)
            .sort())
            db.exec(readFileSync(join(migrations, name), 'utf8'));
          if (fail) db.exec('CREATE TABLE curation_tracks(conflict TEXT)');
          db.close();
          if (fail) {
            expect(() => c.open(dir)).toThrow();
            const failed = new DatabaseSync(join(dir, 'management.sqlite'));
            expect(failed.prepare('PRAGMA user_version').get()?.user_version).toBe(version);
            expect(
              failed.prepare("SELECT name FROM sqlite_schema WHERE name='curation_state'").get(),
            ).toBeUndefined();
            failed.close();
          } else {
            const upgraded = c.open(dir);
            expect(upgraded.connection.prepare('PRAGMA user_version').get()?.user_version).toBe(18);
            expect(upgraded.connection.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
          }
        }
      }
    } finally {
      c.cleanup();
    }
  });
});

it('rejects inconsistent backup evidence and binds durable replay to the exact intent', async () => {
  const { createCurationRepository } = await import('../src/storage/curation-repository.js');
  const c = await createTestContext();
  try {
    const repo = createCurationRepository({
      database: c.db,
      clock: () => 1000,
      cursorKey: new Uint8Array(32),
      limits,
    });
    const id = repo.discover({
      libraryId: 'lib',
      trackId: 'a',
      format: 'mp3',
      fileIdentity: 'file-a',
    });
    repo.recordOperation(
      'actor',
      'route',
      'raw-operation-secret',
      { value: 1 },
      { accepted: true },
      [{ trackId: 'a', status: 'granted' }],
    );
    expect(repo.operation('actor', 'route', 'raw-operation-secret', { value: 1 })).toEqual({
      accepted: true,
    });
    expect(repo.operation('other', 'route', 'raw-operation-secret', { value: 1 })).toBeNull();
    expect(() => repo.operation('actor', 'route', 'raw-operation-secret', { value: 2 })).toThrow(
      'operation_conflict',
    );
    expect(
      JSON.stringify(c.db.connection.prepare('SELECT * FROM curation_operations').all()),
    ).not.toContain('raw-operation-secret');
    c.db.connection
      .prepare("DELETE FROM curation_field_states WHERE track_ref=? AND field='lyrics'")
      .run(id);
    await expect(c.createBackup(c.db, c.keyPath, join(c.root, 'corrupt'))).rejects.toThrow(
      'Backup failed',
    );
  } finally {
    c.cleanup();
  }
});
