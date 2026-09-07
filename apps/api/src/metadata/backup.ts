import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { dirname, isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ManagementDatabase } from '../storage/database.js';
import { createBackup, restoreBackup } from '../storage/backup.js';
import { loadKey } from '../security/key-store.js';
import { validateRelativeKey } from '../imports/policy.js';
import { createMetadataFileAccess, type MetadataFileAccessOptions } from './file-access.js';
import { metadataDirectory } from './runtime-config.js';

interface StoredFile {
  key: string;
  size: number;
  digest: string;
}
interface Manifest {
  schemaVersion: 1;
  database: StoredFile[];
  data: StoredFile[];
  uploads: StoredFile[];
  music: { key: string; digest: string }[];
}
function regular(source: string, destination?: string): Omit<StoredFile, 'key'> {
  const fd = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  let output: number | undefined;
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size > 2n * 1024n * 1024n * 1024n)
      throw new Error();
    if (destination)
      output = openSync(
        destination,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(1024 * 1024);
    let size = 0;
    while (true) {
      const count = readSync(fd, buffer);
      if (!count) break;
      size += count;
      if (size > Number(before.size)) throw new Error();
      hash.update(buffer.subarray(0, count));
      if (output !== undefined) {
        let written = 0;
        while (written < count) written += writeSync(output, buffer, written, count - written);
      }
    }
    const after = fstatSync(fd, { bigint: true });
    if (
      size !== Number(before.size) ||
      before.ino !== after.ino ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    )
      throw new Error();
    if (output !== undefined) fsyncSync(output);
    return { size, digest: hash.digest('hex') };
  } finally {
    closeSync(fd);
    if (output !== undefined) closeSync(output);
  }
}
function inventory(root: string, excludeTransient = false): string[] {
  const result: string[] = [];
  const visit = (relative: string) => {
    const directory = join(root, relative);
    if (lstatSync(directory).isSymbolicLink()) throw new Error();
    for (const name of readdirSync(directory).sort()) {
      if (excludeTransient && !relative && /^\.(self-test|cover-check)-/.test(name)) continue;
      const key = validateRelativeKey(relative ? `${relative}/${name}` : name);
      const stat = lstatSync(join(root, key));
      if (stat.isSymbolicLink()) throw new Error();
      if (stat.isDirectory()) visit(key);
      else if (stat.isFile()) result.push(key);
      else throw new Error();
      if (result.length > 100000) throw new Error();
    }
  };
  visit('');
  return result;
}
function copyFiles(source: string, destination: string, keys: string[]): StoredFile[] {
  return keys.map((key) => {
    validateRelativeKey(key);
    mkdirSync(dirname(join(destination, key)), { recursive: true, mode: 0o700 });
    return { key, ...regular(join(source, key), join(destination, key)) };
  });
}
function syncDirectory(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function requireStopped(db: DatabaseSync) {
  for (const table of ['metadata_worker_state', 'worker_state'])
    if (db.prepare(`SELECT status FROM ${table} WHERE singleton=1`).get()?.status !== 'stopped')
      throw new Error('metadata_backup_requires_stopped_workers');
}
function signature(manifest: Manifest, key: Uint8Array) {
  return createHmac('sha256', key).update(JSON.stringify(manifest)).digest('hex');
}

export async function createMetadataBackup(options: {
  database: ManagementDatabase;
  keyPath: string;
  privateRoot: string;
  uploadRoot: string;
  destination: string;
  fileAccess: MetadataFileAccessOptions;
}) {
  let owned = false;
  try {
    requireStopped(options.database.connection);
    metadataDirectory(options.privateRoot, true, false);
    metadataDirectory(options.uploadRoot, true, false);
    if (
      !isAbsolute(options.destination) ||
      [options.privateRoot, options.uploadRoot, options.fileAccess.musicRoot].some(
        (root) => options.destination === root || options.destination.startsWith(`${root}/`),
      )
    )
      throw new Error();
    mkdirSync(options.destination, { mode: 0o700 });
    owned = true;
    await createBackup(options.database, options.keyPath, join(options.destination, 'database'));
    const snapshot = new DatabaseSync(join(options.destination, 'database/management.sqlite'), {
      readOnly: true,
    });
    let uploads: string[];
    let keys: string[];
    try {
      requireStopped(snapshot);
      uploads = snapshot
        .prepare('SELECT relative_key FROM metadata_cover_uploads ORDER BY relative_key')
        .all()
        .map((row) => String(row.relative_key));
      keys = snapshot
        .prepare(
          'SELECT DISTINCT l.relative_file_key FROM media_links l JOIN metadata_items i ON i.media_link_id=l.id ORDER BY l.relative_file_key',
        )
        .all()
        .map((row) => String(row.relative_file_key));
    } finally {
      snapshot.close();
    }
    mkdirSync(join(options.destination, 'data'), { mode: 0o700 });
    mkdirSync(join(options.destination, 'uploads'), { mode: 0o700 });
    const data = copyFiles(
      options.privateRoot,
      join(options.destination, 'data'),
      inventory(options.privateRoot, true),
    );
    const copiedUploads = copyFiles(
      options.uploadRoot,
      join(options.destination, 'uploads'),
      uploads,
    );
    const access = createMetadataFileAccess(options.fileAccess);
    const music: Manifest['music'] = [];
    for (const key of keys) music.push({ key, digest: (await access.inspect(key)).digest });
    requireStopped(options.database.connection);
    const manifest: Manifest = {
      schemaVersion: 1,
      database: inventory(join(options.destination, 'database')).map((key) => ({
        key,
        ...regular(join(options.destination, 'database', key)),
      })),
      data,
      uploads: copiedUploads,
      music,
    };
    writeFileSync(
      join(options.destination, 'manifest.json'),
      JSON.stringify({ manifest, signature: signature(manifest, loadKey(options.keyPath)) }),
      { flag: 'wx', mode: 0o600, flush: true },
    );
    for (const path of ['database', 'data', 'uploads', ''])
      syncDirectory(join(options.destination, path));
  } catch (error) {
    if (owned) rmSync(options.destination, { recursive: true, force: true });
    if (error instanceof Error && error.message === 'metadata_backup_requires_stopped_workers')
      throw error;
    throw new Error('metadata_backup_failed');
  }
}

/** Restore into operator-provisioned empty volumes; current music bytes must match the snapshot. */
export async function restoreMetadataBackup(options: {
  source: string;
  management: string;
  keyRoot: string;
  privateRoot: string;
  uploadRoot: string;
  fileAccess: MetadataFileAccessOptions;
}) {
  const targets = [options.management, options.keyRoot, options.privateRoot, options.uploadRoot];
  let writing = false;
  try {
    metadataDirectory(options.source, true, false);
    for (const root of targets) {
      metadataDirectory(root, true);
      if (readdirSync(root).length) throw new Error();
    }
    const roots = [...targets, options.source, options.fileAccess.musicRoot];
    if (
      roots.some((root, i) =>
        roots.some((other, j) => i !== j && (root === other || root.startsWith(`${other}/`))),
      )
    )
      throw new Error();
    const manifestFd = openSync(
      join(options.source, 'manifest.json'),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    let raw: Buffer;
    try {
      const stat = fstatSync(manifestFd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 32 * 1024 * 1024) throw new Error();
      raw = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < raw.length) {
        const count = readSync(manifestFd, raw, offset, raw.length - offset, null);
        if (!count) throw new Error();
        offset += count;
      }
      if (fstatSync(manifestFd).size !== stat.size) throw new Error();
    } finally {
      closeSync(manifestFd);
    }
    const receipt = JSON.parse(raw.toString()) as { manifest: Manifest; signature: string };
    const manifest = receipt.manifest;
    const expected = signature(manifest, loadKey(join(options.source, 'database/credential.key')));
    if (
      !/^[a-f0-9]{64}$/.test(receipt.signature) ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(receipt.signature)) ||
      manifest.schemaVersion !== 1
    )
      throw new Error();
    for (const kind of ['database', 'data', 'uploads'] as const) {
      if (
        !Array.isArray(manifest[kind]) ||
        manifest[kind].length > 100000 ||
        JSON.stringify(inventory(join(options.source, kind))) !==
          JSON.stringify(manifest[kind].map((file) => file.key).sort())
      )
        throw new Error();
      for (const file of manifest[kind]) {
        validateRelativeKey(file.key);
        const actual = regular(join(options.source, kind, file.key));
        if (actual.digest !== file.digest || actual.size !== file.size) throw new Error();
      }
    }
    const access = createMetadataFileAccess(options.fileAccess);
    for (const file of manifest.music)
      if ((await access.inspect(file.key)).digest !== file.digest) throw new Error();
    writing = true;
    const temporary = join(options.management, `.restore-${randomUUID()}`);
    await restoreBackup(join(options.source, 'database'), temporary);
    renameSync(join(temporary, 'management.sqlite'), join(options.management, 'management.sqlite'));
    // Management and keys are distinct Docker volumes; rename cannot cross that boundary.
    regular(join(temporary, 'credential.key'), join(options.keyRoot, 'credential.key'));
    rmSync(temporary, { recursive: true, force: true });
    copyFiles(
      join(options.source, 'data'),
      options.privateRoot,
      manifest.data.map((file) => file.key),
    );
    copyFiles(
      join(options.source, 'uploads'),
      options.uploadRoot,
      manifest.uploads.map((file) => file.key),
    );
    for (const root of targets) syncDirectory(root);
  } catch (cause) {
    if (writing)
      for (const root of targets)
        for (const name of readdirSync(root))
          rmSync(join(root, name), { recursive: true, force: true });
    throw new Error('metadata_restore_failed', { cause });
  }
}
