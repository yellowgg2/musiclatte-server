import { createHash, randomBytes } from 'node:crypto';
import type { SubsonicTokenProof } from '@musiclatte/contracts';
import type { CredentialVault } from '../security/credential-vault.js';
import type { ManagementDatabase } from './database.js';
import { createInstanceRepository } from './instance-repository.js';
export interface StoredSession {
  username: string;
  proof: SubsonicTokenProof;
  expiresAt: number;
  instanceId: string;
  policyRevision: number;
}
export interface SessionRow {
  id_hash: string;
  instance_id: string;
  policy_revision: number;
  username: string;
  encrypted_proof: string | null;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
}
export function sessionContext(row: SessionRow): string {
  return JSON.stringify([
    row.id_hash,
    row.instance_id,
    row.policy_revision,
    row.username,
    row.created_at,
    row.expires_at,
  ]);
}
export function decodeSessionRow(value: Record<string, unknown>): SessionRow {
  const {
    id_hash,
    instance_id,
    policy_revision,
    username,
    encrypted_proof,
    created_at,
    expires_at,
    revoked_at,
  } = value;
  if (
    typeof id_hash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(id_hash) ||
    typeof instance_id !== 'string' ||
    !instance_id ||
    typeof username !== 'string' ||
    !username ||
    typeof policy_revision !== 'number' ||
    !Number.isSafeInteger(policy_revision) ||
    policy_revision < 1 ||
    typeof created_at !== 'number' ||
    !Number.isSafeInteger(created_at) ||
    created_at < 0 ||
    typeof expires_at !== 'number' ||
    !Number.isSafeInteger(expires_at) ||
    expires_at <= created_at ||
    !(
      revoked_at === null ||
      (typeof revoked_at === 'number' && Number.isSafeInteger(revoked_at) && revoked_at >= 0)
    ) ||
    !(encrypted_proof === null || typeof encrypted_proof === 'string')
  )
    throw new Error('Reauthentication required');
  return {
    id_hash,
    instance_id,
    policy_revision,
    username,
    encrypted_proof,
    created_at,
    expires_at,
    revoked_at,
  };
}
export function createSessionRepository(options: {
  database: ManagementDatabase;
  vault: CredentialVault;
  maxAgeMs: number;
  clock: () => number;
}) {
  const { database, vault, maxAgeMs, clock } = options;
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) throw new Error('Invalid session max age');
  const instances = createInstanceRepository(database, vault.keyId);
  const db = database.connection;
  const hash = (token: string) => createHash('sha256').update(token).digest('hex');
  function now(): number {
    const value = clock();
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid session time');
    return value;
  }
  function discard(id: string, time: number): void {
    db.prepare(
      'UPDATE sessions SET revoked_at=COALESCE(revoked_at,?),encrypted_proof=NULL WHERE id_hash=?',
    ).run(time, id);
  }
  return {
    create(proof: SubsonicTokenProof): { token: string; expiresAt: number } {
      const createdAt = now();
      const expiresAt = createdAt + maxAgeMs;
      if (!Number.isSafeInteger(expiresAt)) throw new Error('Invalid session time');
      try {
        return database.transaction(() => {
          const instance = instances.get();
          const token = randomBytes(32).toString('base64url');
          const row: SessionRow = {
            id_hash: hash(token),
            instance_id: instance.id,
            policy_revision: instance.policyRevision,
            username: proof.username,
            encrypted_proof: null,
            created_at: createdAt,
            expires_at: expiresAt,
            revoked_at: null,
          };
          const envelope = vault.seal(proof, sessionContext(row));
          db.prepare(
            'INSERT INTO sessions(id_hash,instance_id,policy_revision,username,encrypted_proof,created_at,expires_at,revoked_at) VALUES(?,?,?,?,?,?,?,NULL)',
          ).run(
            row.id_hash,
            row.instance_id,
            row.policy_revision,
            row.username,
            envelope,
            createdAt,
            expiresAt,
          );
          return { token, expiresAt };
        });
      } catch {
        throw new Error('Storage unavailable');
      }
    },
    find(token: string): StoredSession | null {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
      try {
        return database.transaction(() => {
          const time = now();
          const id = hash(token);
          const raw = db.prepare('SELECT * FROM sessions WHERE id_hash=?').get(id);
          if (!raw) return null;
          try {
            const row = decodeSessionRow(raw);
            const instance = instances.get();
            if (
              row.revoked_at !== null ||
              row.expires_at <= time ||
              row.created_at > time ||
              row.instance_id !== instance.id ||
              row.policy_revision !== instance.policyRevision ||
              !row.encrypted_proof
            ) {
              discard(id, time);
              return null;
            }
            const proof = vault.open(row.encrypted_proof, sessionContext(row));
            if (proof.username !== row.username) {
              discard(id, time);
              return null;
            }
            return {
              username: row.username,
              proof,
              expiresAt: row.expires_at,
              instanceId: row.instance_id,
              policyRevision: row.policy_revision,
            };
          } catch {
            discard(id, time);
            return null;
          }
        });
      } catch {
        throw new Error('Storage unavailable');
      }
    },
    revoke(token: string): void {
      try {
        const time = now();
        database.transaction(() => discard(hash(token), time));
      } catch {
        throw new Error('Storage unavailable');
      }
    },
  };
}
