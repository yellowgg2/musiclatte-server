import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, sep } from 'node:path';
import type { OrganizationRuntimePolicy } from '../automation/config.js';
import { sanitizeMediaName } from '../imports/file-keys.js';
import { validateExistingRelativeKey, validateRelativeKey } from '../imports/policy.js';

export type OrganizationPathErrorCode =
  | 'account_unmapped'
  | 'library_denied'
  | 'source_outside_account'
  | 'unsafe_source'
  | 'metadata_incomplete'
  | 'excessive_length'
  | 'destination_conflict'
  | 'unsafe_target';

export interface OrganizationPathInput {
  musicRoot: string;
  libraryId: string;
  ownerUsername: string;
  allowedLibraryIds: readonly string[];
  relativeRoot: string;
  sourceKey: string;
  accounts: OrganizationRuntimePolicy['accounts'];
  values: {
    readonly title: string | null;
    readonly artist: readonly string[];
    readonly album: string | null;
    readonly albumArtist: readonly string[];
    readonly trackNumber: string | null;
  };
}

export type OrganizationAccountScope =
  | { status: 'ready'; accountRoot: string }
  | { status: 'error'; code: 'account_unmapped' | 'source_outside_account' };

/** Resolves the source-owned account root and optionally guards a managed destination. */
export function resolveOrganizationAccountScope(
  input: Pick<
    OrganizationPathInput,
    'relativeRoot' | 'ownerUsername' | 'sourceKey' | 'accounts'
  > & { targetKey?: string },
): OrganizationAccountScope {
  if (!input.accounts.some((item) => item.username === input.ownerUsername))
    return { status: 'error', code: 'account_unmapped' };
  try {
    validateRelativeKey(input.relativeRoot);
    validateExistingRelativeKey(input.sourceKey);
    if (input.targetKey !== undefined) validateRelativeKey(input.targetKey);
  } catch {
    return { status: 'error', code: 'source_outside_account' };
  }
  const sourceAccount = input.accounts.find((item) =>
    [item.accountDirectory, ...(item.legacyDirectories ?? [])].some((directory) =>
      input.sourceKey.startsWith(`${input.relativeRoot}/${directory}/`),
    ),
  );
  if (!sourceAccount) return { status: 'error', code: 'source_outside_account' };
  const accountRoot = `${input.relativeRoot}/${sourceAccount.accountDirectory}`;
  if (input.targetKey !== undefined && !input.targetKey.startsWith(`${accountRoot}/ID3-managed/`))
    return { status: 'error', code: 'source_outside_account' };
  return { status: 'ready', accountRoot };
}

export type OrganizationPathPlan =
  | {
      status: 'ready' | 'no_op';
      policyVersion: 'id3-managed-v1';
      sourceKind: 'legacy' | 'managed';
      currentKey: string;
      targetKey: string;
    }
  | { status: 'error'; code: OrganizationPathErrorCode; currentKey: string };

function error(
  input: OrganizationPathInput,
  code: OrganizationPathErrorCode,
): OrganizationPathPlan {
  return { status: 'error', code, currentKey: input.sourceKey };
}

function equivalent(left: string, right: string): boolean {
  return left.normalize('NFC').toLowerCase() === right.normalize('NFC').toLowerCase();
}

function caseOnlyEquivalent(left: string, right: string): boolean {
  const normalizedLeft = left.normalize('NFC');
  const normalizedRight = right.normalize('NFC');
  return (
    left === normalizedLeft &&
    right === normalizedRight &&
    normalizedLeft !== normalizedRight &&
    normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
  );
}

export function selectExistingPathEntry(
  entries: readonly string[],
  part: string,
  finalKind: 'source' | 'target',
): { status: 'match'; entry: string } | { status: 'missing' | 'collision' } {
  const matches = entries.filter((entry) => equivalent(entry, part));
  if (!matches.length) return { status: 'missing' };
  const exact = matches.find((entry) => entry === part);
  if (finalKind === 'source' && exact) return { status: 'match', entry: exact };
  if (matches.length > 1 || !exact) return { status: 'collision' };
  return { status: 'match', entry: exact };
}

function safeMusicRoot(root: string): string | undefined {
  try {
    if (!isAbsolute(root)) return;
    const stat = lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    const canonical = realpathSync(root);
    if (canonical !== root || canonical === sep) return;
    return canonical;
  } catch {
    return;
  }
}

function inspectExistingKey(
  musicRoot: string,
  key: string,
  finalKind: 'source' | 'target',
): 'missing' | 'safe' | 'collision' | 'unsafe' {
  let current = musicRoot;
  const parts = key.split('/');
  for (const [index, part] of parts.entries()) {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return 'unsafe';
    }
    const selected = selectExistingPathEntry(entries, part, finalKind);
    if (selected.status !== 'match') return selected.status;
    current = join(current, selected.entry);
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) return 'unsafe';
      const final = index === parts.length - 1;
      if (final ? !stat.isFile() : !stat.isDirectory()) return 'unsafe';
      if (!realpathSync(current).startsWith(`${musicRoot}${sep}`)) return 'unsafe';
    } catch {
      return 'unsafe';
    }
  }
  return finalKind === 'source' ? 'safe' : 'collision';
}

function inspectTargetKey(
  musicRoot: string,
  key: string,
): { state: 'missing' | 'collision' | 'unsafe'; key: string } {
  let current = musicRoot;
  const parts = key.split('/');
  const resolved: string[] = [];
  for (const [index, part] of parts.entries()) {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return { state: 'unsafe', key: [...resolved, ...parts.slice(index)].join('/') };
    }
    const matches = entries.filter((entry) => equivalent(entry, part));
    if (!matches.length)
      return { state: 'missing', key: [...resolved, ...parts.slice(index)].join('/') };
    const exact = matches.find((entry) => entry === part);
    const final = index === parts.length - 1;
    if (final) {
      const entry = exact ?? matches[0]!;
      return { state: 'collision', key: [...resolved, entry].join('/') };
    }
    if (matches.length > 1 || (!exact && !caseOnlyEquivalent(matches[0]!, part)))
      return { state: 'collision', key: [...resolved, part, ...parts.slice(index + 1)].join('/') };
    const entry = exact ?? matches[0]!;
    current = join(current, entry);
    resolved.push(entry);
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        return { state: 'unsafe', key: [...resolved, ...parts.slice(index + 1)].join('/') };
      if (!realpathSync(current).startsWith(`${musicRoot}${sep}`))
        return { state: 'unsafe', key: [...resolved, ...parts.slice(index + 1)].join('/') };
    } catch {
      return { state: 'unsafe', key: [...resolved, ...parts.slice(index + 1)].join('/') };
    }
  }
  return { state: 'unsafe', key };
}

function first(values: readonly string[]): string | undefined {
  return values.find((value) => value.trim().length > 0)?.trim();
}

/** Computes and inspects an organization destination without creating or moving anything. */
export function planOrganizationPath(input: OrganizationPathInput): OrganizationPathPlan {
  if (!input.allowedLibraryIds.includes(input.libraryId)) return error(input, 'library_denied');
  const account = resolveOrganizationAccountScope(input);
  if (account.status === 'error') return error(input, account.code);
  const accountRoot = account.accountRoot;

  const musicRoot = safeMusicRoot(input.musicRoot);
  if (!musicRoot) return error(input, 'unsafe_source');
  const sourceState = inspectExistingKey(musicRoot, input.sourceKey, 'source');
  if (sourceState !== 'safe') return error(input, 'unsafe_source');

  const title = input.values.title?.trim();
  const album = input.values.album?.trim();
  const artistFolder = first(input.values.albumArtist) ?? first(input.values.artist);
  if (!title || !album || !artistFolder) return error(input, 'metadata_incomplete');
  if ([title, album, artistFolder].some((value) => Buffer.byteLength(value) > 4096))
    return error(input, 'excessive_length');

  const track = input.values.trackNumber?.match(/^([1-9]\d*)(?:\/[1-9]\d*)?$/)?.[1];
  const prefix = track ? `${String(Number(track)).padStart(2, '0')} - ` : '';
  const requestedTargetKey = `${accountRoot}/ID3-managed/${sanitizeMediaName(artistFolder)}/${sanitizeMediaName(album)}/${sanitizeMediaName(`${prefix}${title}`)}.mp3`;
  try {
    validateRelativeKey(requestedTargetKey);
  } catch {
    return error(input, 'excessive_length');
  }
  const sourceKind = input.sourceKey.startsWith(`${accountRoot}/ID3-managed/`)
    ? 'managed'
    : 'legacy';
  if (requestedTargetKey === input.sourceKey)
    return {
      status: 'no_op',
      policyVersion: 'id3-managed-v1',
      sourceKind,
      currentKey: input.sourceKey,
      targetKey: requestedTargetKey,
    };

  const target = inspectTargetKey(musicRoot, requestedTargetKey);
  if (target.state === 'collision' && target.key === input.sourceKey)
    return {
      status: 'no_op',
      policyVersion: 'id3-managed-v1',
      sourceKind,
      currentKey: input.sourceKey,
      targetKey: target.key,
    };
  if (target.state === 'collision') return error(input, 'destination_conflict');
  if (target.state === 'unsafe') return error(input, 'unsafe_target');
  return {
    status: 'ready',
    policyVersion: 'id3-managed-v1',
    sourceKind,
    currentKey: input.sourceKey,
    targetKey: target.key,
  };
}
