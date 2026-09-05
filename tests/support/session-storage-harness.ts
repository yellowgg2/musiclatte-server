import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type ManagementDatabase } from '../../apps/api/src/storage/database.js';
import { createKey, loadKey } from '../../apps/api/src/security/key-store.js';
import { createCredentialVault } from '../../apps/api/src/security/credential-vault.js';
import { createInstanceRepository } from '../../apps/api/src/storage/instance-repository.js';
import { createSessionRepository } from '../../apps/api/src/storage/session-repository.js';
import { readSessionPolicy } from '../../apps/api/src/config/session-policy.js';
import { createBackup, restoreBackup } from '../../apps/api/src/storage/backup.js';

const modules = {
  openDatabase,
  createKey,
  loadKey,
  createCredentialVault,
  createInstanceRepository,
  createSessionRepository,
  readSessionPolicy,
  createBackup,
  restoreBackup,
};
/** Synthetic only; never derived from a live account. */
export const proof = { username: 'fixture-user', t: 'synthetic-token-proof', s: 'synthetic-salt' };
export async function createTestContext() {
  const root = mkdtempSync(join(tmpdir(), 'musiclatte-storage-'));
  const data = join(root, 'management');
  const keyPath = join(root, 'secrets', 'credential.key');
  const connections: ManagementDatabase[] = [];
  let now = 1000;
  const open = (directory = data) => {
    const db = modules.openDatabase(directory);
    connections.push(db);
    return db;
  };
  try {
    modules.createKey(keyPath);
    const vault = modules.createCredentialVault(modules.loadKey(keyPath));
    const db = open();
    const instances = modules.createInstanceRepository(db, vault.keyId);
    const sessionsFor = (database = db, maxAgeMs = 1000) =>
      modules.createSessionRepository({ database, vault, maxAgeMs, clock: () => now });
    return {
      ...modules,
      root,
      data,
      keyPath,
      db,
      vault,
      instances,
      open,
      sessionsFor,
      sessions: sessionsFor(),
      setNow: (value: number) => {
        now = value;
      },
      cleanup: () => {
        for (const connection of connections) connection.close();
        rmSync(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    for (const connection of connections) connection.close();
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
