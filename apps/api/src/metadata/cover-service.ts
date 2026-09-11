import {
  revalidateMetadataPrincipal,
  isTokenPrincipal,
  metadataCredentialFingerprint,
} from '../auth/metadata-principal.js';
import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { ApiError, type SessionService } from '../auth/session-service.js';
import type { MetadataProvider } from './provider.js';
import { createMetadataHelper, metadataProtectiveDefaults } from './helper-client.js';
import { canEditMetadata } from './policy.js';
import type { VerifiedMetadataSession as Verified } from './resolver.js';

/** Payloads stay outside SQLite and the music tree; only validated scoped handles cross HTTP. */
export function createMetadataCoverService(service: SessionService, p: MetadataProvider) {
  const { options, identity, hash } = p;
  const root = options.uploadRoot;
  if (
    !isAbsolute(root) ||
    root === options.runtime.musicRoot ||
    root.startsWith(`${options.runtime.musicRoot}/`) ||
    realpathSync(root) !== root
  )
    throw new Error('invalid_metadata_config');
  const stat = lstatSync(root, { bigint: true });
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    Number(stat.mode & 0o777n) !== 0o700 ||
    Number(stat.uid) !== process.getuid?.()
  )
    throw new Error('invalid_metadata_config');
  const rootIdentity = { device: String(stat.dev), inode: String(stat.ino) };
  const verifyRoot = () => {
    const current = lstatSync(root, { bigint: true });
    if (
      !current.isDirectory() ||
      current.dev !== stat.dev ||
      current.ino !== stat.ino ||
      current.mode !== stat.mode ||
      realpathSync(root) !== root
    )
      throw new Error('invalid_metadata_config');
  };
  const db = options.database.connection;
  let activeUploads = 0;
  const helper = createMetadataHelper({ ...options.runtime, musicRoot: root });
  const referenced = (id: string) =>
    !!db
      .prepare(
        "SELECT 1 FROM metadata_items WHERE json_extract(patch_json,'$.cover.uploadId')=? LIMIT 1",
      )
      .get(id);
  const find = (v: Verified, id: string, libraryId?: string) => {
    const row = db
      .prepare(
        'SELECT * FROM metadata_cover_uploads WHERE id=? AND identity_key=? AND actor_token_id IS ?',
      )
      .get(id, identity(v), isTokenPrincipal(v) ? v.accessToken.id : null);
    if (
      !row ||
      (libraryId !== undefined && row.library_id !== libraryId) ||
      (Number(row.expires_at) <= options.clock() && !referenced(id))
    )
      throw new ApiError(404, 'not_found');
    return row;
  };
  const resolveUpload = (v: Verified, id: string, libraryId: string) => {
    const row = find(v, id, libraryId);
    verifyRoot();
    const key = String(row.relative_key);
    if (!/^[a-f0-9-]{36}\.upload$/.test(key)) throw new Error('Storage unavailable');
    return {
      root,
      rootIdentity,
      key,
      expectedDigest: String(row.digest),
      mimeType: String(row.mime_type),
    };
  };
  const project = (row: Record<string, unknown>) => ({
    schemaVersion: 1 as const,
    uploadId: String(row.id),
    libraryId: String(row.library_id),
    mimeType: String(row.mime_type),
    size: Number(row.size),
    expiresAt: Number(row.expires_at),
    previewUrl: `/api/v1/metadata-covers/${encodeURIComponent(String(row.id))}`,
  });
  const cleanup = () =>
    options.database.transaction(() => {
      verifyRoot();
      for (const row of db
        .prepare('SELECT id,relative_key FROM metadata_cover_uploads WHERE expires_at<=?')
        .all(options.clock())) {
        if (referenced(String(row.id))) continue;
        const key = String(row.relative_key);
        if (!/^[a-f0-9-]{36}\.upload$/.test(key)) throw new Error('Storage unavailable');
        try {
          unlinkSync(join(root, key));
        } catch (error) {
          if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
            throw error;
        }
        db.prepare('DELETE FROM metadata_cover_uploads WHERE id=?').run(String(row.id));
      }
      for (const key of readdirSync(root)) {
        if (
          !/^[a-f0-9-]{36}\.upload$/.test(key) ||
          db.prepare('SELECT 1 FROM metadata_cover_uploads WHERE relative_key=?').get(key)
        )
          continue;
        const orphan = lstatSync(join(root, key));
        if (
          orphan.isFile() &&
          !orphan.isSymbolicLink() &&
          orphan.uid === process.getuid?.() &&
          orphan.mtimeMs < options.clock() - 86400000
        )
          unlinkSync(join(root, key));
      }
    });
  return {
    resolve: resolveUpload,
    cleanup,
    async upload(
      v: Verified,
      libraryId: string,
      operationId: string,
      mimeType: string,
      data: Buffer,
    ) {
      if (!/^[A-Za-z0-9_-]{22,128}$/.test(operationId) || !/^[A-Za-z0-9_-]{1,128}$/.test(libraryId))
        throw new ApiError(400, 'invalid_request');
      if (
        !canEditMetadata(options.policy, v.identity.username, libraryId) ||
        !(await p.allowedLibraries(v)).includes(libraryId)
      )
        throw new ApiError(403, 'forbidden');
      if (
        !['image/jpeg', 'image/png'].includes(mimeType) ||
        !data.length ||
        data.length > metadataProtectiveDefaults.coverBytes
      )
        throw new ApiError(413, 'invalid_request');
      const digest = createHash('sha256').update(data).digest('hex');
      const operation = hash(
        'cover-operation',
        isTokenPrincipal(v) ? [metadataCredentialFingerprint(v), operationId] : operationId,
      );
      const replay = () => {
        const row = db
          .prepare(
            'SELECT * FROM metadata_cover_uploads WHERE identity_key=? AND operation_id_hash=?',
          )
          .get(identity(v), operation);
        if (!row) return null;
        if (row.digest !== digest || row.mime_type !== mimeType || row.library_id !== libraryId)
          throw new ApiError(409, 'conflict');
        find(v, String(row.id), libraryId);
        return project(row);
      };
      const existing = replay();
      if (existing) return existing;
      cleanup();
      if (activeUploads >= 4) throw new ApiError(429, 'invalid_request');
      const id = randomUUID();
      const key = `${id}.upload`;
      verifyRoot();
      const fd = openSync(
        join(root, key),
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      let retained = false;
      activeUploads += 1;
      try {
        try {
          writeFileSync(fd, data);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        const decoded = await helper.validateCover(key);
        if (
          decoded.digest !== digest ||
          decoded.mimeType !== mimeType ||
          decoded.size !== data.length
        )
          throw new ApiError(422, 'invalid_request');
        await revalidateMetadataPrincipal(service, v);
        return options.database.transaction(() => {
          const duplicate = replay();
          if (duplicate) return duplicate;
          const used = db
            .prepare(
              "SELECT count(*) AS n,COALESCE(sum(size),0) AS bytes FROM metadata_cover_uploads u WHERE identity_key=? AND NOT EXISTS (SELECT 1 FROM metadata_items i WHERE json_extract(i.patch_json,'$.cover.uploadId')=u.id)",
            )
            .get(identity(v))!;
          if (Number(used.n) >= 32 || Number(used.bytes) + data.length > 64 * 1024 * 1024)
            throw new ApiError(429, 'invalid_request');
          verifyRoot();
          const dir = openSync(
            root,
            constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
          );
          try {
            fsyncSync(dir);
          } finally {
            closeSync(dir);
          }
          db.prepare(
            'INSERT INTO metadata_cover_uploads(id,identity_key,library_id,operation_id_hash,digest,relative_key,mime_type,size,created_at,expires_at,actor_token_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
          ).run(
            id,
            identity(v),
            libraryId,
            operation,
            digest,
            key,
            mimeType,
            data.length,
            options.clock(),
            options.clock() + 86400000,
            isTokenPrincipal(v) ? v.accessToken.id : null,
          );
          retained = true;
          return project(find(v, id, libraryId));
        });
      } finally {
        activeUploads -= 1;
        if (!retained) {
          verifyRoot();
          unlinkSync(join(root, key));
        }
      }
    },
    async read(v: Verified, id: string) {
      const row = find(v, id);
      if (!(await p.allowedLibraries(v)).includes(String(row.library_id)))
        throw new ApiError(404, 'not_found');
      const target = resolveUpload(v, id, String(row.library_id));
      const fd = openSync(join(root, target.key), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const before = fstatSync(fd);
        if (
          !before.isFile() ||
          before.nlink !== 1 ||
          before.size !== Number(row.size) ||
          before.size > metadataProtectiveDefaults.coverBytes
        )
          throw new Error('invalid_cover');
        const data = readFileSync(fd);
        verifyRoot();
        if (createHash('sha256').update(data).digest('hex') !== row.digest)
          throw new Error('invalid_cover');
        return { mimeType: String(row.mime_type), data };
      } finally {
        closeSync(fd);
      }
    },
  };
}
