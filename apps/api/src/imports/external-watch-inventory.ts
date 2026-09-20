import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  realpathSync,
  type BigIntStats,
  type Dirent,
} from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { posix } from 'node:path';
import type { ManagementDatabase } from '../storage/database.js';
import {
  createExternalWatchRepository,
  type ExternalWatchContinuation,
} from '../storage/external-watch-repository.js';
import { validateRelativeKey } from './policy.js';

interface InventoryTarget {
  libraryId: string;
  relativeRoot: string;
  accountDirectory: string;
  identityKey: string;
}

interface InventoryOptions {
  database: ManagementDatabase;
  musicRoot: string;
  clock: () => number;
  maxEntries?: number;
  maxElapsedMs?: number;
  budgetClock?: () => number;
  readDirectory?: (path: string) => Dirent[];
}

function within(root: string, path: string): boolean {
  const key = relative(root, path);
  return key === '' || (!key.startsWith(`..${sep}`) && key !== '..' && !isAbsolute(key));
}

function closedDirectoryName(name: string): boolean {
  return (
    name.length > 0 &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !/[\u0000-\u001f\u007f]/.test(name)
  );
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev && left.ino === right.ino && left.isDirectory() && right.isDirectory()
  );
}

function visibleDirectoryMatches(path: string, identity: BigIntStats): boolean {
  try {
    const visible = lstatSync(path, { bigint: true, throwIfNoEntry: false });
    return Boolean(
      visible &&
      !visible.isSymbolicLink() &&
      visible.isDirectory() &&
      visible.dev === identity.dev &&
      visible.ino === identity.ino,
    );
  } catch {
    return false;
  }
}

export function externalWatchRootIdentity(stat: Pick<BigIntStats, 'dev' | 'ino'>) {
  const maximum = 9_223_372_036_854_775_807n;
  if (stat.dev < 0n || stat.dev > maximum || stat.ino < 0n || stat.ino > maximum)
    throw new Error('root_unavailable');
  return { device: stat.dev.toString(), inode: stat.ino.toString() };
}

function accountRoot(musicRoot: string, target: InventoryTarget) {
  validateRelativeKey(target.relativeRoot);
  if (
    !target.accountDirectory ||
    target.accountDirectory === '.' ||
    target.accountDirectory === '..' ||
    target.accountDirectory.includes('/') ||
    target.accountDirectory.includes('\\')
  )
    throw new Error('root_unavailable');
  const canonical = realpathSync(musicRoot);
  let current = canonical;
  for (const part of [...target.relativeRoot.split('/'), target.accountDirectory]) {
    current = join(current, part);
    const stat = lstatSync(current, { bigint: true, throwIfNoEntry: false });
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('root_unavailable');
    if (!within(canonical, realpathSync(current))) throw new Error('root_unavailable');
  }
  return { canonical, path: current, stat: lstatSync(current, { bigint: true }) };
}

function directoryEntries(
  path: string,
  readDirectory: (path: string) => Dirent[],
): { entries: Dirent[]; stat: BigIntStats } {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isDirectory()) throw new Error();
    const entries = readDirectory(path).sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    const after = fstatSync(descriptor, { bigint: true });
    const visible = lstatSync(path, { bigint: true, throwIfNoEntry: false });
    if (
      !visible ||
      visible.isSymbolicLink() ||
      !sameIdentity(opened, after) ||
      !sameIdentity(opened, visible)
    )
      throw new Error();
    return { entries, stat: opened };
  } catch {
    throw new Error('entry_unreadable');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function createExternalWatchInventory(options: InventoryOptions) {
  const maxEntries = options.maxEntries ?? 256;
  const maxElapsedMs = options.maxElapsedMs ?? 50;
  if (
    !Number.isSafeInteger(maxEntries) ||
    maxEntries < 1 ||
    maxEntries > 10_000 ||
    !Number.isFinite(maxElapsedMs) ||
    maxElapsedMs <= 0
  )
    throw new Error('Invalid external watch inventory');
  const budgetClock = options.budgetClock ?? performance.now.bind(performance);
  const readDirectory =
    options.readDirectory ??
    ((path: string) => readdirSync(path, { encoding: 'utf8', withFileTypes: true }));
  const repository = createExternalWatchRepository({
    database: options.database,
    clock: options.clock,
  });
  const retryAt = () => {
    const value = options.clock() + 30_000;
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid external watch time');
    return value;
  };
  const block = (
    target: InventoryTarget,
    failureCode: 'root_unavailable' | 'root_replaced' | 'entry_unreadable',
    processed = 0,
  ) => {
    repository.failRootScan({
      libraryId: target.libraryId,
      accountDirectory: target.accountDirectory,
      failureCode,
      nextReconcileAt: retryAt(),
    });
    return { status: 'blocked' as const, processed, failureCode };
  };
  return {
    reconcile(target: InventoryTarget) {
      repository.ensureRoot({
        libraryId: target.libraryId,
        accountDirectory: target.accountDirectory,
        identityKey: target.identityKey,
      });
      let root;
      try {
        root = accountRoot(options.musicRoot, target);
      } catch {
        return block(target, 'root_unavailable');
      }
      let stored = repository.getRoot(target.libraryId, target.accountDirectory)!;
      const currentIdentity = externalWatchRootIdentity(root.stat);
      if (stored.failureCode === 'root_replaced') return block(target, 'root_replaced');
      if (
        stored.rootDevice !== null &&
        (stored.rootDevice !== currentIdentity.device || stored.rootInode !== currentIdentity.inode)
      )
        return block(target, 'root_replaced');
      if (!stored.continuation) {
        stored = repository.startRootScan({
          libraryId: target.libraryId,
          accountDirectory: target.accountDirectory,
          identityKey: target.identityKey,
          rootDevice: currentIdentity.device,
          rootInode: currentIdentity.inode,
          continuation: { version: 1, directories: [{ key: '', offset: 0 }] },
        });
      }
      const baseline = stored.scanCompletedAt === null;
      const continuation: ExternalWatchContinuation = {
        version: 1,
        directories: stored.continuation!.directories.map((directory) => ({ ...directory })),
      };
      const started = budgetClock();
      let processed = 0;
      while (continuation.directories.length > 0) {
        if (!visibleDirectoryMatches(root.path, root.stat))
          return block(target, 'root_replaced', processed);
        const current = continuation.directories[0]!;
        const path = current.key ? join(root.path, ...current.key.split('/')) : root.path;
        let entries: Dirent[];
        try {
          entries = directoryEntries(path, readDirectory).entries;
        } catch {
          repository.saveRootContinuation({
            libraryId: target.libraryId,
            accountDirectory: target.accountDirectory,
            continuation,
          });
          repository.failRootScan({
            libraryId: target.libraryId,
            accountDirectory: target.accountDirectory,
            failureCode: 'entry_unreadable',
            nextReconcileAt: retryAt(),
          });
          return {
            status: 'blocked' as const,
            processed,
            failureCode: 'entry_unreadable' as const,
          };
        }
        if (!visibleDirectoryMatches(root.path, root.stat))
          return block(target, 'root_replaced', processed);
        while (current.offset < entries.length) {
          if (
            processed >= maxEntries ||
            (processed > 0 && budgetClock() - started >= maxElapsedMs)
          ) {
            repository.saveRootContinuation({
              libraryId: target.libraryId,
              accountDirectory: target.accountDirectory,
              continuation,
            });
            return { status: 'progress' as const, processed };
          }
          const entry = entries[current.offset++]!;
          processed += 1;
          if (!closedDirectoryName(entry.name)) continue;
          const childKey = current.key ? posix.join(current.key, entry.name) : entry.name;
          const childPath = join(root.path, ...childKey.split('/'));
          let stat: BigIntStats | undefined;
          try {
            stat = lstatSync(childPath, { bigint: true, throwIfNoEntry: false });
          } catch {
            current.offset -= 1;
            repository.saveRootContinuation({
              libraryId: target.libraryId,
              accountDirectory: target.accountDirectory,
              continuation,
            });
            repository.failRootScan({
              libraryId: target.libraryId,
              accountDirectory: target.accountDirectory,
              failureCode: 'entry_unreadable',
              nextReconcileAt: retryAt(),
            });
            return {
              status: 'blocked' as const,
              processed,
              failureCode: 'entry_unreadable' as const,
            };
          }
          if (!stat || stat.isSymbolicLink()) continue;
          if (stat.isDirectory()) {
            continuation.directories.push({ key: childKey, offset: 0 });
            continue;
          }
          if (!stat.isFile() || posix.extname(entry.name).toLowerCase() !== '.mp3') continue;
          repository.discover({
            libraryId: target.libraryId,
            relativeFileKey: posix.join(target.relativeRoot, target.accountDirectory, childKey),
            accountDirectory: target.accountDirectory,
            identityKey: target.identityKey,
            baseline,
            seenAt: stored.scanStartedAt!,
            fingerprint: {
              device: stat.dev,
              inode: stat.ino,
              size: stat.size,
              mtimeNs: stat.mtimeNs,
              ctimeNs: stat.ctimeNs,
              linkCount: Number(stat.nlink),
            },
          });
        }
        continuation.directories.shift();
      }
      if (!visibleDirectoryMatches(root.path, root.stat))
        return block(target, 'root_replaced', processed);
      repository.completeRootScan({
        libraryId: target.libraryId,
        accountDirectory: target.accountDirectory,
        nextReconcileAt: retryAt(),
      });
      return { status: 'complete' as const, processed };
    },
  };
}
