import { closeSync, constants, openSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
/** A separate kernel-held SQLite lock fences API startup recovery, including after SIGKILL. */
export function acquireListeningRuntime(directory: string): () => void {
  const path = join(directory, 'listening-runtime.lock.sqlite');
  const fd = openSync(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  closeSync(fd);
  const lock = new DatabaseSync(path);
  try {
    lock.exec(
      'PRAGMA busy_timeout=0; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS runtime_lock (singleton INTEGER PRIMARY KEY);',
    );
  } catch {
    lock.close();
    throw new Error('Listening runtime already active');
  }
  return () => {
    if (lock.isOpen) lock.close();
  };
}
