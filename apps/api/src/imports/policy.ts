import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export interface ImportLibrary {
  readonly id: string;
  readonly musicFolderId: string;
  readonly relativeRoot: string;
  readonly allowedUsers: readonly string[];
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

/** Reject aliases instead of normalizing untrusted keys; all stored keys are POSIX relative. */
export function validateRelativeKey(key: string): string {
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
          part !== part.trim() ||
          /[. ]$/.test(part) ||
          Buffer.byteLength(part) > 255,
      )
  )
    throw new Error('invalid_file_key');
  return key;
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
    if (value.schemaVersion !== 1 || !Array.isArray(value.libraries)) throw new Error();
    const libraries = value.libraries.map((item) => {
      const entry = record(item, ['id', 'musicFolderId', 'relativeRoot', 'allowedUsers']);
      if (typeof entry.relativeRoot !== 'string') throw new Error();
      return Object.freeze({
        id: identifier(entry.id),
        musicFolderId: identifier(entry.musicFolderId),
        relativeRoot: validateRelativeKey(entry.relativeRoot),
        allowedUsers: users(entry.allowedUsers),
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
