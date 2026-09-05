import { randomBytes, randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Explicit first-run operation. Atomic no-clobber publication; never regenerate on load. */
export function createKey(path: string): void {
  const temporary = join(dirname(path), `.credential-${randomUUID()}.key`);
  let fd: number | undefined;
  let owned = false;
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    fd = openSync(temporary, 'wx', 0o600); owned = true;
    writeFileSync(fd, randomBytes(32)); fsyncSync(fd); closeSync(fd); fd = undefined;
    linkSync(temporary, path);
    const directory = openSync(dirname(path), 'r'); try { fsyncSync(directory); } finally { closeSync(directory); }
  } catch { throw new Error('Key creation failed'); }
  finally { if (fd !== undefined) closeSync(fd); if (owned) unlinkSync(temporary); }
}
export function loadKey(path: string): Buffer {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size !== 32 || (stat.mode & 0o077) !== 0) throw new Error();
    const key = readFileSync(fd); if (key.length !== 32) throw new Error(); return key;
  } catch { throw new Error('Reauthentication required'); }
  finally { if (fd !== undefined) closeSync(fd); }
}
