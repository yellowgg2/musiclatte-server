import { describe, expect, it } from 'vitest';
import { createMetadataPrincipalContext } from '../../../tests/support/metadata-principal-harness.js';
import { recentNow } from '../../../tests/support/recent-harness.js';
import { createTestContext } from '../../../tests/support/session-storage-harness.js';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { createSessionService } from '../src/auth/session-service.js';
import { verifyAccessTokenPrincipal } from '../src/auth/metadata-principal.js';
import { createMetadataService } from '../src/metadata/service.js';
import { createMetadataRepository } from '../src/storage/metadata-repository.js';
import { createAccessTokenService } from '../src/auth/access-token-service.js';

describe('metadata principal compatibility', () => {
  /** A populated v15 FK graph retains jobs, backups, locks, rechecks and sessions through the rebuild. */
  it('should preserve populated legacy metadata relationships through migration 016', async () => {
    const c = await createMetadataPrincipalContext();
    try {
      const preview = (await c.get()).json();
      const response = await c.post('metadata-jobs', {
        operationId: 'metadata_operation_00000000000000000002',
        targets: [{ trackId: 'track-1', expectedRevision: preview.fileRevision }],
        patch: { title: { op: 'set', value: 'Synthetic migration' } },
      });
      expect(response.statusCode).toBe(202);
      const repository = createMetadataRepository({
        database: c.storage.db,
        clock: () => recentNow,
      });
      const claim = repository.claimNext({
        workerId: 'synthetic-migration-worker',
        leaseDurationMs: 1000,
      })!;
      const work = repository.readWork(claim);
      repository.recordBackup({
        ...claim,
        backup: {
          id: 'synthetic-migration-backup',
          relativeKey: 'synthetic.original',
          preimageDigest: work.expectedDigest,
          size: 128,
          mode: 420,
          ownerProfile: { uid: 1000, gid: 1000 },
        },
      });
      repository.transition({ ...claim, stage: 'backed_up' });
      c.storage.db.connection
        .prepare(
          'INSERT INTO metadata_rechecks(identity_key,operation_id_hash,request_hash,job_id,created_at) VALUES(?,?,?,?,?)',
        )
        .run(work.identityKey, 'c'.repeat(64), 'd'.repeat(64), work.jobId, recentNow);
      const directory = resolve(c.storage.root, 'legacy-v15');
      mkdirSync(directory);
      const raw = new DatabaseSync(resolve(directory, 'management.sqlite'));
      const snapshots: { table: string; columns: string; rows: Record<string, unknown>[] }[] = [];
      try {
        raw.exec('PRAGMA foreign_keys=OFF');
        const migrations = resolve('apps/api/src/storage/migrations');
        for (const file of readdirSync(migrations)
          .filter((name) => /^0(0[1-9]|1[0-5])-/.test(name))
          .sort())
          raw.exec(readFileSync(resolve(migrations, file), 'utf8'));
        for (const tableRow of raw
          .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name<>'sqlite_sequence'")
          .all()) {
          const table = String(tableRow.name);
          const columns = raw
            .prepare(`PRAGMA table_info(${table})`)
            .all()
            .map((row) => String(row.name));
          const selected = columns.join(',');
          const rows = c.storage.db.connection.prepare(`SELECT ${selected} FROM ${table}`).all();
          raw.exec(`DELETE FROM ${table}`);
          const insert = raw.prepare(
            `INSERT INTO ${table}(${selected}) VALUES(${columns.map(() => '?').join(',')})`,
          );
          for (const row of rows) insert.run(...columns.map((column) => row[column]!));
          snapshots.push({ table, columns: selected, rows });
        }
        expect(raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      } finally {
        raw.close();
      }
      const migrated = c.storage.open(directory);
      for (const snapshot of snapshots)
        expect(
          migrated.connection.prepare(`SELECT ${snapshot.columns} FROM ${snapshot.table}`).all(),
        ).toEqual(snapshot.rows);
      expect(migrated.connection.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(migrated.connection.prepare('PRAGMA user_version').get()?.user_version).toBe(25);
      expect(
        migrated.connection
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type='index' AND name IN ('metadata_items_file','metadata_items_runnable')",
          )
          .all(),
      ).toHaveLength(2);
    } finally {
      await c.cleanup();
    }
  });
  /** A fixed admitted intent survives PAT revocation; expanded intent and restored grants are denied. */
  it('should retain only the accepted-work grant after token revocation', async () => {
    const path = resolve('apps/api/src/auth/metadata-job-authorizer.ts');
    expect(existsSync(path)).toBe(true);
    const { createMetadataJobAuthorizer } = await import(path);
    const c = await createMetadataPrincipalContext();
    try {
      const response = await c.app.inject({
        method: 'POST',
        url: '/api/v1/access-tokens',
        headers: c.headers,
        payload: {
          name: 'Synthetic accepted work',
          scopes: ['metadata:read', 'metadata:write'],
          libraryIds: ['music'],
          expiresAt: recentNow + 10000,
        },
      });
      const issued = response.json();
      const service = createSessionService(c.options);
      const principal = await verifyAccessTokenPrincipal(service, issued.token);
      const metadata = createMetadataService(service);
      const file = await metadata.provider.resolver.resolve(principal, 'track-1', 'edit');
      const authorizer = createMetadataJobAuthorizer({
        database: c.storage.db,
        vault: c.storage.vault,
      });
      const item = {
        id: 'synthetic-pat-item',
        mediaLinkId: file.mediaLinkId,
        fileIdentity: file.fileIdentity,
        bindingRevision: file.bindingRevision,
        trackId: file.trackId,
        expectedRevision: file.fileRevision,
        expectedDigest: file.inspection.digest,
        policyRevision: principal.policyRevision,
        patch: { title: { op: 'set' as const, value: 'Synthetic accepted edit' } },
      };
      const identityKey = metadata.provider.identity(principal);
      const grant = authorizer.createGrant(principal, { ...item, identityKey, libraryId: 'music' });
      const repository = createMetadataRepository({
        database: c.storage.db,
        clock: () => recentNow,
      });
      repository.createOrReplay({
        id: 'synthetic-pat-job',
        identityKey,
        libraryId: 'music',
        operationIdHash: 'a'.repeat(64),
        requestHash: 'b'.repeat(64),
        items: [{ ...item, ...grant }],
      });
      const claim = repository.claimNext({ workerId: 'synthetic-worker', leaseDurationMs: 1000 })!;
      const work = repository.readWork(claim);
      createAccessTokenService(service, c.automation).repository.revokeOwned(
        principal.ownerUsername,
        principal.accessToken.id,
      );
      expect(authorizer.authorizeAcceptedWork(work)).toMatchObject({
        username: principal.ownerUsername,
        proof: principal.proof,
      });
      expect(() =>
        authorizer.createGrant(principal, {
          ...item,
          id: 'new-item',
          identityKey,
          libraryId: 'music',
        }),
      ).toThrow();
      expect(() =>
        authorizer.authorizeAcceptedWork({
          ...work,
          patch: { title: { op: 'set', value: 'Expanded intent' } },
        }),
      ).toThrow();
      const snapshot = resolve(c.storage.root, 'grant-snapshot');
      await c.storage.createBackup(c.storage.db, c.storage.keyPath, snapshot);
      const destination = resolve(c.storage.root, 'grant-restored');
      await c.storage.restoreBackup(snapshot, destination);
      const restored = c.storage.open(destination);
      expect(() =>
        createMetadataJobAuthorizer({
          database: restored,
          vault: c.storage.vault,
        }).authorizeAcceptedWork(work),
      ).toThrow();
    } finally {
      await c.cleanup();
    }
  });
  /** Metadata item actors have distinct nullable session and token foreign keys, never fake sessions. */
  it('should establish separate PAT actors with the existing FK graph intact', async () => {
    const c = await createTestContext();
    try {
      expect(c.db.connection.prepare('PRAGMA user_version').get()?.user_version).toBe(25);
      const columns = c.db.connection.prepare('PRAGMA table_info(metadata_items)').all();
      expect(columns.find((row) => row.name === 'actor_session_id')?.notnull).toBe(0);
      expect(columns.some((row) => row.name === 'actor_token_id')).toBe(true);
      expect(c.db.connection.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      c.cleanup();
    }
  });
  /** PAT reads use real file helpers while retaining token-specific handles and no write/restore elevation. */
  it('should allow scoped PAT previews and isolate frames and account-owned legacy jobs', async () => {
    const c = await createMetadataPrincipalContext();
    try {
      const issue = async () => {
        const response = await c.app.inject({
          method: 'POST',
          url: '/api/v1/access-tokens',
          headers: c.headers,
          payload: {
            name: 'Synthetic metadata client',
            scopes: ['metadata:read', 'metadata:write'],
            libraryIds: ['music'],
            expiresAt: recentNow + 10000,
          },
        });
        expect(response.statusCode).toBe(201);
        return response.json();
      };
      const a = await issue();
      const b = await issue();
      const auth = { authorization: `Bearer ${a.token}` };
      const other = { authorization: `Bearer ${b.token}` };
      const preview = await c.app.inject({ url: '/api/v1/tracks/track-1/metadata', headers: auth });
      expect(preview.statusCode).toBe(200);
      expect(preview.json().values.title).toBeTypeOf('string');
      const writePreview = await c.app.inject({
        method: 'POST',
        url: '/api/v1/metadata-previews',
        headers: { ...auth, 'content-type': 'application/json' },
        payload: {
          targets: [
            { trackId: 'track-1', expectedRevision: preview.json().fileRevision as string },
          ],
          patch: { album: { op: 'set', value: 'Synthetic PAT preview' } },
        },
      });
      expect(writePreview.statusCode).toBe(200);
      expect(writePreview.json().changedFields).toEqual(['album']);
      const frame = preview.json().coverFrames[0];
      expect((await c.app.inject({ url: frame.previewUrl, headers: auth })).statusCode).toBe(200);
      expect((await c.app.inject({ url: frame.previewUrl, headers: other })).statusCode).toBe(404);
      const upload = await c.app.inject({
        method: 'POST',
        url: '/api/v1/metadata-covers',
        headers: {
          ...auth,
          'content-type': 'image/png',
          'x-operation-id': 'metadata_operation_00000000000000000003',
          'x-metadata-library-id': 'music',
        },
        payload: readFileSync(resolve(c.root, 'new.png')),
      });
      expect(upload.statusCode).toBe(201);
      expect(
        (await c.app.inject({ url: upload.json().previewUrl, headers: auth })).statusCode,
      ).toBe(200);
      expect(
        (await c.app.inject({ url: upload.json().previewUrl, headers: other })).statusCode,
      ).toBe(404);
      const request = {
        operationId: 'metadata_operation_00000000000000000001',
        targets: [{ trackId: 'track-1', expectedRevision: preview.json().fileRevision }],
        patch: { title: { op: 'set', value: 'Synthetic edit' } },
      };
      expect(
        (
          await c.app.inject({
            method: 'POST',
            url: '/api/v1/metadata-jobs',
            headers: auth,
            payload: request,
          })
        ).statusCode,
      ).toBe(403);
      const legacy = await c.post('metadata-jobs', request);
      expect(legacy.statusCode).toBe(202);
      expect(
        (
          await c.app.inject({
            url: `/api/v1/metadata-jobs/${legacy.json().job.id}`,
            headers: auth,
          })
        ).statusCode,
      ).toBe(404);
      expect((await c.get(`/api/v1/metadata-jobs/${legacy.json().job.id}`)).statusCode).toBe(200);
    } finally {
      await c.cleanup();
    }
  });
});
