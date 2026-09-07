import {
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, proof } from '../../../tests/support/session-storage-harness.js';
import { createMetadataBackup, restoreMetadataBackup } from '../src/metadata/backup.js';

let context: Awaited<ReturnType<typeof createTestContext>> | undefined;
afterEach(() => {
  context?.cleanup();
  context = undefined;
});
async function setup() {
  const c = (context = await createTestContext());
  const root = realpathSync(c.root);
  const directory = (name: string) => {
    const path = join(root, name);
    mkdirSync(path, { mode: 0o700 });
    return path;
  };
  const privateRoot = directory('metadata-data');
  const uploadRoot = directory('metadata-uploads');
  const musicRoot = directory('music');
  const fileAccess = {
    musicRoot,
    python: '/usr/bin/python3',
    helperPath: resolve('apps/api/helpers/file_access.py'),
    timeoutMs: 1000,
    maxFileBytes: 1024,
  };
  const destination = join(root, 'snapshot');
  const backup = () =>
    createMetadataBackup({
      database: c.db,
      keyPath: c.keyPath,
      privateRoot,
      uploadRoot,
      destination,
      fileAccess,
    });
  const targets = {
    management: directory('new-management'),
    keyRoot: directory('new-keys'),
    privateRoot: directory('new-data'),
    uploadRoot: directory('new-uploads'),
  };
  const restore = () => restoreMetadataBackup({ source: destination, ...targets, fileAccess });
  return { c, privateRoot, uploadRoot, destination, targets, backup, restore };
}
describe('matching metadata snapshots', () => {
  it('should leave a missing source database uninitialized when the backup CLI is invoked', async () => {
    const s = await setup();
    const policy = join(realpathSync(s.c.root), 'metadata-policy.json');
    writeFileSync(
      policy,
      JSON.stringify({
        schemaVersion: 1,
        enabled: true,
        libraries: [],
        restoreManagers: [],
        limits: { maxTargets: 1, maxFileBytes: 1024, timeoutMs: 1000 },
      }),
      { mode: 0o600 },
    );
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'apps/api/src/metadata-backup-entry.ts', 'create', s.destination],
      {
        encoding: 'utf8',
        timeout: 10000,
        env: {
          ...process.env,
          METADATA_ENABLED: 'true',
          METADATA_POLICY_PATH: policy,
          METADATA_MUSIC_ROOT: join(realpathSync(s.c.root), 'music'),
          METADATA_PYTHON: '/usr/bin/python3',
          METADATA_HELPER_PATH: resolve('apps/api/helpers/metadata.py'),
          MANAGEMENT_DIRECTORY: s.targets.management,
          METADATA_DATA_ROOT: s.privateRoot,
          METADATA_UPLOAD_ROOT: s.uploadRoot,
          CREDENTIAL_KEY_PATH: s.c.keyPath,
        },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('metadata_snapshot_failed\n');
    expect(readdirSync(s.targets.management)).toEqual([]);
  });
  it('should preserve private backup bytes and authenticated sessions in empty replacement volumes', async () => {
    const s = await setup();
    const session = s.c.sessions.create(proof);
    writeFileSync(join(s.privateRoot, 'original.backup'), 'synthetic original', { mode: 0o600 });
    writeFileSync(join(s.uploadRoot, 'orphan'), 'unreferenced', { mode: 0o600 });
    await s.backup();
    await s.restore();
    expect(readFileSync(join(s.targets.privateRoot, 'original.backup'), 'utf8')).toBe(
      'synthetic original',
    );
    expect(readdirSync(s.targets.uploadRoot)).toEqual([]);
    const db = s.c.open(s.targets.management);
    expect(s.c.sessionsFor(db).find(session.token)?.proof).toEqual(proof);
    expect(readFileSync(join(s.targets.keyRoot, 'credential.key'))).toEqual(
      readFileSync(s.c.keyPath),
    );
    await expect(s.restore()).rejects.toThrow('metadata_restore_failed');
    expect(s.c.sessionsFor(db).find(session.token)?.proof).toEqual(proof);
  });
  it('should reject active workers and corrupted bytes without altering empty targets', async () => {
    const s = await setup();
    s.c.db.connection.exec(
      "UPDATE metadata_worker_state SET status='idle',worker_id='active',heartbeat_at=1000",
    );
    await expect(s.backup()).rejects.toThrow('metadata_backup_requires_stopped_workers');
    s.c.db.connection.exec(
      "UPDATE metadata_worker_state SET status='stopped',worker_id=NULL,heartbeat_at=NULL",
    );
    writeFileSync(join(s.privateRoot, 'original.backup'), 'synthetic original', { mode: 0o600 });
    await s.backup();
    writeFileSync(join(s.destination, 'data/original.backup'), 'corrupt');
    await expect(s.restore()).rejects.toThrow('metadata_restore_failed');
    for (const path of Object.values(s.targets)) expect(readdirSync(path)).toEqual([]);
  });
  it('should refuse private-store symlinks without reading their targets', async () => {
    const s = await setup();
    symlinkSync(s.c.keyPath, join(s.privateRoot, 'unexpected'));
    await expect(s.backup()).rejects.toThrow('metadata_backup_failed');
    expect(readFileSync(s.c.keyPath)).toHaveLength(32);
  });
});
