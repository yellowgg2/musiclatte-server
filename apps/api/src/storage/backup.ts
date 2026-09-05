import {
  closeSync,
  constants,
  copyFileSync,
  fsyncSync,
  mkdirSync,
  openSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { createCredentialVault } from '../security/credential-vault.js';
import { loadKey } from '../security/key-store.js';
import { validateSchema, type ManagementDatabase } from './database.js';
import { decodeSessionRow, sessionContext } from './session-repository.js';

/** Read-only verification: never initialize a missing instance or migrate a recovery artifact. */
function verifySnapshot(path: string, key: Uint8Array): void {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    validateSchema(db);
    if (
      db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok' ||
      db.prepare('PRAGMA foreign_key_check').all().length
    )
      throw new Error();
    const vault = createCredentialVault(key);
    const instance = db
      .prepare('SELECT id,policy_revision,key_id FROM instance WHERE singleton=1')
      .get();
    if (
      !instance ||
      instance.key_id !== vault.keyId ||
      typeof instance.id !== 'string' ||
      typeof instance.policy_revision !== 'number' ||
      !Number.isSafeInteger(instance.policy_revision) ||
      instance.policy_revision < 1
    )
      throw new Error();
    for (const raw of db.prepare('SELECT * FROM sessions').iterate()) {
      const row = decodeSessionRow(raw);
      if (row.instance_id !== instance.id) throw new Error();
      if (row.revoked_at === null) {
        if (
          !row.encrypted_proof ||
          row.policy_revision !== instance.policy_revision ||
          vault.open(row.encrypted_proof, sessionContext(row)).username !== row.username
        )
          throw new Error();
      }
    }
  } finally {
    db.close();
  }
}
function syncFile(path: string): void {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
/** Snapshot complete only on successful resolution. The target must not already exist. */
export async function createBackup(
  database: ManagementDatabase,
  keyPath: string,
  destination: string,
): Promise<void> {
  let owned = false;
  try {
    if (database.connection.isTransaction) throw new Error();
    const key = loadKey(keyPath);
    validateSchema(database.connection);
    if (
      database.connection.prepare('SELECT key_id FROM instance WHERE singleton=1').get()?.key_id !==
      createCredentialVault(key).keyId
    )
      throw new Error();
    mkdirSync(destination, { mode: 0o700 });
    owned = true;
    const path = join(destination, 'management.sqlite');
    // Pre-create at private mode before SQLite opens the destination.
    const fd = openSync(path, 'wx', 0o600);
    closeSync(fd);
    await backup(database.connection, path);
    writeFileSync(join(destination, 'credential.key'), key, { flag: 'wx', mode: 0o600 });
    verifySnapshot(path, key);
    syncFile(path);
    syncFile(join(destination, 'credential.key'));
    syncFile(destination);
  } catch {
    if (owned) rmSync(destination, { recursive: true, force: true });
    throw new Error('Backup failed');
  }
}
/** Offline restore into a new directory. Source must be a completed, immutable backup. */
export async function restoreBackup(source: string, destination: string): Promise<void> {
  let owned = false;
  try {
    const key = loadKey(join(source, 'credential.key'));
    verifySnapshot(join(source, 'management.sqlite'), key);
    mkdirSync(destination, { mode: 0o700 });
    owned = true;
    const path = join(destination, 'management.sqlite');
    const fd = openSync(path, 'wx', 0o600);
    closeSync(fd);
    // Restore via SQLite, not a file-only copy: even an opened snapshot's WAL is included.
    const snapshot = new DatabaseSync(join(source, 'management.sqlite'), { readOnly: true });
    try {
      await backup(snapshot, path);
    } finally {
      snapshot.close();
    }
    copyFileSync(
      join(source, 'credential.key'),
      join(destination, 'credential.key'),
      constants.COPYFILE_EXCL,
    );
    verifySnapshot(path, loadKey(join(destination, 'credential.key')));
    syncFile(path);
    syncFile(join(destination, 'credential.key'));
    syncFile(destination);
  } catch {
    if (owned) rmSync(destination, { recursive: true, force: true });
    throw new Error('Restore failed');
  }
}
