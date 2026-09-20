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
import type {
  OrganizationSelection,
  OrganizationSelectionSource,
  UnorganizedSelectionItem,
} from '@musiclatte/contracts';

export const id3OrganizationBatchItemStates = [
  'pending',
  'researching',
  'metadata_accepted',
  'organization_accepted',
  'succeeded',
  'skipped',
  'blocked',
  'already_organized',
  'deferred_processing',
  'deferred_attention',
  'blocked_identity',
] as const;
export type Id3OrganizationBatchItemState = (typeof id3OrganizationBatchItemStates)[number];
export type Id3OrganizationMetadataStepKind = 'required' | 'optional';

export const id3OrganizationBatchSkipReasons = [
  'ambiguous_release',
  'official_evidence_missing',
  'unsupported_format',
  'metadata_incomplete',
  'destination_conflict',
] as const;
export type Id3OrganizationBatchSkipReason = (typeof id3OrganizationBatchSkipReasons)[number];

export const id3OrganizationBatchSystemFailures = [
  'unauthenticated',
  'forbidden',
  'upstream_unavailable',
  'policy_changed',
  'scope_changed',
] as const;

export interface Id3OrganizationMetadataStep {
  operationId: string;
  jobId: string | null;
  resultRevision: string | null;
  serverStage: string | null;
}

export interface Id3OrganizationBatchItem {
  mediaLinkId?: string;
  trackId: string;
  title: string;
  artist: string | null;
  album: string | null;
  occurrenceIndexes: number[];
  state: Id3OrganizationBatchItemState;
  errorCode: string | null;
  operations: { cover: string; organization: string };
  coverUploadId: string | null;
  metadataSteps: Record<Id3OrganizationMetadataStepKind, Id3OrganizationMetadataStep>;
  organizationJobId: string | null;
  newTrackId: string | null;
  serverStage: string | null;
}

export interface Id3OrganizationBatchJournal {
  schemaVersion: 2 | 3;
  apiFingerprint: string;
  credentialFingerprint: string;
  selectionRevision: string;
  source: OrganizationSelectionSource | { kind: 'unorganized'; selectionId: string };
  stopped: boolean;
  stopCode: string | null;
  items: Id3OrganizationBatchItem[];
}

type CrashPoint = 'before_write' | 'after_temp_fsync' | 'after_rename';

export type Id3OrganizationBatchCrashPoint = CrashPoint;

function failure(code: string): never {
  throw new Error(`client_failed:${code}`);
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const nonempty = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 4096 && /\S/.test(value);
const opaque = (value: unknown): value is string => nonempty(value) && value.length <= 2048;
const nullableOpaque = (value: unknown): value is string | null => value === null || opaque(value);

function decodeSource(value: unknown): OrganizationSelectionSource {
  if (!object(value)) failure('journal_invalid');
  if (value.kind === 'favorites') {
    if (!exact(value, ['kind'])) failure('journal_invalid');
    return { kind: 'favorites' };
  }
  if (
    value.kind !== 'playlist' ||
    !exact(value, ['kind', 'playlistId', 'name']) ||
    !opaque(value.playlistId) ||
    !nonempty(value.name)
  )
    failure('journal_invalid');
  return { kind: 'playlist', playlistId: value.playlistId, name: value.name };
}

function decodeUnorganizedSource(value: unknown) {
  if (
    !object(value) ||
    !exact(value, ['kind', 'selectionId']) ||
    value.kind !== 'unorganized' ||
    !opaque(value.selectionId)
  )
    failure('journal_invalid');
  return { kind: 'unorganized' as const, selectionId: value.selectionId };
}

function decodeMetadataStep(value: unknown): Id3OrganizationMetadataStep {
  if (
    !object(value) ||
    !exact(value, ['operationId', 'jobId', 'resultRevision', 'serverStage']) ||
    !opaque(value.operationId) ||
    !nullableOpaque(value.jobId) ||
    !nullableOpaque(value.resultRevision) ||
    !nullableOpaque(value.serverStage) ||
    (value.jobId === null && (value.resultRevision !== null || value.serverStage !== null)) ||
    (value.jobId !== null && value.serverStage === null)
  )
    failure('journal_invalid');
  return value as unknown as Id3OrganizationMetadataStep;
}

const metadataCanOrganize = (step: Id3OrganizationMetadataStep) =>
  step.resultRevision !== null && ['succeeded', 'reflecting'].includes(step.serverStage ?? '');

function decodeItemV2(value: unknown): Id3OrganizationBatchItem {
  if (
    !object(value) ||
    !exact(value, [
      'trackId',
      'title',
      'artist',
      'album',
      'occurrenceIndexes',
      'state',
      'errorCode',
      'operations',
      'coverUploadId',
      'metadataSteps',
      'organizationJobId',
      'newTrackId',
      'serverStage',
    ]) ||
    !opaque(value.trackId) ||
    !nonempty(value.title) ||
    !(value.artist === null || nonempty(value.artist)) ||
    !(value.album === null || nonempty(value.album)) ||
    !Array.isArray(value.occurrenceIndexes) ||
    !value.occurrenceIndexes.length ||
    value.occurrenceIndexes.length > 1000 ||
    value.occurrenceIndexes.some(
      (index, position) =>
        !Number.isSafeInteger(index) ||
        Number(index) < 0 ||
        (position > 0 &&
          Number(index) <= Number((value.occurrenceIndexes as unknown[])[position - 1])),
    ) ||
    ![
      'pending',
      'researching',
      'metadata_accepted',
      'organization_accepted',
      'succeeded',
      'skipped',
      'blocked',
    ].includes(value.state as string) ||
    !(value.errorCode === null || nonempty(value.errorCode)) ||
    !object(value.operations) ||
    !exact(value.operations, ['cover', 'organization']) ||
    !opaque(value.operations.cover) ||
    !opaque(value.operations.organization) ||
    !nullableOpaque(value.coverUploadId) ||
    !object(value.metadataSteps) ||
    !exact(value.metadataSteps, ['required', 'optional']) ||
    !nullableOpaque(value.organizationJobId) ||
    !nullableOpaque(value.newTrackId) ||
    !nullableOpaque(value.serverStage)
  )
    failure('journal_invalid');
  const required = decodeMetadataStep(value.metadataSteps.required);
  const optional = decodeMetadataStep(value.metadataSteps.optional);
  const state = value.state as Id3OrganizationBatchItemState;
  const hasMetadata = required.jobId !== null || optional.jobId !== null;
  const finalMetadata = optional.jobId !== null ? optional : required;
  if (
    (['pending', 'researching', 'skipped'].includes(state) &&
      (hasMetadata || value.organizationJobId !== null)) ||
    (['metadata_accepted', 'organization_accepted'].includes(state) && !hasMetadata) ||
    (state === 'succeeded' &&
      !hasMetadata &&
      (value.organizationJobId !== null || value.newTrackId === null)) ||
    (state === 'succeeded' && hasMetadata && value.organizationJobId === null) ||
    (state === 'organization_accepted' && value.organizationJobId === null) ||
    (optional.jobId !== null &&
      required.jobId !== null &&
      (required.serverStage !== 'succeeded' || required.resultRevision === null)) ||
    (state === 'organization_accepted' && !metadataCanOrganize(finalMetadata)) ||
    (state === 'succeeded' && value.serverStage !== 'succeeded') ||
    (['skipped', 'blocked'].includes(state) && value.errorCode === null) ||
    (!['skipped', 'blocked'].includes(state) && value.errorCode !== null)
  )
    failure('journal_invalid');
  return value as unknown as Id3OrganizationBatchItem;
}

function decodeItemV3(value: unknown): Id3OrganizationBatchItem {
  if (
    !object(value) ||
    !exact(value, [
      'mediaLinkId',
      'trackId',
      'title',
      'artist',
      'album',
      'occurrenceIndexes',
      'state',
      'errorCode',
      'operations',
      'coverUploadId',
      'metadataSteps',
      'organizationJobId',
      'newTrackId',
      'serverStage',
    ])
  )
    failure('journal_invalid');
  if (!opaque(value.mediaLinkId)) failure('journal_invalid');
  const legacyShape = { ...value };
  delete legacyShape.mediaLinkId;
  const terminalOutcome = {
    already_organized: 'already_organized',
    deferred_processing: 'deferred_processing',
    deferred_attention: 'deferred_attention',
    blocked_identity: 'blocked_identity',
  } as const;
  const state = value.state as Id3OrganizationBatchItemState;
  const outcome = state in terminalOutcome;
  const hasMetadataCheckpoint =
    object(value.metadataSteps) &&
    Object.values(value.metadataSteps as Record<string, unknown>).some(
      (step) => object(step) && step.jobId !== null,
    );
  const reconciledDeletedDuplicate =
    state === 'already_organized' && value.newTrackId !== null && hasMetadataCheckpoint;
  const skippedDestinationConflict =
    state === 'skipped' && value.errorCode === 'destination_conflict' && hasMetadataCheckpoint;
  const item = decodeItemV2(
    outcome || skippedDestinationConflict
      ? {
          ...legacyShape,
          state:
            reconciledDeletedDuplicate || skippedDestinationConflict
              ? 'metadata_accepted'
              : 'pending',
          errorCode: null,
        }
      : legacyShape,
  );
  if (outcome || skippedDestinationConflict) {
    const expectedError = skippedDestinationConflict
      ? 'destination_conflict'
      : terminalOutcome[state as keyof typeof terminalOutcome];
    if (value.errorCode !== expectedError) failure('journal_invalid');
    if (reconciledDeletedDuplicate) {
      const finalMetadata =
        item.metadataSteps.optional.jobId !== null
          ? item.metadataSteps.optional
          : item.metadataSteps.required;
      if (
        item.organizationJobId !== null ||
        item.newTrackId === item.trackId ||
        item.serverStage !== null ||
        !metadataCanOrganize(finalMetadata)
      )
        failure('journal_invalid');
    } else if (skippedDestinationConflict) {
      const finalMetadata =
        item.metadataSteps.optional.jobId !== null
          ? item.metadataSteps.optional
          : item.metadataSteps.required;
      if (
        item.organizationJobId !== null ||
        item.newTrackId !== null ||
        item.serverStage !== null ||
        !metadataCanOrganize(finalMetadata)
      )
        failure('journal_invalid');
    } else if (
      item.coverUploadId !== null ||
      Object.values(item.metadataSteps).some(({ jobId }) => jobId !== null) ||
      item.organizationJobId !== null ||
      item.newTrackId !== null ||
      item.serverStage !== null
    ) {
      failure('journal_invalid');
    }
    item.state = state;
    item.errorCode = value.errorCode as string;
  }
  return { mediaLinkId: value.mediaLinkId, ...item };
}

function normalizeV1Item(value: unknown): Id3OrganizationBatchItem {
  if (
    !object(value) ||
    !exact(value, [
      'trackId',
      'title',
      'artist',
      'album',
      'occurrenceIndexes',
      'state',
      'errorCode',
      'operations',
      'coverUploadId',
      'metadataJobId',
      'resultRevision',
      'organizationJobId',
      'newTrackId',
      'serverStage',
    ]) ||
    !object(value.operations) ||
    !exact(value.operations, ['cover', 'metadata', 'organization']) ||
    !opaque(value.operations.cover) ||
    !opaque(value.operations.metadata) ||
    !opaque(value.operations.organization)
  )
    failure('journal_invalid');
  const normalized: Record<string, unknown> = {
    ...value,
    operations: { cover: value.operations.cover, organization: value.operations.organization },
    metadataSteps: {
      required: {
        operationId: `required-${fingerprint(['v1-metadata', value.operations.metadata])}`,
        jobId: null,
        resultRevision: null,
        serverStage: null,
      },
      optional: {
        operationId: value.operations.metadata,
        jobId: value.metadataJobId,
        resultRevision: value.resultRevision,
        serverStage:
          value.metadataJobId === null
            ? null
            : value.organizationJobId === null
              ? value.serverStage
              : 'succeeded',
      },
    },
  };
  delete normalized.metadataJobId;
  delete normalized.resultRevision;
  if (normalized.organizationJobId === null) normalized.serverStage = null;
  return decodeItemV2(normalized);
}

export function decodeId3OrganizationBatchJournal(value: unknown): Id3OrganizationBatchJournal {
  if (
    !object(value) ||
    !exact(value, [
      'schemaVersion',
      'apiFingerprint',
      'credentialFingerprint',
      'selectionRevision',
      'source',
      'stopped',
      'stopCode',
      'items',
    ]) ||
    ![1, 2, 3].includes(value.schemaVersion as number) ||
    typeof value.apiFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.apiFingerprint) ||
    typeof value.credentialFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.credentialFingerprint) ||
    typeof value.selectionRevision !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.selectionRevision) ||
    typeof value.stopped !== 'boolean' ||
    !(value.stopCode === null || nonempty(value.stopCode)) ||
    value.stopped !== (value.stopCode !== null) ||
    !Array.isArray(value.items) ||
    value.items.length > 1000
  )
    failure('journal_invalid');
  const source =
    value.schemaVersion === 3 ? decodeUnorganizedSource(value.source) : decodeSource(value.source);
  const items = value.items.map(
    value.schemaVersion === 1
      ? normalizeV1Item
      : value.schemaVersion === 2
        ? decodeItemV2
        : decodeItemV3,
  );
  const identities = new Set(
    items.map((item) => (value.schemaVersion === 3 ? item.mediaLinkId : item.trackId)),
  );
  const operations = items.flatMap((item) => [
    ...Object.values(item.operations),
    item.metadataSteps.required.operationId,
    item.metadataSteps.optional.operationId,
  ]);
  if (identities.size !== items.length || new Set(operations).size !== operations.length)
    failure('journal_invalid');
  return {
    schemaVersion: value.schemaVersion === 3 ? 3 : 2,
    apiFingerprint: value.apiFingerprint,
    credentialFingerprint: value.credentialFingerprint,
    selectionRevision: value.selectionRevision,
    source,
    stopped: value.stopped,
    stopCode: value.stopCode as string | null,
    items,
  };
}

function validateParent(path: string) {
  if (!isAbsolute(path)) failure('journal_private');
  try {
    const parent = lstatSync(dirname(path));
    if (
      parent.isSymbolicLink() ||
      !parent.isDirectory() ||
      (parent.mode & 0o777) !== 0o700 ||
      parent.uid !== process.getuid?.()
    )
      failure('journal_private');
  } catch (error) {
    if (error instanceof Error && error.message === 'client_failed:journal_private') throw error;
    failure('journal_private');
  }
}

function validatePrivateState(path: string) {
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
      failure('journal_private');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('client_failed:')) throw error;
    failure('journal_private');
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

export function acquireId3OrganizationBatchLock(path: string): () => void {
  validateParent(path);
  const lock = path + '.lock';
  let fd: number;
  try {
    fd = openSync(lock, 'wx', 0o600);
    writeFileSync(fd, String(process.pid) + '\n');
    fsyncSync(fd);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') failure('journal_locked');
    try {
      const stat = lstatSync(lock);
      if (
        stat.isSymbolicLink() ||
        !stat.isFile() ||
        (stat.mode & 0o777) !== 0o600 ||
        stat.uid !== process.getuid?.()
      )
        failure('journal_locked');
      const pid = Number(readFileSync(lock, 'utf8').trim());
      if (!Number.isSafeInteger(pid) || pid < 1) failure('journal_locked');
      try {
        process.kill(pid, 0);
        failure('journal_locked');
      } catch (probe) {
        if ((probe as NodeJS.ErrnoException).code !== 'ESRCH') throw probe;
      }
      unlinkSync(lock);
      fd = openSync(lock, 'wx', 0o600);
      writeFileSync(fd, String(process.pid) + '\n');
      fsyncSync(fd);
    } catch (staleError) {
      if (staleError instanceof Error && staleError.message.startsWith('client_failed:'))
        throw staleError;
      failure('journal_locked');
    }
  }
  return () => {
    try {
      closeSync(fd);
    } finally {
      try {
        unlinkSync(lock);
      } catch {
        failure('journal_locked');
      }
    }
  };
}

function fingerprint(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function createId3OrganizationBatchJournal(input: {
  path: string;
  api: string;
  token: string;
  selection: OrganizationSelection;
}): Id3OrganizationBatchJournal {
  validateParent(input.path);
  const release = acquireId3OrganizationBatchLock(input.path);
  try {
    const journal: Id3OrganizationBatchJournal = {
      schemaVersion: 2,
      apiFingerprint: fingerprint(['api', input.api]),
      credentialFingerprint: fingerprint(['credential', input.token]),
      selectionRevision: input.selection.selectionRevision,
      source: input.selection.source,
      stopped: false,
      stopCode: null,
      items: input.selection.items.map((item) => ({
        trackId: item.trackId,
        title: item.title,
        artist: item.artist,
        album: item.album,
        occurrenceIndexes: [...item.occurrenceIndexes],
        state: 'pending',
        errorCode: null,
        operations: {
          cover: randomUUID(),
          organization: randomUUID(),
        },
        coverUploadId: null,
        metadataSteps: {
          required: {
            operationId: randomUUID(),
            jobId: null,
            resultRevision: null,
            serverStage: null,
          },
          optional: {
            operationId: randomUUID(),
            jobId: null,
            resultRevision: null,
            serverStage: null,
          },
        },
        organizationJobId: null,
        newTrackId: null,
        serverStage: null,
      })),
    };
    decodeId3OrganizationBatchJournal(journal);
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
      failure('journal_exists');
    }
    return journal;
  } finally {
    release();
  }
}

export function readId3OrganizationBatchJournal(path: string): Id3OrganizationBatchJournal {
  validatePrivateState(path);
  try {
    return decodeId3OrganizationBatchJournal(JSON.parse(readFileSync(path, 'utf8')));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('client_failed:')) throw error;
    return failure('journal_invalid');
  }
}

function atomicWrite(path: string, journal: Id3OrganizationBatchJournal, crashAt?: CrashPoint) {
  const temporary = path + '.tmp';
  const injected = (point: CrashPoint) => {
    if (crashAt === point) failure(`injected_${point}`);
  };
  let temporaryCreated = false;
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
        failure('journal_private');
      unlinkSync(temporary);
      syncDirectory(path);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('client_failed:')) throw error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') failure('journal_private');
    }
    const fd = openSync(temporary, 'wx', 0o600);
    temporaryCreated = true;
    try {
      writeFileSync(fd, JSON.stringify(journal) + '\n');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    injected('after_temp_fsync');
    renameSync(temporary, path);
    temporaryCreated = false;
    injected('after_rename');
    syncDirectory(path);
  } finally {
    if (temporaryCreated) {
      try {
        unlinkSync(temporary);
      } catch {
        // A failed cleanup leaves the previous valid state authoritative and the next write fails closed.
      }
    }
  }
}

export function createId3OrganizationSweepChildJournal(input: {
  path: string;
  api: string;
  token: string;
  selectionId: string;
  selectionRevision: string;
  items: Array<{ ordinal: number; item: UnorganizedSelectionItem }>;
}): Id3OrganizationBatchJournal {
  validateParent(input.path);
  if (!opaque(input.selectionId) || !/^[a-f0-9]{64}$/.test(input.selectionRevision))
    failure('journal_invalid');
  const journal: Id3OrganizationBatchJournal = {
    schemaVersion: 3,
    apiFingerprint: fingerprint(['api', input.api]),
    credentialFingerprint: fingerprint(['credential', input.token]),
    selectionRevision: input.selectionRevision,
    source: { kind: 'unorganized', selectionId: input.selectionId },
    stopped: false,
    stopCode: null,
    items: input.items.map(({ ordinal, item }) =>
      sweepItem(input.selectionRevision, ordinal, item),
    ),
  };
  decodeId3OrganizationBatchJournal(journal);
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
    failure('journal_exists');
  }
  return journal;
}

function sweepItem(
  selectionRevision: string,
  ordinal: number,
  item: UnorganizedSelectionItem,
): Id3OrganizationBatchItem {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) failure('journal_invalid');
  const operation = (step: string) =>
    `${step}-${fingerprint(['unorganized', selectionRevision, item.mediaLinkId, step])}`;
  return {
    mediaLinkId: item.mediaLinkId,
    trackId: item.trackId,
    title: item.title,
    artist: item.artist,
    album: item.album,
    occurrenceIndexes: [ordinal],
    state: 'pending',
    errorCode: null,
    operations: { cover: operation('cover'), organization: operation('organization') },
    coverUploadId: null,
    metadataSteps: {
      required: {
        operationId: operation('required'),
        jobId: null,
        resultRevision: null,
        serverStage: null,
      },
      optional: {
        operationId: operation('optional'),
        jobId: null,
        resultRevision: null,
        serverStage: null,
      },
    },
    organizationJobId: null,
    newTrackId: null,
    serverStage: null,
  };
}

export function appendId3OrganizationSweepChildItems(
  path: string,
  items: Array<{ ordinal: number; item: UnorganizedSelectionItem }>,
  options: { crashAt?: CrashPoint } = {},
) {
  return updateJournal(
    path,
    (journal) => {
      if (journal.schemaVersion !== 3 || journal.source.kind !== 'unorganized')
        failure('journal_binding');
      for (const entry of items) {
        const existing = journal.items.find(
          ({ mediaLinkId }) => mediaLinkId === entry.item.mediaLinkId,
        );
        if (existing) {
          if (
            existing.occurrenceIndexes[0] !== entry.ordinal ||
            existing.trackId !== entry.item.trackId
          )
            failure('journal_binding');
          continue;
        }
        if (journal.items.length >= 1000) failure('journal_capacity');
        journal.items.push(sweepItem(journal.selectionRevision, entry.ordinal, entry.item));
      }
    },
    options.crashAt,
  );
}

export function finalizeId3OrganizationSweepItem(
  path: string,
  mediaLinkId: string,
  outcome: 'already_organized' | 'deferred_processing' | 'deferred_attention' | 'blocked_identity',
) {
  return updateJournal(path, (journal) => {
    if (journal.schemaVersion !== 3 || journal.source.kind !== 'unorganized')
      failure('journal_binding');
    const item = journal.items.find((candidate) => candidate.mediaLinkId === mediaLinkId);
    const current = journal.items.find((candidate) => !terminal(candidate.state));
    if (!item || current !== item || item.state !== 'pending') failure('journal_transition');
    item.state = outcome;
    item.errorCode = outcome;
  });
}

function updateJournal(
  path: string,
  update: (journal: Id3OrganizationBatchJournal) => void,
  crashAt?: CrashPoint,
) {
  const release = acquireId3OrganizationBatchLock(path);
  try {
    const journal = readId3OrganizationBatchJournal(path);
    update(journal);
    decodeId3OrganizationBatchJournal(journal);
    atomicWrite(path, journal, crashAt);
    return journal;
  } finally {
    release();
  }
}

const transitions: Record<Id3OrganizationBatchItemState, readonly Id3OrganizationBatchItemState[]> =
  {
    pending: [
      'researching',
      'already_organized',
      'deferred_processing',
      'deferred_attention',
      'blocked_identity',
    ],
    researching: ['metadata_accepted', 'skipped', 'blocked'],
    metadata_accepted: ['organization_accepted', 'blocked'],
    organization_accepted: ['succeeded', 'blocked'],
    succeeded: [],
    skipped: [],
    blocked: [],
    already_organized: [],
    deferred_processing: [],
    deferred_attention: [],
    blocked_identity: [],
  };

export const terminalId3OrganizationBatchState = (state: Id3OrganizationBatchItemState) =>
  terminal(state);

function terminal(state: Id3OrganizationBatchItemState) {
  return [
    'succeeded',
    'skipped',
    'blocked',
    'already_organized',
    'deferred_processing',
    'deferred_attention',
    'blocked_identity',
  ].includes(state);
}

function currentItem(journal: Id3OrganizationBatchJournal) {
  return journal.items.find((item) => !terminal(item.state));
}

function currentBoundItem(journal: Id3OrganizationBatchJournal, trackId: string) {
  const item = currentItem(journal);
  if (!item || item.trackId !== trackId) failure('journal_binding');
  return item;
}

export function advanceId3OrganizationBatch(
  path: string,
  trackId: string,
  state: Id3OrganizationBatchItemState,
  options: { crashAt?: CrashPoint } = {},
) {
  return updateJournal(
    path,
    (journal) => {
      if (journal.stopped) failure('batch_stopped');
      const item = currentBoundItem(journal, trackId);
      if (!item || !transitions[item.state].includes(state)) failure('journal_transition');
      item.state = state;
    },
    options.crashAt,
  );
}

export function nextId3OrganizationBatchItem(path: string) {
  let current = readId3OrganizationBatchJournal(path);
  if (current.stopped)
    current = updateJournal(path, (journal) => {
      journal.stopped = false;
      journal.stopCode = null;
    });
  const unfinished = currentItem(current);
  if (!unfinished) return null;
  const journal =
    unfinished.state === 'pending'
      ? advanceId3OrganizationBatch(path, unfinished.trackId, 'researching')
      : current;
  const item = currentItem(journal)!;
  return {
    trackId: item.trackId,
    title: item.title,
    artist: item.artist,
    album: item.album,
    occurrenceCount: item.occurrenceIndexes.length,
    state: item.state,
    checkpoint: {
      coverUploadId: item.coverUploadId,
      metadataSteps: item.metadataSteps,
      organizationJobId: item.organizationJobId,
      newTrackId: item.newTrackId,
      serverStage: item.serverStage,
    },
  };
}

export function skipId3OrganizationBatchItem(
  path: string,
  trackId: string,
  reason: Id3OrganizationBatchSkipReason | string,
) {
  if (!id3OrganizationBatchSkipReasons.includes(reason as never)) failure('skip_reason');
  return updateJournal(path, (journal) => {
    if (journal.stopped) failure('batch_stopped');
    const item = currentBoundItem(journal, trackId);
    if (
      !item ||
      !['pending', 'researching'].includes(item.state) ||
      item.coverUploadId !== null ||
      Object.values(item.metadataSteps).some(({ jobId }) => jobId !== null) ||
      item.organizationJobId !== null
    )
      failure('journal_transition');
    item.state = 'skipped';
    item.errorCode = reason;
  });
}

export function skipId3OrganizationBatchDestinationConflict(path: string, trackId: string) {
  return updateJournal(path, (journal) => {
    if (journal.stopped || journal.schemaVersion !== 3 || journal.source.kind !== 'unorganized')
      failure('journal_binding');
    const item = currentBoundItem(journal, trackId);
    const finalMetadata =
      item.metadataSteps.optional.jobId !== null
        ? item.metadataSteps.optional
        : item.metadataSteps.required;
    if (
      item.state !== 'metadata_accepted' ||
      item.organizationJobId !== null ||
      item.newTrackId !== null ||
      item.serverStage !== null ||
      !metadataCanOrganize(finalMetadata)
    )
      failure('journal_transition');
    item.state = 'skipped';
    item.errorCode = 'destination_conflict';
  });
}

export function completeId3OrganizationBatchSharedItem(
  path: string,
  trackId: string,
  newTrackId: string,
) {
  if (!opaque(newTrackId) || newTrackId === trackId) failure('journal_binding');
  return updateJournal(path, (journal) => {
    if (journal.stopped || journal.source.kind !== 'favorites') failure('journal_binding');
    const current = currentItem(journal);
    const item = current;
    if (
      !item ||
      current?.trackId !== trackId ||
      item.state !== 'researching' ||
      item.coverUploadId !== null ||
      Object.values(item.metadataSteps).some(({ jobId }) => jobId !== null) ||
      item.organizationJobId !== null
    )
      failure('journal_transition');
    item.state = 'succeeded';
    item.newTrackId = newTrackId;
    item.serverStage = 'succeeded';
  });
}

export function completeDeletedId3OrganizationDuplicate(
  path: string,
  trackId: string,
  existingTrackId: string,
) {
  if (!opaque(existingTrackId) || existingTrackId === trackId) failure('journal_binding');
  return updateJournal(path, (journal) => {
    if (journal.stopped || journal.schemaVersion !== 3 || journal.source.kind !== 'unorganized')
      failure('journal_binding');
    const item = currentBoundItem(journal, trackId);
    const finalMetadata =
      item.metadataSteps.optional.jobId !== null
        ? item.metadataSteps.optional
        : item.metadataSteps.required;
    if (
      item.state !== 'metadata_accepted' ||
      item.organizationJobId !== null ||
      item.newTrackId !== null ||
      item.serverStage !== null ||
      !metadataCanOrganize(finalMetadata)
    )
      failure('journal_transition');
    item.state = 'already_organized';
    item.errorCode = 'already_organized';
    item.newTrackId = existingTrackId;
  });
}

export function recordId3OrganizationBatchFailure(path: string, trackId: string, code: string) {
  if (!nonempty(code)) failure('journal_invalid');
  return updateJournal(path, (journal) => {
    const item = currentBoundItem(journal, trackId);
    if (!item || terminal(item.state)) failure('journal_transition');
    if (id3OrganizationBatchSystemFailures.includes(code as never)) {
      journal.stopped = true;
      journal.stopCode = code;
      return;
    }
    if (!id3OrganizationBatchSkipReasons.includes(code as never)) failure('failure_code');
    item.state = 'blocked';
    item.errorCode = code;
  });
}

export function checkpointId3OrganizationBatch(
  path: string,
  trackId: string,
  checkpoint:
    | { kind: 'cover'; uploadId: string }
    | {
        kind: 'metadata';
        step?: Id3OrganizationMetadataStepKind;
        jobId: string;
        resultRevision: string | null;
        serverStage: string;
      }
    | {
        kind: 'organization';
        jobId: string;
        newTrackId: string | null;
        serverStage: string;
      },
) {
  return updateJournal(path, (journal) => {
    if (journal.stopped) failure('batch_stopped');
    const item = currentBoundItem(journal, trackId);
    if (!item) failure('journal_binding');
    if (checkpoint.kind === 'cover') {
      const afterRequired =
        item.state === 'metadata_accepted' &&
        item.metadataSteps.required.jobId !== null &&
        item.metadataSteps.required.serverStage === 'succeeded' &&
        item.metadataSteps.required.resultRevision !== null &&
        item.metadataSteps.optional.jobId === null &&
        item.organizationJobId === null;
      if ((item.state !== 'researching' && !afterRequired) || !opaque(checkpoint.uploadId))
        failure('journal_transition');
      item.coverUploadId = checkpoint.uploadId;
      return;
    }
    if (checkpoint.kind === 'metadata') {
      const step = checkpoint.step ?? 'optional';
      const target = item.metadataSteps[step];
      if (
        !['researching', 'metadata_accepted'].includes(item.state) ||
        !opaque(checkpoint.jobId) ||
        !nullableOpaque(checkpoint.resultRevision) ||
        !opaque(checkpoint.serverStage)
      )
        failure('journal_transition');
      if (
        (step === 'required' && item.metadataSteps.optional.jobId !== null) ||
        (step === 'optional' &&
          item.metadataSteps.required.jobId !== null &&
          (item.metadataSteps.required.serverStage !== 'succeeded' ||
            item.metadataSteps.required.resultRevision === null))
      )
        failure('journal_transition');
      item.state = 'metadata_accepted';
      target.jobId = checkpoint.jobId;
      target.resultRevision = checkpoint.resultRevision;
      target.serverStage = checkpoint.serverStage;
      return;
    }
    if (
      !['metadata_accepted', 'organization_accepted'].includes(item.state) ||
      !opaque(checkpoint.jobId) ||
      !nullableOpaque(checkpoint.newTrackId) ||
      !opaque(checkpoint.serverStage)
    )
      failure('journal_transition');
    item.state = checkpoint.serverStage === 'succeeded' ? 'succeeded' : 'organization_accepted';
    item.organizationJobId = checkpoint.jobId;
    item.newTrackId = checkpoint.newTrackId;
    item.serverStage = checkpoint.serverStage;
  });
}

export function id3OrganizationBatchBinding(path: string, trackId: string) {
  const journal = readId3OrganizationBatchJournal(path);
  if (journal.stopped) failure('batch_stopped');
  const current = currentItem(journal);
  const item = current;
  if (!item || current?.trackId !== trackId) failure('journal_binding');
  return item;
}

export function id3OrganizationMetadataBinding(
  item: Id3OrganizationBatchItem,
  step: Id3OrganizationMetadataStepKind,
) {
  const target = item.metadataSteps[step];
  if (step === 'required' && item.metadataSteps.optional.jobId !== null) failure('journal_binding');
  if (step === 'optional' && item.metadataSteps.required.jobId !== null) {
    const required = item.metadataSteps.required;
    if (required.serverStage !== 'succeeded' || required.resultRevision === null)
      failure('journal_binding');
  }
  return target;
}

export function id3OrganizationFinalMetadataBinding(item: Id3OrganizationBatchItem) {
  const target =
    item.metadataSteps.optional.jobId !== null
      ? item.metadataSteps.optional
      : item.metadataSteps.required;
  if (target.jobId === null || !metadataCanOrganize(target)) failure('journal_binding');
  return target;
}

export function id3OrganizationPendingMetadataBinding(item: Id3OrganizationBatchItem) {
  for (const step of ['required', 'optional'] as const) {
    const target = item.metadataSteps[step];
    if (
      target.jobId !== null &&
      (target.serverStage !== 'succeeded' || target.resultRevision === null)
    )
      return { step, target };
  }
  failure('journal_binding');
}

export function verifyId3OrganizationBatchContext(
  path: string,
  api: string,
  token: string,
): Id3OrganizationBatchJournal {
  const journal = readId3OrganizationBatchJournal(path);
  if (
    journal.apiFingerprint !== fingerprint(['api', api]) ||
    journal.credentialFingerprint !== fingerprint(['credential', token])
  )
    failure('journal_binding');
  return journal;
}

export function id3OrganizationBatchStatus(path: string) {
  const journal = readId3OrganizationBatchJournal(path);
  const count = (state: Id3OrganizationBatchItemState) =>
    journal.items.filter((item) => item.state === state).length;
  return {
    schemaVersion: 1,
    total: journal.items.length,
    succeeded: count('succeeded'),
    skipped: count('skipped'),
    blocked: count('blocked'),
    alreadyOrganized: count('already_organized'),
    deferredProcessing: count('deferred_processing'),
    deferredAttention: count('deferred_attention'),
    blockedIdentity: count('blocked_identity'),
    pending: journal.items.filter((item) => !terminal(item.state)).length,
    stopped: journal.stopped,
    stopCode: journal.stopCode,
    current: nextSafeCurrent(journal),
  };
}

function nextSafeCurrent(journal: Id3OrganizationBatchJournal) {
  const item = journal.items.find((candidate) => !terminal(candidate.state));
  return item
    ? {
        trackId: item.trackId,
        state: item.state,
        serverStage: item.serverStage,
        occurrenceCount: item.occurrenceIndexes.length,
      }
    : null;
}
