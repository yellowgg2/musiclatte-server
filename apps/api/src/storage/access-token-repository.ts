import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  decodeAccessToken,
  validateTokenLibraries,
  validateTokenName,
  validateTokenScopes,
  type AccessToken,
  type AccessTokenScope,
  type SubsonicTokenProof,
} from '@musiclatte/contracts';
import type { CredentialVault } from '../security/credential-vault.js';
import type { ManagementDatabase } from './database.js';
import { createInstanceRepository } from './instance-repository.js';

interface TokenRow {
  accessToken: AccessToken;
  instanceId: string;
  ownerUsername: string;
  tokenHash: string;
  policyRevision: number;
  encryptedProof: string | null;
}
function decodeRow(raw: Record<string, unknown>): TokenRow {
  const { instance_id, owner_username, token_hash, policy_revision, encrypted_proof } = raw;
  if (
    typeof instance_id !== 'string' ||
    !instance_id ||
    typeof owner_username !== 'string' ||
    !owner_username ||
    typeof token_hash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(token_hash) ||
    typeof policy_revision !== 'number' ||
    !Number.isSafeInteger(policy_revision) ||
    policy_revision < 1 ||
    !(encrypted_proof === null || typeof encrypted_proof === 'string') ||
    typeof raw.scopes_json !== 'string' ||
    typeof raw.library_ids_json !== 'string'
  )
    throw new Error('Invalid token storage');
  return {
    instanceId: instance_id,
    ownerUsername: owner_username,
    tokenHash: token_hash,
    policyRevision: policy_revision,
    encryptedProof: encrypted_proof,
    accessToken: decodeAccessToken({
      id: raw.id,
      name: raw.name,
      scopes: JSON.parse(raw.scopes_json),
      libraryIds: JSON.parse(raw.library_ids_json),
      createdAt: raw.created_at,
      expiresAt: raw.expires_at,
      revokedAt: raw.revoked_at,
      lastUsedAt: raw.last_used_at,
    }),
  };
}
function context(row: TokenRow): string {
  const token = row.accessToken;
  return JSON.stringify([
    'musiclatte-pat',
    1,
    token.id,
    row.tokenHash,
    row.instanceId,
    row.ownerUsername,
    token.name,
    token.scopes,
    token.libraryIds,
    token.createdAt,
    token.expiresAt,
    row.policyRevision,
  ]);
}
export function validateAccessTokens(db: DatabaseSync, vault: CredentialVault): void {
  const instance = db.prepare('SELECT id,policy_revision FROM instance WHERE singleton=1').get();
  for (const raw of db.prepare('SELECT * FROM access_tokens').iterate()) {
    const row = decodeRow(raw);
    if (
      row.instanceId !== instance?.id ||
      (row.accessToken.revokedAt === null &&
        (row.policyRevision !== instance?.policy_revision ||
          !row.encryptedProof ||
          vault.open(row.encryptedProof, context(row)).username !== row.ownerUsername))
    )
      throw new Error('Invalid token storage');
  }
}
export function createAccessTokenRepository(options: {
  database: ManagementDatabase;
  vault: CredentialVault;
  clock: () => number;
  maxAgeMs: number;
}) {
  const { database, vault, clock, maxAgeMs } = options;
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) throw new Error('Invalid token max age');
  const instances = createInstanceRepository(database, vault.keyId);
  const db = database.connection;
  function atomic<T>(work: () => T): T {
    return db.isTransaction ? work() : database.transaction(work);
  }
  function now(): number {
    const value = clock();
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid token time');
    return value;
  }
  function discard(id: string, time: number): void {
    db.prepare(
      'UPDATE access_tokens SET revoked_at=COALESCE(revoked_at,?),encrypted_proof=NULL WHERE id=?',
    ).run(time, id);
  }
  function cursorContext(owner: string): string {
    const instance = instances.get();
    const epoch = db
      .prepare('SELECT credential_epoch FROM automation_state WHERE singleton=1')
      .get()?.credential_epoch;
    if (typeof epoch !== 'string' || !/^[a-f0-9]{64}$/.test(epoch))
      throw new Error('Storage unavailable');
    return JSON.stringify([
      'musiclatte-pat-list',
      1,
      instance.id,
      instance.policyRevision,
      epoch,
      owner,
    ]);
  }
  return {
    create(input: {
      name: string;
      scopes: AccessTokenScope[];
      libraryIds: string[];
      expiresAt: number;
      proof: SubsonicTokenProof;
    }): { token: string; accessToken: AccessToken } {
      const createdAt = now();
      const scopes = validateTokenScopes(input.scopes);
      const libraryIds = validateTokenLibraries(input.libraryIds);
      const name = validateTokenName(input.name);
      if (
        !Number.isSafeInteger(input.expiresAt) ||
        input.expiresAt <= createdAt ||
        input.expiresAt - createdAt > maxAgeMs
      )
        throw new Error('Invalid token expiry');
      return database.transaction(() => {
        const instance = instances.get();
        const token = `mlpat_${randomBytes(32).toString('base64url')}`;
        const accessToken: AccessToken = {
          id: randomUUID(),
          name,
          scopes,
          libraryIds,
          createdAt,
          expiresAt: input.expiresAt,
          revokedAt: null,
          lastUsedAt: null,
        };
        const row: TokenRow = {
          accessToken,
          instanceId: instance.id,
          ownerUsername: input.proof.username,
          tokenHash: createHash('sha256').update(token).digest('hex'),
          policyRevision: instance.policyRevision,
          encryptedProof: null,
        };
        const envelope = vault.seal(input.proof, context(row));
        db.prepare(
          'INSERT INTO access_tokens(id,instance_id,owner_username,name,scopes_json,library_ids_json,token_hash,created_at,expires_at,revoked_at,last_used_at,policy_revision,encrypted_proof) VALUES(?,?,?,?,?,?,?,?,?,NULL,NULL,?,?)',
        ).run(
          accessToken.id,
          instance.id,
          input.proof.username,
          name,
          JSON.stringify(scopes),
          JSON.stringify(libraryIds),
          row.tokenHash,
          createdAt,
          input.expiresAt,
          instance.policyRevision,
          envelope,
        );
        return { token, accessToken };
      });
    },
    findByHash(hash: string): {
      accessToken: AccessToken;
      instanceId: string;
      ownerUsername: string;
      policyRevision: number;
      proof: SubsonicTokenProof;
    } | null {
      if (!/^[a-f0-9]{64}$/.test(hash)) return null;
      return atomic(() => {
        const time = now();
        const raw = db.prepare('SELECT * FROM access_tokens WHERE token_hash=?').get(hash);
        if (!raw) return null;
        try {
          const row = decodeRow(raw);
          const instance = instances.get();
          const token = row.accessToken;
          if (
            token.revokedAt !== null ||
            token.expiresAt <= time ||
            token.createdAt > time ||
            (token.lastUsedAt !== null && token.lastUsedAt > time) ||
            row.instanceId !== instance.id ||
            row.policyRevision !== instance.policyRevision ||
            !row.encryptedProof
          )
            throw new Error();
          const proof = vault.open(row.encryptedProof, context(row));
          if (proof.username !== row.ownerUsername) throw new Error();
          return {
            accessToken: token,
            instanceId: row.instanceId,
            ownerUsername: row.ownerUsername,
            policyRevision: row.policyRevision,
            proof,
          };
        } catch {
          if (typeof raw.id === 'string') discard(raw.id, time);
          return null;
        }
      });
    },
    markUsed(id: string): void {
      db.prepare(
        'UPDATE access_tokens SET last_used_at=? WHERE id=? AND revoked_at IS NULL AND expires_at>? AND created_at<=?',
      ).run(now(), id, now(), now());
    },
    listOwned(
      owner: string,
      options: { limit?: number; cursor?: string } = {},
    ): { accessTokens: AccessToken[]; total: number; nextCursor: string | null } {
      const limit = options.limit ?? 25;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw new Error('Invalid token limit');
      return database.transaction(() => {
        let after: { createdAt: number; id: string } | null = null;
        const aad = cursorContext(owner);
        if (options.cursor) {
          try {
            const decoded = vault.open(options.cursor, aad);
            const value: unknown = JSON.parse(decoded.t);
            if (
              !value ||
              typeof value !== 'object' ||
              !('createdAt' in value) ||
              !('id' in value) ||
              typeof value.createdAt !== 'number' ||
              !Number.isSafeInteger(value.createdAt) ||
              typeof value.id !== 'string' ||
              decoded.username !== owner
            )
              throw new Error();
            after = { createdAt: value.createdAt, id: value.id };
          } catch {
            throw new Error('Invalid token cursor');
          }
        }
        const rows = after
          ? db
              .prepare(
                'SELECT * FROM access_tokens WHERE owner_username=? AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?',
              )
              .all(owner, after.createdAt, after.createdAt, after.id, limit + 1)
          : db
              .prepare(
                'SELECT * FROM access_tokens WHERE owner_username=? ORDER BY created_at DESC,id DESC LIMIT ?',
              )
              .all(owner, limit + 1);
        const accessTokens = rows.slice(0, limit).map((raw) => decodeRow(raw).accessToken);
        const last = accessTokens.at(-1);
        const total = db
          .prepare('SELECT count(*) AS count FROM access_tokens WHERE owner_username=?')
          .get(owner)?.count;
        if (typeof total !== 'number') throw new Error('Storage unavailable');
        const nextCursor =
          rows.length > limit && last
            ? vault.seal(
                {
                  username: owner,
                  t: JSON.stringify({ createdAt: last.createdAt, id: last.id }),
                  s: 'cursor-v1',
                },
                aad,
              )
            : null;
        return { accessTokens, total, nextCursor };
      });
    },
    revokeOwned(owner: string, id: string): boolean {
      return database.transaction(() => {
        if (
          !db.prepare('SELECT id FROM access_tokens WHERE id=? AND owner_username=?').get(id, owner)
        )
          return false;
        discard(id, now());
        return true;
      });
    },
  };
}
