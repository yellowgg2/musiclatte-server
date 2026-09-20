import type { ImportPolicy } from './policy.js';
import { sanitizeMediaName } from './file-keys.js';
import { importIdentityKey, type ImportSigner } from './identity.js';

interface ExternalWatchProjectionInput {
  policy: ImportPolicy;
  instance: { id: string; policyRevision: number };
  sign: ImportSigner;
}

export function accountDirectoryForUsername(username: string): string {
  const directory = sanitizeMediaName(username);
  if (
    directory === '.' ||
    directory === '..' ||
    directory.includes('/') ||
    directory.includes('\\')
  )
    throw new Error('invalid_import_policy');
  return directory;
}

export function projectExternalWatchOwners(input: ExternalWatchProjectionInput) {
  if (!input.policy.enabled) return [];
  return input.policy.libraries
    .filter((library) => library.watchExternalMp3 === true)
    .flatMap((library) =>
      library.allowedUsers.map((username) => ({
        libraryId: library.id,
        accountDirectory: accountDirectoryForUsername(username),
        username,
        identityKey: importIdentityKey(input.sign, input.instance.id, username),
      })),
    );
}
