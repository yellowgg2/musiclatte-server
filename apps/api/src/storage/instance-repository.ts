import { randomUUID } from 'node:crypto';
import type { ManagementDatabase } from './database.js';
export interface Instance {
  id: string;
  policyRevision: number;
}
export function createInstanceRepository(database: ManagementDatabase, keyId: string) {
  const db = database.connection;
  function get(): Instance {
    const row = db
      .prepare('SELECT id, policy_revision, key_id FROM instance WHERE singleton=1')
      .get();
    if (
      !row ||
      typeof row.id !== 'string' ||
      typeof row.policy_revision !== 'number' ||
      !Number.isSafeInteger(row.policy_revision) ||
      row.policy_revision < 1 ||
      row.key_id !== keyId
    )
      throw new Error('Reauthentication required');
    return { id: row.id, policyRevision: row.policy_revision };
  }
  database.transaction(() => {
    db.prepare(
      'INSERT OR IGNORE INTO instance(singleton,id,policy_revision,key_id) VALUES(1,?,1,?)',
    ).run(randomUUID(), keyId);
    get();
  });
  return {
    get,
    bumpPolicyRevision(): Instance {
      return database.transaction(() => {
        const instance = get();
        if (!Number.isSafeInteger(instance.policyRevision + 1))
          throw new Error('Invalid policy revision');
        db.prepare('UPDATE instance SET policy_revision=? WHERE singleton=1').run(
          instance.policyRevision + 1,
        );
        // Revision invalidation removes reusable credentials without caching upstream roles.
        db.exec(
          'UPDATE sessions SET encrypted_proof=NULL, revoked_at=COALESCE(revoked_at,created_at)',
        );
        return get();
      });
    },
  };
}
