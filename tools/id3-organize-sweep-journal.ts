import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import type { UnorganizedSelectionPage, UnorganizedSelectionSummary } from '@musiclatte/contracts';
import {
  acquireId3OrganizationBatchLock,
  appendId3OrganizationSweepChildItems,
  createId3OrganizationSweepChildJournal,
  id3OrganizationBatchStatus,
  readId3OrganizationBatchJournal,
  terminalId3OrganizationBatchState,
  type Id3OrganizationBatchCrashPoint,
} from './id3-organize-batch-journal.js';

export const id3OrganizationSweepStates = [
  'capturing',
  'ready',
  'running',
  'blocked',
  'completed_with_summary',
] as const;
export type Id3OrganizationSweepState = (typeof id3OrganizationSweepStates)[number];

export interface Id3OrganizationSweepAggregate {
  total: number;
  succeeded: number;
  skipped: number;
  blocked: number;
  alreadyOrganized: number;
  deferredProcessing: number;
  deferredAttention: number;
  blockedIdentity: number;
  pending: number;
}

export interface Id3OrganizationSweepJournal {
  schemaVersion: 1;
  apiFingerprint: string;
  credentialFingerprint: string;
  selectionId: string;
  selectionRevision: string;
  capturedAt: number;
  expiresAt: number;
  summary: UnorganizedSelectionSummary;
  state: Id3OrganizationSweepState;
  blockCode: string | null;
  nextCursor: string | null;
  capturedItemCount: number;
  shards: Array<{ file: string; itemCount: number }>;
  aggregate: Id3OrganizationSweepAggregate;
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const opaque = (value: unknown, max = 2048): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max && /\S/.test(value);
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (code: string): never => {
  throw new Error(`client_failed:${code}`);
};
const aggregateKeys = [
  'total',
  'succeeded',
  'skipped',
  'blocked',
  'alreadyOrganized',
  'deferredProcessing',
  'deferredAttention',
  'blockedIdentity',
  'pending',
] as const;

function count(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
}

function decodeSummary(value: unknown): UnorganizedSelectionSummary {
  if (!object(value)) fail('sweep_invalid');
  const row = value as Record<string, unknown>;
  const keys = ['total', 'organized', 'needsOrganization', 'processing', 'attention', 'unknown'];
  if (!exact(row, keys) || keys.some((key) => !count(row[key]))) fail('sweep_invalid');
  if (
    Number(row.organized) +
      Number(row.needsOrganization) +
      Number(row.processing) +
      Number(row.attention) +
      Number(row.unknown) !==
    Number(row.total)
  )
    fail('sweep_invalid');
  return value as unknown as UnorganizedSelectionSummary;
}

function decodeAggregate(value: unknown): Id3OrganizationSweepAggregate {
  if (!object(value)) fail('sweep_invalid');
  const row = value as Record<string, unknown>;
  if (
    !exact(row, aggregateKeys) ||
    aggregateKeys.some((key) => !count(row[key])) ||
    Number(row.succeeded) +
      Number(row.skipped) +
      Number(row.blocked) +
      Number(row.alreadyOrganized) +
      Number(row.deferredProcessing) +
      Number(row.deferredAttention) +
      Number(row.blockedIdentity) +
      Number(row.pending) !==
      Number(row.total)
  )
    fail('sweep_invalid');
  return value as unknown as Id3OrganizationSweepAggregate;
}

function validShardFile(value: unknown): value is string {
  return (
    opaque(value, 255) &&
    value === basename(value) &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/') &&
    !value.includes('\\')
  );
}

export function decodeId3OrganizationSweepJournal(value: unknown): Id3OrganizationSweepJournal {
  if (!object(value)) fail('sweep_invalid');
  const row = value as Record<string, unknown>;
  if (
    !exact(row, [
      'schemaVersion',
      'apiFingerprint',
      'credentialFingerprint',
      'selectionId',
      'selectionRevision',
      'capturedAt',
      'expiresAt',
      'summary',
      'state',
      'blockCode',
      'nextCursor',
      'capturedItemCount',
      'shards',
      'aggregate',
    ]) ||
    row.schemaVersion !== 1 ||
    typeof row.apiFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(row.apiFingerprint) ||
    typeof row.credentialFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(row.credentialFingerprint) ||
    !opaque(row.selectionId) ||
    typeof row.selectionRevision !== 'string' ||
    !/^[a-f0-9]{64}$/.test(row.selectionRevision) ||
    !count(row.capturedAt) ||
    !count(row.expiresAt) ||
    Number(row.expiresAt) <= Number(row.capturedAt) ||
    !id3OrganizationSweepStates.includes(row.state as never) ||
    !(row.blockCode === null || opaque(row.blockCode)) ||
    (row.state === 'blocked') !== (row.blockCode !== null) ||
    !(row.nextCursor === null || opaque(row.nextCursor)) ||
    !count(row.capturedItemCount) ||
    !Array.isArray(row.shards) ||
    row.shards.length > 100000
  )
    fail('sweep_invalid');
  const summary = decodeSummary(row.summary);
  const aggregate = decodeAggregate(row.aggregate);
  const shards = (row.shards as unknown[]).map((entry: unknown) => {
    const shard = entry as Record<string, unknown>;
    if (
      !object(entry) ||
      !exact(shard, ['file', 'itemCount']) ||
      !validShardFile(shard.file) ||
      !count(shard.itemCount, 1000) ||
      Number(shard.itemCount) < 1
    )
      fail('sweep_invalid');
    return { file: shard.file as string, itemCount: Number(shard.itemCount) };
  });
  if (
    new Set(shards.map(({ file }) => file)).size !== shards.length ||
    shards.reduce((total, shard) => total + shard.itemCount, 0) !== Number(row.capturedItemCount) ||
    aggregate.total !== Number(row.capturedItemCount) ||
    Number(row.capturedItemCount) > summary.needsOrganization ||
    (['ready', 'running', 'completed_with_summary'].includes(String(row.state)) &&
      (row.nextCursor !== null || Number(row.capturedItemCount) !== summary.needsOrganization)) ||
    (row.state === 'completed_with_summary' && aggregate.pending !== 0)
  )
    fail('sweep_invalid');
  return {
    schemaVersion: 1,
    apiFingerprint: row.apiFingerprint as string,
    credentialFingerprint: row.credentialFingerprint as string,
    selectionId: row.selectionId as string,
    selectionRevision: row.selectionRevision as string,
    capturedAt: Number(row.capturedAt),
    expiresAt: Number(row.expiresAt),
    summary,
    state: row.state as Id3OrganizationSweepState,
    blockCode: row.blockCode as string | null,
    nextCursor: row.nextCursor as string | null,
    capturedItemCount: Number(row.capturedItemCount),
    shards,
    aggregate,
  };
}

function validateParent(path: string) {
  if (!isAbsolute(path)) fail('sweep_private');
  try {
    const stat = lstatSync(dirname(path));
    if (
      stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      (stat.mode & 0o777) !== 0o700 ||
      stat.uid !== process.getuid?.()
    )
      fail('sweep_private');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('client_failed:')) throw error;
    fail('sweep_private');
  }
}

function validateFile(path: string) {
  validateParent(path);
  try {
    const stat = lstatSync(path);
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      stat.nlink !== 1 ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.uid !== process.getuid?.() ||
      stat.size < 2 ||
      stat.size > 2 * 1024 * 1024
    )
      fail('sweep_private');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('client_failed:')) throw error;
    fail('sweep_private');
  }
}

function syncDirectory(path: string) {
  const fd = openSync(dirname(path), 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function atomicWrite(
  path: string,
  journal: Id3OrganizationSweepJournal,
  crashAt?: Id3OrganizationBatchCrashPoint,
) {
  const temporary = path + '.tmp';
  const injected = (point: Id3OrganizationBatchCrashPoint) => {
    if (crashAt === point) fail(`injected_${point}`);
  };
  let created = false;
  try {
    injected('before_write');
    try {
      const stale = lstatSync(temporary);
      if (
        stale.isSymbolicLink() ||
        !stale.isFile() ||
        stale.nlink !== 1 ||
        (stale.mode & 0o777) !== 0o600 ||
        stale.uid !== process.getuid?.()
      )
        fail('sweep_private');
      unlinkSync(temporary);
      syncDirectory(path);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('client_failed:')) throw error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') fail('sweep_private');
    }
    const fd = openSync(temporary, 'wx', 0o600);
    created = true;
    try {
      writeFileSync(fd, JSON.stringify(journal) + '\n');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    injected('after_temp_fsync');
    renameSync(temporary, path);
    created = false;
    injected('after_rename');
    syncDirectory(path);
  } finally {
    if (created) {
      try {
        unlinkSync(temporary);
      } catch {
        // The previous valid file remains authoritative.
      }
    }
  }
}

function emptyAggregate(total: number): Id3OrganizationSweepAggregate {
  return {
    total,
    succeeded: 0,
    skipped: 0,
    blocked: 0,
    alreadyOrganized: 0,
    deferredProcessing: 0,
    deferredAttention: 0,
    blockedIdentity: 0,
    pending: total,
  };
}

export function createId3OrganizationSweepJournal(input: {
  path: string;
  api: string;
  token: string;
  page: UnorganizedSelectionPage;
}) {
  validateParent(input.path);
  try {
    lstatSync(input.path);
    fail('sweep_exists');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('client_failed:')) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') fail('sweep_private');
  }
  const initialCount = input.page.items.length;
  const files = initialCount
    ? [
        {
          file: shardFile(input.path, input.page.selectionId, 0),
          itemCount: initialCount,
        },
      ]
    : [];
  if (initialCount)
    createId3OrganizationSweepChildJournal({
      path: join(dirname(input.path), files[0]!.file),
      api: input.api,
      token: input.token,
      selectionId: input.page.selectionId,
      selectionRevision: input.page.inventoryRevision,
      items: input.page.items.map((item, ordinal) => ({ ordinal, item })),
    });
  const complete = input.page.nextCursor === null;
  const countsMatch = initialCount === input.page.summary.needsOrganization;
  const journal: Id3OrganizationSweepJournal = {
    schemaVersion: 1,
    apiFingerprint: digest(['api', input.api]),
    credentialFingerprint: digest(['credential', input.token]),
    selectionId: input.page.selectionId,
    selectionRevision: input.page.inventoryRevision,
    capturedAt: input.page.capturedAt,
    expiresAt: input.page.expiresAt,
    summary: input.page.summary,
    state: complete ? (countsMatch ? 'ready' : 'blocked') : 'capturing',
    blockCode: complete && !countsMatch ? 'selection_count_mismatch' : null,
    nextCursor: input.page.nextCursor,
    capturedItemCount: initialCount,
    shards: files,
    aggregate: emptyAggregate(initialCount),
  };
  decodeId3OrganizationSweepJournal(journal);
  try {
    const fd = openSync(input.path, 'wx', 0o600);
    try {
      writeFileSync(fd, JSON.stringify(journal) + '\n');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    syncDirectory(input.path);
  } catch {
    fail('sweep_exists');
  }
  return journal;
}

export function readId3OrganizationSweepJournal(path: string) {
  validateFile(path);
  try {
    return decodeId3OrganizationSweepJournal(JSON.parse(readFileSync(path, 'utf8')));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('client_failed:')) throw error;
    return fail('sweep_invalid');
  }
}

function updateSweep(
  path: string,
  update: (journal: Id3OrganizationSweepJournal) => void,
  crashAt?: Id3OrganizationBatchCrashPoint,
) {
  const release = acquireId3OrganizationBatchLock(path);
  try {
    const journal = readId3OrganizationSweepJournal(path);
    update(journal);
    decodeId3OrganizationSweepJournal(journal);
    atomicWrite(path, journal, crashAt);
    return journal;
  } finally {
    release();
  }
}

export function verifyId3OrganizationSweepContext(path: string, api: string, token: string) {
  const journal = readId3OrganizationSweepJournal(path);
  if (
    journal.apiFingerprint !== digest(['api', api]) ||
    journal.credentialFingerprint !== digest(['credential', token])
  )
    fail('sweep_binding');
  return journal;
}

function shardFile(path: string, selectionId: string, index: number) {
  return `${basename(path)}.${digest(['selection', selectionId]).slice(0, 16)}.shard-${String(index + 1).padStart(6, '0')}.json`;
}

export function appendId3OrganizationSweepPage(
  path: string,
  api: string,
  token: string,
  page: UnorganizedSelectionPage,
  options: {
    parentCrashAt?: Id3OrganizationBatchCrashPoint;
    childCrashAt?: Id3OrganizationBatchCrashPoint;
  } = {},
) {
  const journal = verifyId3OrganizationSweepContext(path, api, token);
  if (journal.state !== 'capturing') fail('sweep_transition');
  if (
    page.selectionId !== journal.selectionId ||
    page.inventoryRevision !== journal.selectionRevision ||
    page.capturedAt !== journal.capturedAt ||
    page.expiresAt !== journal.expiresAt ||
    JSON.stringify(page.summary) !== JSON.stringify(journal.summary)
  )
    fail('sweep_binding');
  let offset = 0;
  while (offset < page.items.length) {
    const ordinal = journal.capturedItemCount + offset;
    const shardIndex = Math.floor(ordinal / 1000);
    const capacity = 1000 - (ordinal % 1000);
    const part = page.items.slice(offset, offset + capacity).map((item, index) => ({
      ordinal: ordinal + index,
      item,
    }));
    const file = shardFile(path, journal.selectionId, shardIndex);
    const childPath = join(dirname(path), file);
    if (journal.shards[shardIndex] || existsSync(childPath)) {
      if (journal.shards[shardIndex] && journal.shards[shardIndex]!.file !== file)
        fail('sweep_binding');
      appendId3OrganizationSweepChildItems(childPath, part, {
        ...(options.childCrashAt ? { crashAt: options.childCrashAt } : {}),
      });
    } else {
      createId3OrganizationSweepChildJournal({
        path: childPath,
        api,
        token,
        selectionId: journal.selectionId,
        selectionRevision: journal.selectionRevision,
        items: part,
      });
    }
    offset += part.length;
  }
  return updateSweep(
    path,
    (current) => {
      const newCount = current.capturedItemCount + page.items.length;
      if (newCount > current.summary.needsOrganization) {
        current.state = 'blocked';
        current.blockCode = 'selection_count_mismatch';
        current.nextCursor = null;
        return;
      }
      current.capturedItemCount = newCount;
      current.nextCursor = page.nextCursor;
      current.shards = Array.from({ length: Math.ceil(newCount / 1000) }, (_, index) => ({
        file: shardFile(path, current.selectionId, index),
        itemCount: Math.min(1000, newCount - index * 1000),
      }));
      current.aggregate = emptyAggregate(newCount);
      if (page.nextCursor === null) {
        if (newCount === current.summary.needsOrganization) current.state = 'ready';
        else {
          current.state = 'blocked';
          current.blockCode = 'selection_count_mismatch';
        }
      }
    },
    options.parentCrashAt,
  );
}

export function blockId3OrganizationSweep(path: string, code: string) {
  if (!opaque(code)) fail('sweep_invalid');
  return updateSweep(path, (journal) => {
    if (journal.state !== 'capturing') fail('sweep_transition');
    journal.state = 'blocked';
    journal.blockCode = code;
    journal.nextCursor = null;
  });
}

function calculateAggregate(path: string, journal: Id3OrganizationSweepJournal) {
  const aggregate = emptyAggregate(0);
  for (const shard of journal.shards) {
    const child = readId3OrganizationBatchJournal(join(dirname(path), shard.file));
    if (
      child.schemaVersion !== 3 ||
      child.source.kind !== 'unorganized' ||
      child.source.selectionId !== journal.selectionId ||
      child.selectionRevision !== journal.selectionRevision ||
      child.apiFingerprint !== journal.apiFingerprint ||
      child.credentialFingerprint !== journal.credentialFingerprint ||
      child.items.length !== shard.itemCount
    )
      fail('sweep_binding');
    const status = id3OrganizationBatchStatus(join(dirname(path), shard.file));
    aggregate.total += status.total;
    aggregate.succeeded += status.succeeded;
    aggregate.skipped += status.skipped;
    aggregate.blocked += status.blocked;
    aggregate.alreadyOrganized += status.alreadyOrganized;
    aggregate.deferredProcessing += status.deferredProcessing;
    aggregate.deferredAttention += status.deferredAttention;
    aggregate.blockedIdentity += status.blockedIdentity;
    aggregate.pending += status.pending;
  }
  return aggregate;
}

export function refreshId3OrganizationSweep(path: string) {
  const current = readId3OrganizationSweepJournal(path);
  if (current.state === 'capturing' || current.state === 'blocked') return current;
  const aggregate = calculateAggregate(path, current);
  return updateSweep(path, (journal) => {
    journal.aggregate = aggregate;
    if (aggregate.pending === 0) journal.state = 'completed_with_summary';
  });
}

export function nextId3OrganizationSweepItem(path: string) {
  const journal = refreshId3OrganizationSweep(path);
  if (journal.state === 'capturing') fail('sweep_capture_incomplete');
  if (journal.state === 'blocked') fail(journal.blockCode ?? 'sweep_blocked');
  if (journal.state === 'completed_with_summary') return null;
  for (let shardIndex = 0; shardIndex < journal.shards.length; shardIndex++) {
    const shard = journal.shards[shardIndex]!;
    const child = readId3OrganizationBatchJournal(join(dirname(path), shard.file));
    const itemIndex = child.items.findIndex(
      (item) => !terminalId3OrganizationBatchState(item.state),
    );
    if (itemIndex < 0) continue;
    const item = child.items[itemIndex]!;
    if (!item.mediaLinkId) fail('sweep_binding');
    if (journal.state === 'ready')
      updateSweep(path, (current) => {
        if (current.state !== 'ready') fail('sweep_transition');
        current.state = 'running';
      });
    return {
      shardIndex,
      itemIndex,
      childFile: shard.file,
      mediaLinkId: item.mediaLinkId,
      trackId: item.trackId,
      state: item.state,
      hasRecordedJob:
        Object.values(item.metadataSteps).some(({ jobId }) => jobId !== null) ||
        item.organizationJobId !== null,
    };
  }
  fail('sweep_binding');
}

export function id3OrganizationSweepStatus(path: string) {
  const journal = refreshId3OrganizationSweep(path);
  const current =
    ['ready', 'running'].includes(journal.state) && journal.aggregate.pending > 0
      ? nextId3OrganizationSweepItemWithoutRefresh(path, journal)
      : null;
  return {
    schemaVersion: 1 as const,
    state: journal.state,
    blockCode: journal.blockCode,
    capturedItemCount: journal.capturedItemCount,
    expectedItemCount: journal.summary.needsOrganization,
    shardCount: journal.shards.length,
    aggregate: journal.aggregate,
    current: current
      ? { shardIndex: current.shardIndex, itemIndex: current.itemIndex, state: current.state }
      : null,
  };
}

function nextId3OrganizationSweepItemWithoutRefresh(
  path: string,
  journal: Id3OrganizationSweepJournal,
) {
  for (let shardIndex = 0; shardIndex < journal.shards.length; shardIndex++) {
    const child = readId3OrganizationBatchJournal(
      join(dirname(path), journal.shards[shardIndex]!.file),
    );
    const itemIndex = child.items.findIndex(
      (item) => !terminalId3OrganizationBatchState(item.state),
    );
    if (itemIndex >= 0) {
      const item = child.items[itemIndex]!;
      return { shardIndex, itemIndex, state: item.state };
    }
  }
  return null;
}
