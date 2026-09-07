import { validateRelativeKey } from '../imports/policy.js';

export interface MetadataLibrary {
  readonly id: string;
  readonly musicFolderId: string;
  readonly relativeRoot: string;
  readonly editors: readonly string[];
  readonly writeProfile: 'exclusive' | 'read_only';
  readonly preserveOwnership: boolean;
}
export interface MetadataPolicy {
  readonly enabled: boolean;
  readonly libraries: readonly MetadataLibrary[];
  readonly restoreManagers: readonly string[];
  readonly limits: {
    readonly maxTargets: number;
    readonly maxFileBytes: number;
    readonly timeoutMs: number;
  };
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
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
    value.length > 1000 ||
    new Set(value).size !== value.length ||
    value.some(
      (item) =>
        typeof item !== 'string' ||
        !item.length ||
        item.length > 256 ||
        item.trim() !== item ||
        /[\u0000-\u001f\u007f]/.test(item),
    )
  )
    throw new Error();
  return Object.freeze([...value] as string[]);
}
function limit(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max)
    throw new Error();
  return value;
}
export function parseMetadataPolicy(input: unknown): MetadataPolicy {
  try {
    const v = record(input, ['schemaVersion', 'enabled', 'libraries', 'restoreManagers', 'limits']);
    if (
      v.schemaVersion !== 1 ||
      typeof v.enabled !== 'boolean' ||
      !Array.isArray(v.libraries) ||
      v.libraries.length > 100
    )
      throw new Error();
    const libraries = v.libraries.map((item) => {
      const entry = record(item, [
        'id',
        'musicFolderId',
        'relativeRoot',
        'editors',
        'writeProfile',
        'preserveOwnership',
      ]);
      if (
        typeof entry.relativeRoot !== 'string' ||
        !['exclusive', 'read_only'].includes(String(entry.writeProfile)) ||
        typeof entry.preserveOwnership !== 'boolean'
      )
        throw new Error();
      return Object.freeze({
        id: identifier(entry.id),
        musicFolderId: identifier(entry.musicFolderId),
        relativeRoot: validateRelativeKey(entry.relativeRoot),
        editors: users(entry.editors),
        writeProfile: entry.writeProfile as MetadataLibrary['writeProfile'],
        preserveOwnership: entry.preserveOwnership,
      });
    });
    if (new Set(libraries.map((item) => item.id)).size !== libraries.length) throw new Error();
    const roots = libraries.map((item) => item.relativeRoot.normalize('NFC').toLowerCase());
    if (
      roots.some((root, i) =>
        roots.some((other, j) => i !== j && (root === other || root.startsWith(`${other}/`))),
      )
    )
      throw new Error();
    const limits = record(v.limits, ['maxTargets', 'maxFileBytes', 'timeoutMs']);
    return Object.freeze({
      enabled: v.enabled,
      libraries: Object.freeze(libraries),
      restoreManagers: users(v.restoreManagers),
      limits: Object.freeze({
        maxTargets: limit(limits.maxTargets, 100),
        maxFileBytes: limit(limits.maxFileBytes, 2 * 1024 * 1024 * 1024),
        timeoutMs: limit(limits.timeoutMs, 120000),
      }),
    });
  } catch {
    throw new Error('invalid_metadata_policy');
  }
}
export function canEditMetadata(
  policy: MetadataPolicy,
  username: string,
  libraryId: string,
): boolean {
  return (
    policy.enabled &&
    policy.libraries.some(
      (library) =>
        library.id === libraryId &&
        library.editors.includes(username) &&
        library.writeProfile === 'exclusive' &&
        library.preserveOwnership,
    )
  );
}
export function canRestoreMetadata(
  policy: MetadataPolicy,
  identity: { username: string; adminRole: boolean; musicFolderIds: readonly string[] },
  libraryId: string,
): boolean {
  return (
    policy.enabled &&
    identity.adminRole &&
    policy.restoreManagers.includes(identity.username) &&
    policy.libraries.some(
      (library) =>
        library.id === libraryId &&
        identity.musicFolderIds.includes(library.musicFolderId) &&
        library.writeProfile === 'exclusive' &&
        library.preserveOwnership,
    )
  );
}
