import {
  constants,
  lstatSync,
  realpathSync,
  mkdirSync,
  readdirSync,
  linkSync,
  renameSync,
  unlinkSync,
  openSync,
  closeSync,
  fsyncSync,
  fstatSync,
} from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateRelativeKey } from './policy.js';

export interface MediaMetadata {
  accountDirectory?: string;
  relativeRoot: string;
  channelName: string;
  channelId: string;
  title: string;
  videoId: string;
}
function fail(code = 'invalid_file_key'): never {
  throw new Error(code);
}
function isWithin(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}
function canonicalRoot(root: string): string {
  if (!isAbsolute(root)) fail();
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail();
  const canonical = realpathSync(root);
  if (canonical !== root || root === sep) fail();
  return canonical;
}
export function sanitizeMediaName(value: string): string {
  let result = value
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[/\\:|]+/g, ' - ')
    .replace(/"/g, "'")
    .replace(/[?*<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .trim();
  if (!result || /^[.\-\s]+$/.test(result)) result = 'untitled';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(result)) result += '_';
  let bounded = '';
  for (const char of result) {
    if (Buffer.byteLength(bounded + char) > 160) break;
    bounded += char;
  }
  return bounded.trim().replace(/[. ]+$/, '') || 'untitled';
}
export function buildMediaFileKey(
  metadata: MediaMetadata,
  existingChannels: readonly string[] = [],
): string {
  validateRelativeKey(metadata.relativeRoot);
  if (
    !/^[A-Za-z0-9_-]{1,64}$/.test(metadata.channelId) ||
    !/^[A-Za-z0-9_-]{11}$/.test(metadata.videoId)
  )
    fail();
  if (metadata.accountDirectory !== undefined) {
    if (validateRelativeKey(metadata.accountDirectory).includes('/')) fail();
    return validateRelativeKey(
      `${metadata.relativeRoot}/${metadata.accountDirectory}/${sanitizeMediaName(metadata.channelName)}/${sanitizeMediaName(metadata.title)}.mp3`,
    );
  }
  const suffix = ` [${metadata.channelId}]`;
  const matching = existingChannels.filter((name) => name.endsWith(suffix));
  if (matching.length > 1) fail('file_conflict');
  const channel = matching[0] ?? `${sanitizeMediaName(metadata.channelName)}${suffix}`;
  if (channel.includes('/')) fail();
  return validateRelativeKey(
    `${metadata.relativeRoot}/${channel}/${sanitizeMediaName(metadata.title)} [${metadata.videoId}].mp3`,
  );
}
/** Server-only absolute result. Reject every symlink component, including a missing-target symlink. */
export function resolveFileKey(root: string, key: string): string {
  try {
    validateRelativeKey(key);
    const canonical = canonicalRoot(root);
    let current = canonical;
    const parts = key.split('/');
    for (const [index, part] of parts.entries()) {
      current = join(current, part);
      const stat = lstatSync(current, { throwIfNoEntry: false });
      if (!stat) {
        if (index !== parts.length - 1) fail();
        break;
      }
      if (
        stat.isSymbolicLink() ||
        (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())
      )
        fail();
      if (!isWithin(canonical, realpathSync(current))) fail();
    }
    return current;
  } catch {
    fail();
  }
}
function directory(root: string, key: string, create: boolean): string {
  validateRelativeKey(key);
  const canonical = canonicalRoot(root);
  let current = canonical;
  for (const part of key.split('/')) {
    current = join(current, part);
    if (!lstatSync(current, { throwIfNoEntry: false }) && create) {
      try {
        mkdirSync(current, { mode: 0o750 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !isWithin(canonical, realpathSync(current)))
      fail();
  }
  return current;
}
export function prepareMediaFileKey(root: string, metadata: MediaMetadata): string {
  try {
    // Validate metadata before any mutation.
    buildMediaFileKey(metadata);
    const library = directory(root, metadata.relativeRoot, true);
    const key = buildMediaFileKey(metadata, readdirSync(library));
    directory(root, dirname(key), true);
    resolveFileKey(root, key);
    return key;
  } catch (error) {
    if (error instanceof Error && error.message === 'file_conflict') throw error;
    fail();
  }
}
/** Make an already verified publication durable again after a worker restart. */
export function syncMediaDirectory(root: string, fileKey: string): void {
  resolveFileKey(root, fileKey);
  const parent = directory(root, dirname(fileKey), false);
  const fd = openSync(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export interface PublishOptions {
  replaceExisting?: boolean;
  commit?: (publish: () => void) => void;
  musicRoot: string;
  stagingRoot: string;
  stagedFileKey: string;
  fileKey: string;
  videoId: string;
  /** Synchronous lease fence immediately before acquiring the final name. */
  beforeCommit?: () => void;
  /** UUID from the durable publish intent; permits cleanup of only this attempt's pending name. */
  pendingToken?: string;
  commitIdentity?: (identity: { dev: number; ino: number }) => void;
  checkpoint?: (stage: 'pending_synced' | 'linked' | 'directory_synced') => void;
  /** Worker-owned audio/source verifier; receives an opened regular file, never untrusted stdout paths. */
  inspectAudio: (file: FileHandle) => Promise<{ valid: boolean; sourceId: string }>;
}
async function verifiedFile(root: string, key: string): Promise<FileHandle> {
  const path = resolveFileKey(root, key);
  const before = lstatSync(path);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await file.stat();
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      resolveFileKey(root, key) !== path
    )
      fail();
    return file;
  } catch (error) {
    await file.close();
    throw error;
  }
}
async function isDuplicate(options: PublishOptions): Promise<'duplicate_candidate'> {
  let file: FileHandle | undefined;
  try {
    file = await verifiedFile(options.musicRoot, options.fileKey);
    const before = await file.stat();
    const result = await options.inspectAudio(file);
    const after = await file.stat();
    const current = lstatSync(resolveFileKey(options.musicRoot, options.fileKey));
    if (
      !result.valid ||
      result.sourceId !== options.videoId ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      current.ino !== after.ino ||
      current.dev !== after.dev
    )
      fail('file_conflict');
    return 'duplicate_candidate';
  } catch {
    return fail('file_conflict');
  } finally {
    await file?.close();
  }
}
/** Stage and verify bytes before an atomic rename (account imports) or legacy no-replace link. */
async function publish(options: PublishOptions): Promise<'published' | 'duplicate_candidate'> {
  let source: FileHandle | undefined;
  let pending: FileHandle | undefined;
  let pendingPath: string | undefined;
  let directoryFd: number | undefined;
  let published = false;
  try {
    const musicRoot = canonicalRoot(options.musicRoot);
    const stagingRoot = canonicalRoot(options.stagingRoot);
    if (isWithin(musicRoot, stagingRoot) || isWithin(stagingRoot, musicRoot)) fail();
    if (
      !/^[A-Za-z0-9_-]{11}$/.test(options.videoId) ||
      !(options.replaceExisting
        ? options.fileKey.endsWith('.mp3')
        : options.fileKey.endsWith(` [${options.videoId}].mp3`))
    )
      fail();
    const target = resolveFileKey(musicRoot, options.fileKey);
    const parent = directory(musicRoot, dirname(options.fileKey), false);
    directoryFd = openSync(
      parent,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const parentStat = fstatSync(directoryFd);
    const recheck = () => {
      if (
        canonicalRoot(options.musicRoot) !== musicRoot ||
        directory(musicRoot, dirname(options.fileKey), false) !== parent
      )
        fail();
      const now = lstatSync(parent);
      if (now.ino !== parentStat.ino || now.dev !== parentStat.dev) fail();
    };
    if (options.pendingToken !== undefined) {
      if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(options.pendingToken)) fail();
      const ownedPath = join(parent, `.import-${options.pendingToken}.pending`);
      const owned = lstatSync(ownedPath, { throwIfNoEntry: false });
      if (owned) {
        const final = lstatSync(target, { throwIfNoEntry: false });
        if (
          !owned.isFile() ||
          owned.isSymbolicLink() ||
          (owned.nlink !== 1 &&
            !(owned.nlink === 2 && final?.ino === owned.ino && final.dev === owned.dev))
        )
          fail('file_conflict');
        recheck();
        options.beforeCommit?.();
        unlinkSync(ownedPath);
        fsyncSync(directoryFd);
      }
    }
    if (!options.replaceExisting && lstatSync(target, { throwIfNoEntry: false }))
      return await isDuplicate(options);
    source = await verifiedFile(stagingRoot, options.stagedFileKey);
    const before = await source.stat();
    const media = await options.inspectAudio(source);
    if (!media.valid || media.sourceId !== options.videoId || before.size === 0)
      fail('invalid_media');
    recheck();
    pendingPath = join(parent, `.import-${options.pendingToken ?? randomUUID()}.pending`);
    pending = await open(
      pendingPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o640,
    );
    recheck();
    const buffer = Buffer.alloc(64 * 1024);
    let position = 0;
    while (position < before.size) {
      const { bytesRead } = await source.read(
        buffer,
        0,
        Math.min(buffer.length, before.size - position),
        position,
      );
      if (!bytesRead) fail('invalid_media');
      let offset = 0;
      while (offset < bytesRead) {
        const { bytesWritten } = await pending.write(
          buffer,
          offset,
          bytesRead - offset,
          position + offset,
        );
        if (!bytesWritten) fail('publish_failed');
        offset += bytesWritten;
      }
      position += bytesRead;
    }
    const after = await source.stat();
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      fail('invalid_media');
    await pending.sync();
    options.checkpoint?.('pending_synced');
    const pendingStat = await pending.stat();
    recheck();
    const visible = lstatSync(pendingPath);
    if (
      !visible.isFile() ||
      visible.isSymbolicLink() ||
      visible.ino !== pendingStat.ino ||
      visible.dev !== pendingStat.dev ||
      visible.nlink !== 1
    )
      fail();
    try {
      // Preserve legacy no-replace receipts; account imports atomically replace the final name.
      options.commitIdentity?.({ dev: pendingStat.dev, ino: pendingStat.ino });
      const readyPath = pendingPath;
      const commit = () => {
        options.beforeCommit?.();
        resolveFileKey(musicRoot, options.fileKey);
        if (options.replaceExisting) {
          renameSync(readyPath, target);
          pendingPath = undefined;
        } else linkSync(readyPath, target);
        published = true;
      };
      if (options.commit) options.commit(commit);
      else commit();
      options.checkpoint?.('linked');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return await isDuplicate(options);
      throw error;
    }
    fsyncSync(directoryFd);
    options.checkpoint?.('directory_synced');
    if (pendingPath) unlinkSync(pendingPath);
    pendingPath = undefined;
    fsyncSync(directoryFd);
    return 'published';
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (['invalid_file_key', 'invalid_media', 'file_conflict'].includes(code)) throw error;
    return fail(published ? 'publish_uncertain' : 'publish_failed');
  } finally {
    let cleanupFailed = false;
    if (pendingPath && pending) {
      // Clean only the inode we created, with its original parent still in place.
      try {
        const owned = await pending.stat();
        const stat = lstatSync(pendingPath, { throwIfNoEntry: false });
        const parent = lstatSync(dirname(pendingPath));
        const ownedParent = directoryFd === undefined ? undefined : fstatSync(directoryFd);
        if (
          stat &&
          stat.isFile() &&
          stat.ino === owned.ino &&
          stat.dev === owned.dev &&
          ownedParent?.ino === parent.ino &&
          ownedParent.dev === parent.dev
        )
          unlinkSync(pendingPath);
      } catch {
        cleanupFailed = true;
      }
    }
    for (const file of [pending, source]) {
      try {
        await file?.close();
      } catch {
        cleanupFailed = true;
      }
    }
    if (directoryFd !== undefined) {
      try {
        fsyncSync(directoryFd);
      } catch {
        cleanupFailed = true;
      }
      try {
        closeSync(directoryFd);
      } catch {
        cleanupFailed = true;
      }
    }
    if (cleanupFailed) fail(published ? 'publish_uncertain' : 'publish_failed');
  }
}

/** Public boundary errors contain codes only, including failures from cleanup. */
export async function publishMediaFile(
  options: PublishOptions,
): Promise<'published' | 'duplicate_candidate'> {
  try {
    return await publish(options);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    return fail(
      ['invalid_file_key', 'invalid_media', 'file_conflict', 'publish_uncertain'].includes(code)
        ? code
        : 'publish_failed',
    );
  }
}
