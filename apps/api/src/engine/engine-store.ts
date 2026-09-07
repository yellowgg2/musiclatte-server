import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export interface EngineFile {
  version: string;
  hash: string;
}
export interface EngineCandidate extends EngineFile {
  key: string;
}
export interface EnginePointer {
  active: EngineFile;
  previous: EngineFile | null;
  status: 'never_checked' | 'active' | 'restored';
}
const versionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const keyPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export function validateEngineVersion(version: string): string {
  if (!versionPattern.test(version)) throw new Error('invalid_version');
  return version;
}
function validateFileRecord(file: EngineFile) {
  validateEngineVersion(file.version);
  if (!hashPattern.test(file.hash)) throw new Error('invalid_hash');
}
function sync(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
/** Private managed directories and opened regular files are checked before any read or mutation. */
export function createEngineStore(root: string) {
  const directory = (path: string) => {
    if (!isAbsolute(path) || resolve(path) !== path || realpathSync(path) !== path)
      throw new Error('invalid_executable');
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o022) !== 0)
      throw new Error('invalid_executable');
  };
  try {
    directory(root);
  } catch {
    throw new Error('invalid_executable');
  }
  const subdirectory = (name: string) => {
    directory(root);
    const path = join(root, name);
    if (!lstatSync(path, { throwIfNoEntry: false })) mkdirSync(path, { mode: 0o700 });
    directory(path);
    return path;
  };
  subdirectory('versions');
  subdirectory('candidates');
  const inspect = (path: string, expectedHash?: string, executable = true) => {
    let fd: number | undefined;
    try {
      if (!isAbsolute(path) || realpathSync(path) !== path) throw new Error('invalid_executable');
      const before = lstatSync(path);
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        before.nlink !== 1 ||
        before.size < 1 ||
        before.size > 128 * 1024 * 1024 ||
        (before.mode & 0o6022) !== 0 ||
        (executable && !(before.mode & 0o100))
      )
        throw new Error('invalid_executable');
      fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = fstatSync(fd);
      if (stat.ino !== before.ino || stat.dev !== before.dev) throw new Error('invalid_executable');
      const bytes = readFileSync(fd);
      const hash = createHash('sha256').update(bytes).digest('hex');
      const after = fstatSync(fd);
      if (stat.size !== after.size || stat.ctimeMs !== after.ctimeMs)
        throw new Error('invalid_executable');
      if (expectedHash !== undefined && (!hashPattern.test(expectedHash) || hash !== expectedHash))
        throw new Error('invalid_hash');
      return { hash, bytes };
    } catch (error) {
      throw new Error(
        error instanceof Error && error.message === 'invalid_hash'
          ? 'invalid_hash'
          : 'invalid_executable',
      );
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  };
  const executable = (file: EngineFile) => {
    validateFileRecord(file);
    return join(subdirectory('versions'), `${file.version}-${file.hash}`);
  };
  const candidatePath = (key: string) => {
    if (!keyPattern.test(key)) throw new Error('invalid_executable');
    const path = join(subdirectory('candidates'), key);
    directory(path);
    return join(path, 'yt-dlp');
  };
  const removeCandidate = (key: string) => {
    if (!keyPattern.test(key)) throw new Error('invalid_executable');
    const parent = subdirectory('candidates');
    const path = join(parent, key);
    if (!lstatSync(path, { throwIfNoEntry: false })) return;
    directory(path);
    rmSync(path, { recursive: true });
    sync(parent);
  };
  const install = (source: string, file: EngineFile) => {
    validateFileRecord(file);
    const bytes = inspect(source, file.hash).bytes;
    const target = executable(file);
    if (lstatSync(target, { throwIfNoEntry: false })) {
      inspect(target, file.hash);
      return { version: file.version, hash: file.hash };
    }
    const temporary = join(subdirectory('versions'), `.install-${randomUUID()}`);
    try {
      writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o500 });
      sync(temporary);
      try {
        linkSync(temporary, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    } finally {
      if (lstatSync(temporary, { throwIfNoEntry: false })) unlinkSync(temporary);
    }
    sync(subdirectory('versions'));
    inspect(target, file.hash);
    return { version: file.version, hash: file.hash };
  };
  const readPointer = (): EnginePointer | null => {
    directory(root);
    const path = join(root, 'active.json');
    if (!lstatSync(path, { throwIfNoEntry: false })) return null;
    try {
      if (lstatSync(path).size > 2048) throw new Error();
      const value: EnginePointer = JSON.parse(
        inspect(path, undefined, false).bytes.toString('utf8'),
      );
      if (!value || !['never_checked', 'active', 'restored'].includes(value.status))
        throw new Error();
      validateFileRecord(value.active);
      if (value.previous !== null) {
        validateFileRecord(value.previous);
        if (value.previous.version === value.active.version) throw new Error();
      }
      return value;
    } catch {
      throw new Error('invalid_executable');
    }
  };
  return {
    inspect,
    executable,
    candidatePath,
    readPointer,
    removeCandidate,
    installSeed(seed: EngineFile & { executable: string }) {
      return install(seed.executable, seed);
    },
    copyCandidate(active: EngineFile) {
      const source = executable(active);
      inspect(source, active.hash);
      const key = randomUUID();
      mkdirSync(join(subdirectory('candidates'), key), { mode: 0o700 });
      try {
        const path = candidatePath(key);
        copyFileSync(source, path, constants.COPYFILE_EXCL);
        chmodSync(path, 0o700);
        inspect(path, active.hash);
        sync(path);
        return { key, path };
      } catch (error) {
        removeCandidate(key);
        throw error;
      }
    },
    persistCandidate(candidate: EngineCandidate) {
      const path = candidatePath(candidate.key);
      inspect(path, candidate.hash);
      sync(path);
      sync(dirname(path));
      sync(subdirectory('candidates'));
    },
    promote(candidate: EngineCandidate) {
      return install(candidatePath(candidate.key), candidate);
    },
    writePointer(pointer: EnginePointer) {
      directory(root);
      inspect(executable(pointer.active), pointer.active.hash);
      if (pointer.previous) {
        validateFileRecord(pointer.previous);
        if (pointer.previous.version === pointer.active.version) throw new Error('invalid_version');
      }
      const target = join(root, 'active.json');
      if (lstatSync(target, { throwIfNoEntry: false })) readPointer();
      const temporary = join(root, `.pointer-${randomUUID()}`);
      try {
        writeFileSync(temporary, JSON.stringify(pointer), { flag: 'wx', mode: 0o600 });
        sync(temporary);
        renameSync(temporary, target);
        sync(root);
      } finally {
        if (lstatSync(temporary, { throwIfNoEntry: false })) unlinkSync(temporary);
      }
    },
  };
}
export type EngineStore = ReturnType<typeof createEngineStore>;
