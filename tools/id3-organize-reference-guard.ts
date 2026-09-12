import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute } from 'node:path';

interface ReferencePlaylist {
  id: string;
  name: string;
  owner: string;
  revision: string;
  songIds: string[];
  appendOperationId: string;
  reorderOperationId: string;
  restoredTo: string | null;
}

export interface Id3ReferenceSnapshot {
  schemaVersion: 1;
  apiFingerprint: string;
  credentialFingerprint: string;
  trackId: string;
  starred: boolean;
  favoriteRestoredTo: string | null;
  playlists: ReferencePlaylist[];
}

const fail = (code: string): never => {
  throw new Error(`client_failed:${code}`);
};
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const value = (input: unknown, max = 4096): input is string =>
  typeof input === 'string' && input.length > 0 && input.length <= max && /\S/.test(input);
const nullable = (input: unknown): input is string | null => input === null || value(input);
const digest = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex');

function validateParent(path: string) {
  if (!isAbsolute(path)) fail('reference_private');
  try {
    const stat = lstatSync(dirname(path));
    if (
      stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      (stat.mode & 0o777) !== 0o700 ||
      stat.uid !== process.getuid?.()
    )
      fail('reference_private');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('client_failed:')) throw error;
    fail('reference_private');
  }
}

function validateFile(path: string) {
  validateParent(path);
  try {
    const stat = lstatSync(path);
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.uid !== process.getuid?.() ||
      stat.size < 2 ||
      stat.size > 4 * 1024 * 1024
    )
      fail('reference_private');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('client_failed:')) throw error;
    fail('reference_private');
  }
}

export function decodeId3ReferenceSnapshot(input: unknown): Id3ReferenceSnapshot {
  if (
    !object(input) ||
    !exact(input, [
      'schemaVersion',
      'apiFingerprint',
      'credentialFingerprint',
      'trackId',
      'starred',
      'favoriteRestoredTo',
      'playlists',
    ]) ||
    input.schemaVersion !== 1 ||
    typeof input.apiFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(input.apiFingerprint) ||
    typeof input.credentialFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(input.credentialFingerprint) ||
    !value(input.trackId, 2048) ||
    typeof input.starred !== 'boolean' ||
    !nullable(input.favoriteRestoredTo) ||
    !Array.isArray(input.playlists) ||
    input.playlists.length > 1000
  )
    fail('reference_invalid');
  const playlists = (input as { playlists: unknown[] }).playlists.map(
    (entry): ReferencePlaylist => {
      if (
        !object(entry) ||
        !exact(entry, [
          'id',
          'name',
          'owner',
          'revision',
          'songIds',
          'appendOperationId',
          'reorderOperationId',
          'restoredTo',
        ]) ||
        !value(entry.id, 2048) ||
        !value(entry.name, 255) ||
        !value(entry.owner, 2048) ||
        !value(entry.revision, 2048) ||
        !Array.isArray(entry.songIds) ||
        entry.songIds.length > 100000 ||
        entry.songIds.some((id) => !value(id, 2048)) ||
        !value(entry.appendOperationId, 128) ||
        !value(entry.reorderOperationId, 128) ||
        !nullable(entry.restoredTo)
      )
        fail('reference_invalid');
      return entry as unknown as ReferencePlaylist;
    },
  );
  if (new Set(playlists.map(({ id }: ReferencePlaylist) => id)).size !== playlists.length)
    fail('reference_invalid');
  return { ...(input as unknown as Id3ReferenceSnapshot), playlists };
}

function syncDirectory(path: string) {
  const descriptor = openSync(dirname(path), 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function atomicWrite(path: string, snapshot: Id3ReferenceSnapshot) {
  const temporary = path + '.tmp';
  let created = false;
  try {
    try {
      const stale = lstatSync(temporary);
      if (stale.isSymbolicLink() || !stale.isFile() || (stale.mode & 0o777) !== 0o600)
        fail('reference_private');
      unlinkSync(temporary);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('client_failed:')) throw error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') fail('reference_private');
    }
    const descriptor = openSync(temporary, 'wx', 0o600);
    created = true;
    try {
      writeFileSync(descriptor, JSON.stringify(snapshot) + '\n');
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, path);
    created = false;
    syncDirectory(path);
  } finally {
    if (created) {
      try {
        unlinkSync(temporary);
      } catch {
        // The previous valid state remains authoritative.
      }
    }
  }
}

export function createId3ReferenceSnapshot(input: {
  path: string;
  api: string;
  token: string;
  trackId: string;
  starred: boolean;
  playlists: Array<
    Pick<ReferencePlaylist, 'id' | 'name' | 'owner' | 'songIds'> & { revision?: string }
  >;
}) {
  validateParent(input.path);
  const snapshot: Id3ReferenceSnapshot = {
    schemaVersion: 1,
    apiFingerprint: digest(['api', input.api]),
    credentialFingerprint: digest(['credential', input.token]),
    trackId: input.trackId,
    starred: input.starred,
    favoriteRestoredTo: null,
    playlists: input.playlists.map((playlist) => ({
      ...playlist,
      revision:
        playlist.revision ||
        digest(['playlist', playlist.id, playlist.name, playlist.owner, playlist.songIds]),
      songIds: [...playlist.songIds],
      appendOperationId: randomUUID(),
      reorderOperationId: randomUUID(),
      restoredTo: null,
    })),
  };
  decodeId3ReferenceSnapshot(snapshot);
  try {
    const descriptor = openSync(input.path, 'wx', 0o600);
    try {
      writeFileSync(descriptor, JSON.stringify(snapshot) + '\n');
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    syncDirectory(input.path);
  } catch {
    fail('reference_exists');
  }
  return snapshot;
}

export function readId3ReferenceSnapshot(path: string) {
  validateFile(path);
  try {
    return decodeId3ReferenceSnapshot(JSON.parse(readFileSync(path, 'utf8')));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('client_failed:')) throw error;
    return fail('reference_invalid');
  }
}

export function verifyId3ReferenceContext(path: string, api: string, token: string) {
  const snapshot = readId3ReferenceSnapshot(path);
  if (
    snapshot.apiFingerprint !== digest(['api', api]) ||
    snapshot.credentialFingerprint !== digest(['credential', token])
  )
    fail('reference_context');
  return snapshot;
}

export function checkpointId3ReferenceRestore(
  path: string,
  checkpoint:
    | { kind: 'favorite'; newTrackId: string }
    | { kind: 'playlist'; playlistId: string; newTrackId: string },
) {
  const snapshot = readId3ReferenceSnapshot(path);
  if (!value(checkpoint.newTrackId, 2048)) fail('reference_invalid');
  if (checkpoint.kind === 'favorite') snapshot.favoriteRestoredTo = checkpoint.newTrackId;
  else {
    const playlist = snapshot.playlists.find(({ id }) => id === checkpoint.playlistId);
    if (!playlist) fail('reference_invalid');
    playlist!.restoredTo = checkpoint.newTrackId;
  }
  decodeId3ReferenceSnapshot(snapshot);
  atomicWrite(path, snapshot);
  return snapshot;
}

const same = <T>(left: readonly T[], right: readonly T[]) =>
  left.length === right.length && left.every((item, index) => item === right[index]);

function permutation(current: readonly string[], desired: readonly string[]) {
  const positions = new Map<string, number[]>();
  current.forEach((id, index) => positions.set(id, [...(positions.get(id) ?? []), index]));
  return desired.map((id) => {
    const candidates = positions.get(id);
    if (!candidates?.length) fail('reference_conflict');
    return candidates!.shift()!;
  });
}

export function planId3PlaylistReferenceRestore(
  baseline: readonly string[],
  current: readonly string[],
  oldTrackId: string,
  newTrackId: string,
) {
  const desired = baseline.map((id) => (id === oldTrackId ? newTrackId : id));
  if (same(current, desired)) return { append: [] as string[], order: null };
  const withoutOld = baseline.filter((id) => id !== oldTrackId);
  if (!same(current, withoutOld)) fail('reference_conflict');
  const append = baseline.filter((id) => id === oldTrackId).map(() => newTrackId);
  const afterAppend = [...current, ...append];
  const order = permutation(afterAppend, desired);
  return {
    append,
    order: same(
      order,
      order.map((_, index) => index),
    )
      ? null
      : order,
  };
}
