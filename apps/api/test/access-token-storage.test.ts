import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createTestContext } from '../../../tests/support/session-storage-harness.js';
import { proof } from '../../../tests/support/session-storage-harness.js';
import { createHash } from 'node:crypto';

describe('personal access token storage', () => {
  /** Offline restore invalidates automation credentials and cursors while retaining ordinary sessions. */
  it('should invalidate restored PATs without changing existing session restore behavior', async () => {
    const { createAccessTokenRepository } = await import(
      resolve('apps/api/src/storage/access-token-repository.ts')
    );
    const c = await createTestContext();
    try {
      const options = { database: c.db, vault: c.vault, clock: () => 1000, maxAgeMs: 1000 };
      const tokens = createAccessTokenRepository(options);
      const input = {
        name: 'Synthetic restored client',
        scopes: ['metadata:read'],
        libraryIds: ['library-1'],
        expiresAt: 2000,
        proof,
      };
      const issued = tokens.create(input);
      tokens.create(input);
      const cursor = tokens.listOwned(proof.username, { limit: 1 }).nextCursor;
      const session = c.sessions.create(proof);
      const snapshot = join(c.root, 'restore-source');
      await c.createBackup(c.db, c.keyPath, snapshot);
      const destination = join(c.root, 'restore-target');
      await c.restoreBackup(snapshot, destination);
      const db = c.open(destination);
      const restored = createAccessTokenRepository({ ...options, database: db });
      expect(
        restored.findByHash(createHash('sha256').update(issued.token).digest('hex')),
      ).toBeNull();
      expect(c.sessionsFor(db).find(session.token)?.proof).toEqual(proof);
      expect(c.createInstanceRepository(db, c.vault.keyId).get()).toEqual(c.instances.get());
      expect(() => restored.listOwned(proof.username, { cursor })).toThrow('Invalid token cursor');
      expect(
        tokens.findByHash(createHash('sha256').update(issued.token).digest('hex')),
      ).not.toBeNull();
      expect(
        db.connection
          .prepare('SELECT count(*) AS count FROM access_tokens WHERE encrypted_proof IS NOT NULL')
          .get()?.count,
      ).toBe(0);
      expect(restored.listOwned(proof.username).total).toBe(2);
    } finally {
      c.cleanup();
    }
  });
  /** Backup validates live PAT envelopes and rejects row tampering without publishing an artifact. */
  it('should validate encrypted token storage before publishing a backup', async () => {
    const path = resolve('apps/api/src/storage/access-token-repository.ts');
    const { createAccessTokenRepository } = await import(path);
    const c = await createTestContext();
    try {
      const repository = createAccessTokenRepository({
        database: c.db,
        vault: c.vault,
        clock: () => 1000,
        maxAgeMs: 1000,
      });
      const issued = repository.create({
        name: 'Synthetic backup client',
        scopes: ['metadata:read'],
        libraryIds: ['library-1'],
        expiresAt: 2000,
        proof,
      });
      await c.createBackup(c.db, c.keyPath, join(c.root, 'valid-token-snapshot'));
      c.db.connection
        .prepare('UPDATE access_tokens SET expires_at=expires_at+1 WHERE id=?')
        .run(issued.accessToken.id);
      const invalid = join(c.root, 'invalid-token-snapshot');
      await expect(c.createBackup(c.db, c.keyPath, invalid)).rejects.toThrow('Backup failed');
      expect(existsSync(invalid)).toBe(false);
    } finally {
      c.cleanup();
    }
  });
  /** Real v14 migration preserves authenticated sessions and failed DDL rolls back to v14. */
  it('should migrate populated v14 storage atomically and preserve its credentials', async () => {
    const c = await createTestContext();
    try {
      function legacy(name: string, conflict: boolean) {
        const directory = join(c.root, name);
        mkdirSync(directory);
        const db = new DatabaseSync(join(directory, 'management.sqlite'));
        const migrations = resolve('apps/api/src/storage/migrations');
        for (const file of readdirSync(migrations)
          .filter((file) => /^0(0[1-9]|1[0-4])-/.test(file))
          .sort())
          db.exec(readFileSync(join(migrations, file), 'utf8'));
        const source = c.sessions.create(proof);
        const instance = c.db.connection.prepare('SELECT * FROM instance').get()!;
        db.prepare('INSERT INTO instance(singleton,id,policy_revision,key_id) VALUES(1,?,?,?)').run(
          instance.id!,
          instance.policy_revision!,
          instance.key_id!,
        );
        const row = c.db.connection
          .prepare('SELECT * FROM sessions WHERE id_hash=?')
          .get(createHash('sha256').update(source.token).digest('hex'))!;
        db.prepare(
          'INSERT INTO sessions(id_hash,instance_id,policy_revision,username,encrypted_proof,created_at,expires_at,revoked_at) VALUES(?,?,?,?,?,?,?,?)',
        ).run(
          row.id_hash!,
          row.instance_id!,
          row.policy_revision!,
          row.username!,
          row.encrypted_proof!,
          row.created_at!,
          row.expires_at!,
          row.revoked_at!,
        );
        if (conflict) db.exec('CREATE TABLE access_tokens(conflict TEXT) STRICT');
        db.close();
        return { directory, source };
      }
      const good = legacy('v14-good', false);
      const migrated = c.open(good.directory);
      expect(c.sessionsFor(migrated).find(good.source.token)?.proof).toEqual(proof);
      expect(migrated.connection.prepare('PRAGMA user_version').get()).toEqual({
        user_version: 18,
      });
      const broken = legacy('v14-conflict', true);
      expect(() => c.open(broken.directory)).toThrow();
      const inspected = new DatabaseSync(join(broken.directory, 'management.sqlite'), {
        readOnly: true,
      });
      try {
        expect(inspected.prepare('PRAGMA user_version').get()).toEqual({ user_version: 14 });
        expect(inspected.prepare('SELECT count(*) AS count FROM sessions').get()?.count).toBe(1);
      } finally {
        inspected.close();
      }
    } finally {
      c.cleanup();
    }
  });
  /** Fresh storage establishes the private PAT ledger without enabling HTTP authentication. */
  it('should migrate to the token ledger and preserve existing session tables', async () => {
    const c = await createTestContext();
    try {
      expect(c.db.connection.prepare('PRAGMA user_version').get()).toEqual({ user_version: 18 });
      const tables = c.db.connection
        .prepare("SELECT name FROM sqlite_schema WHERE type='table'")
        .all()
        .map((row) => row.name);
      expect(tables).toContain('access_tokens');
      expect(tables).toContain('sessions');
      expect(tables).toContain('metadata_items');
      expect(tables).toContain('scan_schedule');
    } finally {
      c.cleanup();
    }
  });

  /** The public creation result is the only source of raw tokens; storage exposes owner metadata. */
  it('should provide a repository for hash-only row-bound token credentials', async () => {
    const path = resolve('apps/api/src/storage/access-token-repository.ts');
    expect(existsSync(path)).toBe(true);
    const module = await import(path);
    expect(typeof module.createAccessTokenRepository).toBe('function');
    const c = await createTestContext();
    let now = 1000;
    try {
      const repository = module.createAccessTokenRepository({
        database: c.db,
        vault: c.vault,
        clock: () => now,
        maxAgeMs: 1000,
      });
      const input = {
        name: 'Synthetic client',
        scopes: ['metadata:read'],
        libraryIds: ['library-1'],
        expiresAt: 2000,
        proof,
      };
      const a = repository.create(input);
      const b = repository.create(input);
      expect(a.token).toMatch(/^mlpat_[A-Za-z0-9_-]{43}$/);
      const hash = (token: string) => createHash('sha256').update(token).digest('hex');
      const raw = c.db.connection
        .prepare('SELECT * FROM access_tokens WHERE id=?')
        .get(a.accessToken.id);
      expect(raw?.token_hash).toBe(hash(a.token));
      expect(JSON.stringify(raw)).not.toContain(a.token);
      expect(JSON.stringify(raw)).not.toContain(proof.t);
      expect(repository.findByHash(hash(a.token))).toMatchObject({
        proof,
        accessToken: a.accessToken,
      });
      const page = repository.listOwned(proof.username, { limit: 1 });
      expect(page.total).toBe(2);
      expect(page.accessTokens).toHaveLength(1);
      expect(page.nextCursor).toBeTypeOf('string');
      const next = repository.listOwned(proof.username, { limit: 1, cursor: page.nextCursor });
      expect(next.accessTokens[0].id).not.toBe(page.accessTokens[0].id);
      expect(next.nextCursor).toBeNull();
      expect(() => repository.listOwned('another-user', { cursor: page.nextCursor })).toThrow();
      expect(repository.revokeOwned('another-user', a.accessToken.id)).toBe(false);
      expect(repository.revokeOwned(proof.username, a.accessToken.id)).toBe(true);
      expect(repository.revokeOwned(proof.username, a.accessToken.id)).toBe(true);
      expect(repository.findByHash(hash(a.token))).toBeNull();
      now = 1999;
      expect(repository.findByHash(hash(b.token))).not.toBeNull();
      now = 2000;
      expect(repository.findByHash(hash(b.token))).toBeNull();
      now = 1000;
      expect(repository.findByHash(hash(b.token))).toBeNull();
      const d = repository.create(input);
      const e = repository.create(input);
      c.db.connection
        .prepare(
          'UPDATE access_tokens SET encrypted_proof=(SELECT encrypted_proof FROM access_tokens WHERE id=?) WHERE id=?',
        )
        .run(d.accessToken.id, e.accessToken.id);
      expect(repository.findByHash(hash(e.token))).toBeNull();
      c.instances.bumpPolicyRevision();
      expect(repository.findByHash(hash(d.token))).toBeNull();
      const f = repository.create(input);
      now = 999;
      expect(repository.findByHash(hash(f.token))).toBeNull();
      for (const scopes of [
        ['lyrics:write'],
        ['curation:write'],
        ['unknown'],
        ['metadata:read', 'metadata:read'],
      ]) {
        now = 1000;
        expect(() => repository.create({ ...input, scopes })).toThrow();
      }
    } finally {
      c.cleanup();
    }
  });
});
