import {
  closeSync,
  constants,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, type ManagementDatabase } from '../../apps/api/src/storage/database.js';
import { createKey, loadKey } from '../../apps/api/src/security/key-store.js';
import { createCredentialVault } from '../../apps/api/src/security/credential-vault.js';
import { createInstanceRepository } from '../../apps/api/src/storage/instance-repository.js';
import { createPlaylistOperationRepository } from '../../apps/api/src/storage/playlist-operation-repository.js';
import { createSessionRepository } from '../../apps/api/src/storage/session-repository.js';
import { readSessionPolicy } from '../../apps/api/src/config/session-policy.js';
import { createBackup, restoreBackup } from '../../apps/api/src/storage/backup.js';
import { createImportRepository } from '../../apps/api/src/storage/import-repository.js';
import { createMediaLinkRepository } from '../../apps/api/src/storage/media-link-repository.js';
import { createEngineRepository } from '../../apps/api/src/storage/engine-repository.js';
import { createWorkerStateRepository } from '../../apps/api/src/storage/worker-state-repository.js';

const modules = {
  openDatabase,
  createKey,
  loadKey,
  createCredentialVault,
  createInstanceRepository,
  createPlaylistOperationRepository,
  createSessionRepository,
  readSessionPolicy,
  createBackup,
  restoreBackup,
  createImportRepository,
  createMediaLinkRepository,
  createEngineRepository,
  createWorkerStateRepository,
};
export function createLegacyV1(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'management.sqlite');
  const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  closeSync(fd);
  const database = new DatabaseSync(path);
  try {
    database.exec(
      readFileSync(
        new URL('../../apps/api/src/storage/migrations/001-session.sql', import.meta.url),
        'utf8',
      ),
    );
  } finally {
    database.close();
  }
}

export function createLegacyV2(directory: string): void {
  createLegacyV1(directory);
  const database = new DatabaseSync(join(directory, 'management.sqlite'));
  try {
    database.exec(
      readFileSync(
        new URL(
          '../../apps/api/src/storage/migrations/002-playlist-operations.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
  } finally {
    database.close();
  }
}
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
    const playlistOperationsFor = (database = db) =>
      modules.createPlaylistOperationRepository({ database, clock: () => now });
    const importsFor = (database = db) =>
      modules.createImportRepository({ database, clock: () => now });
    const mediaLinksFor = (database = db) =>
      modules.createMediaLinkRepository({ database, clock: () => now });
    const enginesFor = (database = db) =>
      modules.createEngineRepository({ database, clock: () => now });
    const workerStatesFor = (database = db) =>
      modules.createWorkerStateRepository({ database, clock: () => now });
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
      playlistOperationsFor,
      playlistOperations: playlistOperationsFor(),
      importsFor,
      imports: importsFor(),
      mediaLinksFor,
      mediaLinks: mediaLinksFor(),
      enginesFor,
      engines: enginesFor(),
      workerStatesFor,
      workerStates: workerStatesFor(),
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
