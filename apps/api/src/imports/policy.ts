import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { accountDirectoryForUsername } from './external-watch-config.js';

export interface ImportLibrary {
  readonly id: string;
  readonly musicFolderId: string;
  readonly relativeRoot: string;
  readonly allowedUsers: readonly string[];
  readonly watchExternalMp3?: boolean;
}
export interface ImportPolicy {
  readonly enabled: boolean;
  readonly libraries: readonly ImportLibrary[];
  readonly engineManagers: readonly string[];
}
const disabledPolicy: ImportPolicy = Object.freeze({
  enabled: false,
  libraries: Object.freeze([]),
  engineManagers: Object.freeze([]),
});

function validatePathKey(key: string, strictPortableNames: boolean): string {
  if (
    typeof key !== 'string' ||
    !key ||
    Buffer.byteLength(key) > 4096 ||
    /[\\:\u0000-\u001f\u007f]/.test(key) ||
    key
      .split('/')
      .some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          (strictPortableNames && (part !== part.trim() || /[. ]$/.test(part))) ||
          Buffer.byteLength(part) > 255,
      )
  )
    throw new Error('invalid_file_key');
  return key;
}

/** Reject aliases instead of normalizing untrusted keys; generated keys stay portable. */
export function validateRelativeKey(key: string): string {
  return validatePathKey(key, true);
}

/** Accept exact POSIX legacy names while retaining traversal, separator and size boundaries. */
export function validateExistingRelativeKey(key: string): string {
  return validatePathKey(key, false);
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(value, key))
  )
    throw new Error();
  return value as Record<string, unknown>;
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error();
  return value;
}
function users(value: unknown): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (user) =>
        typeof user !== 'string' ||
        !user ||
        user !== user.trim() ||
        user.length > 256 ||
        /[\u0000-\u001f\u007f]/.test(user),
    ) ||
    new Set(value).size !== value.length
  )
    throw new Error();
  return Object.freeze([...value] as string[]);
}
export function loadImportPolicy(path: string | undefined, enabled: boolean): ImportPolicy {
  if (!enabled) return disabledPolicy;
  try {
    if (!path || !isAbsolute(path)) throw new Error();
    const value = record(JSON.parse(readFileSync(path, 'utf8')), [
      'schemaVersion',
      'libraries',
      'engineManagers',
    ]);
    if (![1, 2].includes(value.schemaVersion as number) || !Array.isArray(value.libraries))
      throw new Error();
    const schemaVersion = value.schemaVersion as 1 | 2;
    const libraries = value.libraries.map((item) => {
      const entry = record(
        item,
        schemaVersion === 1
          ? ['id', 'musicFolderId', 'relativeRoot', 'allowedUsers']
          : ['id', 'musicFolderId', 'relativeRoot', 'allowedUsers', 'watchExternalMp3'],
      );
      if (typeof entry.relativeRoot !== 'string') throw new Error();
      if (schemaVersion === 2 && typeof entry.watchExternalMp3 !== 'boolean') throw new Error();
      const allowedUsers = users(entry.allowedUsers);
      const watchExternalMp3 = schemaVersion === 2 && entry.watchExternalMp3 === true;
      if (watchExternalMp3) {
        if (
          allowedUsers.length === 0 ||
          allowedUsers.some((username) => /^\.{1,2}$/.test(username))
        )
          throw new Error();
        const directories = allowedUsers.map((username) =>
          accountDirectoryForUsername(username).normalize('NFC').toLowerCase(),
        );
        if (new Set(directories).size !== directories.length) throw new Error();
      }
      return Object.freeze({
        id: identifier(entry.id),
        musicFolderId: identifier(entry.musicFolderId),
        relativeRoot: validateRelativeKey(entry.relativeRoot),
        allowedUsers,
        watchExternalMp3,
      });
    });
    if (new Set(libraries.map((library) => library.id)).size !== libraries.length)
      throw new Error();
    // Conservative even across folder IDs: distinct IDs may alias the same physical music mount.
    const roots = libraries.map((library) => library.relativeRoot.normalize('NFC').toLowerCase());
    if (
      roots.some((root, i) =>
        roots.some((other, j) => i !== j && (root === other || root.startsWith(`${other}/`))),
      )
    )
      throw new Error();
    return Object.freeze({
      enabled: true,
      libraries: Object.freeze(libraries),
      engineManagers: users(value.engineManagers),
    });
  } catch {
    throw new Error('invalid_import_policy');
  }
}
export function resolveLibrary(
  policy: ImportPolicy,
  username: string,
  libraryId: string,
): ImportLibrary {
  const library =
    policy.enabled &&
    policy.libraries.find(
      (entry) => entry.id === libraryId && entry.allowedUsers.includes(username),
    );
  if (!library) throw new Error('library_denied');
  return library;
}
