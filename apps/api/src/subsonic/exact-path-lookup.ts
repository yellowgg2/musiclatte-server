import { posix } from 'node:path';
import type { SubsonicClient } from './client.js';
import type { RegistrationDirectory } from './protocol.js';
import { validateRelativeKey } from '../imports/policy.js';
export type PathFailure = 'registration_path' | 'registration_pending' | 'registration_ambiguous';
export class ExactPathFailure extends Error {
  constructor(readonly code: PathFailure) {
    super(code);
  }
}
function normalizePath(path: string): string {
  if (
    !path ||
    posix.isAbsolute(path) ||
    /[\\:\x00-\x1f\x7f]/.test(path) ||
    path.split('/').includes('..')
  )
    throw new ExactPathFailure('registration_path');
  try {
    return validateRelativeKey(posix.normalize(path));
  } catch {
    throw new ExactPathFailure('registration_path');
  }
}
/** A fresh instance is one visibility round. Never cache missing paths across rounds. */
export function createExactPathLookup(
  client: Pick<SubsonicClient, 'indexes' | 'registrationDirectory'>,
  options: { signal: AbortSignal; assertOwned(): void },
) {
  const roots = new Map<string, Awaited<ReturnType<SubsonicClient['indexes']>>>();
  const directories = new Map<string, RegistrationDirectory>();
  async function directory(id: string) {
    options.assertOwned();
    let value = directories.get(id);
    if (!value) {
      value = await client.registrationDirectory(id, { signal: options.signal });
      if (value.id !== id) throw new ExactPathFailure('registration_path');
      directories.set(id, value);
    }
    return value;
  }
  return async (library: { relativeRoot: string; musicFolderId: string }, fileKey: string) => {
    options.assertOwned();
    if (!fileKey.startsWith(library.relativeRoot + '/'))
      throw new ExactPathFailure('registration_path');
    validateRelativeKey(fileKey);
    const parts = fileKey.split('/');
    let index = roots.get(library.musicFolderId);
    if (!index) {
      index = await client.indexes(library.musicFolderId, { signal: options.signal });
      roots.set(library.musicFolderId, index);
    }
    const matches = index.index
      .flatMap((group) => group.artist)
      .filter((artist) => artist.name === parts[0]);
    if (matches.length !== 1)
      throw new ExactPathFailure(
        matches.length ? 'registration_ambiguous' : 'registration_pending',
      );
    let branch = matches[0]!.id;
    for (const segment of parts.slice(1, -1)) {
      const children = (await directory(branch)).child.filter(
        (child) => child.isDir && child.name === segment,
      );
      if (children.length !== 1)
        throw new ExactPathFailure(
          children.length ? 'registration_ambiguous' : 'registration_pending',
        );
      branch = children[0]!.id;
    }
    const songs = (await directory(branch)).child.filter(
      (child) => !child.isDir && normalizePath(child.path) === fileKey,
    );
    if (songs.length !== 1)
      throw new ExactPathFailure(songs.length ? 'registration_ambiguous' : 'registration_pending');
    options.assertOwned();
    return songs[0]!.id;
  };
}
