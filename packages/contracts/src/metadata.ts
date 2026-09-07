import { playlistMutationSchemas } from './collections.js';
/** File revision is opaque and independent of the numeric MediaLink binding revision. */
export const metadataFields = [
  'title',
  'artist',
  'album',
  'albumArtist',
  'trackNumber',
  'year',
  'genre',
  'cover',
  'lyrics',
] as const;
export type MetadataField = (typeof metadataFields)[number];
export type FieldPatch<T> = { op: 'set'; value: T } | { op: 'clear' };
export interface LyricsSelector {
  language: string;
  description: string;
}
export interface FrontCoverSelector {
  kind: 'front';
  description: string;
}
export interface MetadataPatch {
  title?: FieldPatch<string>;
  artist?: FieldPatch<string[]>;
  album?: FieldPatch<string>;
  albumArtist?: FieldPatch<string[]>;
  trackNumber?: FieldPatch<string>;
  year?: FieldPatch<string>;
  genre?: FieldPatch<string[]>;
  cover?:
    | { op: 'set'; selector: FrontCoverSelector | { kind: 'new' }; uploadId: string }
    | { op: 'clear'; selector: FrontCoverSelector };
  lyrics?:
    | { op: 'set'; selector: LyricsSelector; text: string }
    | { op: 'clear'; selector: LyricsSelector };
}
export interface MetadataTarget {
  trackId: string;
  expectedRevision: string;
}
export interface MetadataJobRequest {
  operationId: string;
  targets: MetadataTarget[];
  patch: MetadataPatch;
  sourceReference?: string;
  usageBasis?: string;
}
export type MetadataPreviewRequest = Pick<MetadataJobRequest, 'targets' | 'patch'>;
export interface MetadataPreview {
  schemaVersion: 1;
  libraryId: string;
  targetCount: number;
  changedFields: MetadataField[];
  targets: { trackId: string; fileRevision: string }[];
  writeGuaranteed: false;
}
export interface MetadataCoverUpload {
  schemaVersion: 1;
  uploadId: string;
  libraryId: string;
  mimeType: 'image/png' | 'image/jpeg';
  size: number;
  expiresAt: number;
  previewUrl: string;
}
export interface MetadataChange {
  sequence: number;
  libraryId: string;
  oldTrackId: string;
  newTrackId: string;
  oldRevision: string;
  newRevision: string;
  coverGeneration: string;
  relatedIds: { trackIds: string[]; albumIds: string[]; artistIds: string[]; coverIds: string[] };
  changedFields: MetadataField[];
  fileSavedAt: number;
  reflectedAt: number | null;
  reflection: 'verified' | 'reflection_mismatch' | 'reference_conflict';
}
export interface MetadataChangesPage {
  schemaVersion: 1;
  changes: MetadataChange[];
  hasMore: boolean;
  nextCursor: string;
}
export const metadataStages = [
  'queued',
  'preparing',
  'backed_up',
  'prepared',
  'file_saved',
  'reflecting',
  'succeeded',
  'conflict',
  'failed',
  'recovery_required',
] as const;
export type MetadataStage = (typeof metadataStages)[number];
export const metadataJobStatuses = [
  'queued',
  'running',
  'reflecting',
  'succeeded',
  'partial',
  'failed',
] as const;
export type MetadataJobStatus = (typeof metadataJobStatuses)[number];
export const metadataErrorCodes = [
  'revision_conflict',
  'file_unavailable',
  'read_only',
  'unsupported_format',
  'invalid_metadata',
  'ambiguous_selector',
  'invalid_cover',
  'backup_failed',
  'prepare_failed',
  'write_failed',
  'write_uncertain',
  'audio_mismatch',
  'reflection_unavailable',
  'reflection_mismatch',
  'reference_conflict',
  'worker_interrupted',
  'permission_changed',
  'restore_unavailable',
] as const;
export type MetadataErrorCode = (typeof metadataErrorCodes)[number];
export const metadataRecoveryActions = ['refresh', 'retry', 'recheck', 'restore'] as const;
export type MetadataRecoveryAction = (typeof metadataRecoveryActions)[number];
export interface MetadataItem {
  itemId: string;
  originalTrackId: string;
  currentTrackId: string;
  stage: MetadataStage;
  fileSavedAt: number | null;
  reflectedAt: number | null;
  previousRevision: string;
  resultRevision: string | null;
  changedFields: MetadataField[];
  errorCode: MetadataErrorCode | null;
  recoveryActions: MetadataRecoveryAction[];
  restoreAvailable: boolean;
}
export interface MetadataJob {
  id: string;
  libraryId: string;
  createdAt: number;
  status: MetadataJobStatus;
  kind: 'edit' | 'retry' | 'restore';
  parentJobId: string | null;
  items: MetadataItem[];
}
export interface MetadataValues {
  title: string | null;
  artist: string[];
  album: string | null;
  albumArtist: string[];
  trackNumber: string | null;
  year: string | null;
  genre: string[];
}
export interface MetadataSnapshot {
  schemaVersion: 1;
  trackId: string;
  editable: boolean;
  reason: MetadataErrorCode | null;
  format: 'mp3' | 'unsupported';
  supportedFields: MetadataField[];
  fileRevision: string;
  values: MetadataValues;
  coverFrames: {
    frameId: string;
    pictureType: number;
    description: string;
    mimeType: 'image/jpeg' | 'image/png';
    previewUrl: string;
  }[];
  lyricsFrames: { selector: LyricsSelector; text: string }[];
  lastVerifiedAt: number;
}

const object = <T>(required: string[], properties: T) =>
  ({ type: 'object', additionalProperties: false, required, properties }) as const;
const id = {
  type: 'string',
  minLength: 1,
  maxLength: 1024,
  pattern: '^[A-Za-z0-9_.:-]+$',
} as const;
const trackId = {
  type: 'string',
  minLength: 1,
  maxLength: 2048,
  pattern: '^[^\\u0000-\\u001f\\u007f]+$',
} as const;
const text = { type: 'string', minLength: 1, maxLength: 4096, pattern: '\\S' } as const;
const description = { type: 'string', maxLength: 256 } as const;
const instant = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER } as const;
const nullable = <T>(schema: T) => ({ anyOf: [schema, { type: 'null' }] }) as const;
const strings = { type: 'array', maxItems: 32, items: text } as const;
const fieldPatch = <T>(value: T) =>
  ({
    oneOf: [
      object(['op', 'value'], { op: { const: 'set' }, value }),
      object(['op'], { op: { const: 'clear' } }),
    ],
  }) as const;
const lyricsSelector = object(['language', 'description'], {
  language: { type: 'string', pattern: '^[a-z]{3}$' },
  description,
});
const frontSelector = object(['kind', 'description'], { kind: { const: 'front' }, description });
export const metadataPatchSchema = {
  ...object([], {
    title: fieldPatch(text),
    artist: fieldPatch({ ...strings, minItems: 1 }),
    album: fieldPatch(text),
    albumArtist: fieldPatch({ ...strings, minItems: 1 }),
    genre: fieldPatch({ ...strings, minItems: 1 }),
    trackNumber: fieldPatch({
      type: 'string',
      maxLength: 16,
      pattern: '^[1-9][0-9]*(/[1-9][0-9]*)?$',
    }),
    year: fieldPatch({ type: 'string', pattern: '^[0-9]{4}$' }),
    cover: {
      oneOf: [
        object(['op', 'selector', 'uploadId'], {
          op: { const: 'set' },
          selector: { oneOf: [frontSelector, object(['kind'], { kind: { const: 'new' } })] },
          uploadId: id,
        }),
        object(['op', 'selector'], { op: { const: 'clear' }, selector: frontSelector }),
      ],
    },
    lyrics: {
      oneOf: [
        object(['op', 'selector', 'text'], {
          op: { const: 'set' },
          selector: lyricsSelector,
          text: { type: 'string', minLength: 1, maxLength: 100000, pattern: '\\S' },
        }),
        object(['op', 'selector'], { op: { const: 'clear' }, selector: lyricsSelector }),
      ],
    },
  }),
  minProperties: 1,
} as const;
const target = object(['trackId', 'expectedRevision'], { trackId, expectedRevision: id });
const targets = {
  type: 'array',
  minItems: 1,
  maxItems: 100,
  uniqueItems: true,
  items: target,
} as const;
const operationId = playlistMutationSchemas.create.properties.operationId;
const sourceProperties = {
  sourceReference: { type: 'string', minLength: 1, maxLength: 2048 },
  usageBasis: text,
} as const;
const itemIds = {
  type: 'array',
  minItems: 1,
  maxItems: 100,
  uniqueItems: true,
  items: id,
} as const;
export const metadataRequestSchemas = {
  empty: object([], {}),
  trackParams: object(['id'], { id: trackId }),
  frameParams: object(['id', 'frameId'], { id: trackId, frameId: id }),
  create: object(['operationId', 'targets', 'patch'], {
    operationId,
    targets,
    patch: metadataPatchSchema,
    ...sourceProperties,
  }),
  preview: object(['targets', 'patch'], { targets, patch: metadataPatchSchema }),
  retry: object(['operationId', 'items'], {
    operationId,
    items: {
      ...itemIds,
      items: object(['itemId', 'expectedRevision'], { itemId: id, expectedRevision: id }),
    },
  }),
  recheck: object(['operationId', 'itemIds'], { operationId, itemIds }),
  restore: object(['operationId', 'itemId', 'currentExpectedRevision'], {
    operationId,
    itemId: id,
    currentExpectedRevision: id,
  }),
  list: object([], {
    cursor: { type: 'string', minLength: 1, maxLength: 4096 },
    limit: { type: 'string', pattern: '^(?:[1-9]|[1-9][0-9]|100)$' },
  }),
  params: object(['id'], { id }),
} as const;
const fields = {
  type: 'array',
  uniqueItems: true,
  maxItems: metadataFields.length,
  items: { enum: metadataFields },
} as const;
export const metadataItemSchema = object(
  [
    'itemId',
    'originalTrackId',
    'currentTrackId',
    'stage',
    'fileSavedAt',
    'reflectedAt',
    'previousRevision',
    'resultRevision',
    'changedFields',
    'errorCode',
    'recoveryActions',
    'restoreAvailable',
  ],
  {
    itemId: id,
    originalTrackId: trackId,
    currentTrackId: trackId,
    stage: { enum: metadataStages },
    fileSavedAt: nullable(instant),
    reflectedAt: nullable(instant),
    previousRevision: id,
    resultRevision: nullable(id),
    changedFields: fields,
    errorCode: nullable({ enum: metadataErrorCodes }),
    recoveryActions: { type: 'array', uniqueItems: true, items: { enum: metadataRecoveryActions } },
    restoreAvailable: { type: 'boolean' },
  },
);
const job = object(['id', 'libraryId', 'createdAt', 'status', 'kind', 'parentJobId', 'items'], {
  id,
  libraryId: id,
  createdAt: instant,
  status: { enum: metadataJobStatuses },
  kind: { enum: ['edit', 'retry', 'restore'] },
  parentJobId: nullable(id),
  items: { type: 'array', minItems: 1, maxItems: 100, items: metadataItemSchema },
});
const change = object(
  [
    'sequence',
    'libraryId',
    'oldTrackId',
    'newTrackId',
    'oldRevision',
    'newRevision',
    'coverGeneration',
    'relatedIds',
    'changedFields',
    'fileSavedAt',
    'reflectedAt',
    'reflection',
  ],
  {
    sequence: { ...instant, minimum: 1 },
    libraryId: id,
    oldTrackId: trackId,
    newTrackId: trackId,
    oldRevision: id,
    newRevision: id,
    coverGeneration: id,
    relatedIds: object(
      ['trackIds', 'albumIds', 'artistIds', 'coverIds'],
      Object.fromEntries(
        ['trackIds', 'albumIds', 'artistIds', 'coverIds'].map((key) => [
          key,
          { type: 'array', maxItems: 100, items: trackId },
        ]),
      ),
    ),
    changedFields: fields,
    fileSavedAt: instant,
    reflectedAt: nullable(instant),
    reflection: { enum: ['verified', 'reflection_mismatch', 'reference_conflict'] },
  },
);
export const metadataResponseSchemas = {
  preview: object(
    ['schemaVersion', 'libraryId', 'targetCount', 'changedFields', 'targets', 'writeGuaranteed'],
    {
      schemaVersion: { const: 1 },
      libraryId: id,
      targetCount: { type: 'integer', minimum: 1, maximum: 100 },
      changedFields: fields,
      targets: {
        type: 'array',
        minItems: 1,
        maxItems: 100,
        items: object(['trackId', 'fileRevision'], { trackId, fileRevision: id }),
      },
      writeGuaranteed: { const: false },
    },
  ),
  upload: object(
    ['schemaVersion', 'uploadId', 'libraryId', 'mimeType', 'size', 'expiresAt', 'previewUrl'],
    {
      schemaVersion: { const: 1 },
      uploadId: id,
      libraryId: id,
      mimeType: { enum: ['image/jpeg', 'image/png'] },
      size: { type: 'integer', minimum: 1, maximum: 8 * 1024 * 1024 },
      expiresAt: instant,
      previewUrl: { type: 'string', maxLength: 4096, pattern: '^/api/v1/metadata-covers/' },
    },
  ),
  changes: object(['schemaVersion', 'changes', 'hasMore', 'nextCursor'], {
    schemaVersion: { const: 1 },
    changes: { type: 'array', maxItems: 100, items: change },
    hasMore: { type: 'boolean' },
    nextCursor: { type: 'string', minLength: 1, maxLength: 4096 },
  }),
  detail: object(['schemaVersion', 'job'], { schemaVersion: { const: 1 }, job }),
  list: object(['schemaVersion', 'jobs', 'nextCursor'], {
    schemaVersion: { const: 1 },
    jobs: { type: 'array', maxItems: 100, items: job },
    nextCursor: nullable(text),
  }),
  snapshot: object(
    [
      'schemaVersion',
      'trackId',
      'editable',
      'reason',
      'format',
      'supportedFields',
      'fileRevision',
      'values',
      'coverFrames',
      'lyricsFrames',
      'lastVerifiedAt',
    ],
    {
      schemaVersion: { const: 1 },
      trackId,
      editable: { type: 'boolean' },
      reason: nullable({ enum: metadataErrorCodes }),
      format: { enum: ['mp3', 'unsupported'] },
      supportedFields: fields,
      fileRevision: id,
      values: object(['title', 'artist', 'album', 'albumArtist', 'trackNumber', 'year', 'genre'], {
        title: nullable(text),
        artist: strings,
        album: nullable(text),
        albumArtist: strings,
        trackNumber: nullable(text),
        year: nullable(text),
        genre: strings,
      }),
      coverFrames: {
        type: 'array',
        maxItems: 128,
        items: object(['frameId', 'pictureType', 'description', 'mimeType', 'previewUrl'], {
          frameId: id,
          pictureType: { type: 'integer', minimum: 0, maximum: 20 },
          description,
          mimeType: { enum: ['image/jpeg', 'image/png'] },
          previewUrl: { type: 'string', maxLength: 20000, pattern: '^/api/v1/' },
        }),
      },
      lyricsFrames: {
        type: 'array',
        maxItems: 128,
        items: object(['selector', 'text'], {
          selector: lyricsSelector,
          text: { type: 'string', maxLength: 100000 },
        }),
      },
      lastVerifiedAt: instant,
    },
  ),
} as const;

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    keys.some((key) => !(key in value))
  )
    throw new Error('Invalid metadata response');
  return value as Record<string, unknown>;
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1024 || !/^[A-Za-z0-9_.:-]+$/.test(value))
    throw new Error('Invalid metadata response');
  return value;
}
function trackIdentifier(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > 2048 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new Error('Invalid metadata response');
  return value;
}
function timestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Invalid metadata response');
  return value;
}
function member<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T))
    throw new Error('Invalid metadata response');
  return value as T;
}
function enumList<T extends string>(value: unknown, values: readonly T[]): T[] {
  if (!Array.isArray(value) || new Set(value).size !== value.length || value.length > values.length)
    throw new Error('Invalid metadata response');
  return value.map((item) => member(item, values));
}
export function decodeMetadataItem(value: unknown): MetadataItem {
  const v = record(value, metadataItemSchema.required);
  if (typeof v.restoreAvailable !== 'boolean') throw new Error('Invalid metadata response');
  const result: MetadataItem = {
    itemId: identifier(v.itemId),
    originalTrackId: trackIdentifier(v.originalTrackId),
    currentTrackId: trackIdentifier(v.currentTrackId),
    stage: member(v.stage, metadataStages),
    fileSavedAt: v.fileSavedAt === null ? null : timestamp(v.fileSavedAt),
    reflectedAt: v.reflectedAt === null ? null : timestamp(v.reflectedAt),
    previousRevision: identifier(v.previousRevision),
    resultRevision: v.resultRevision === null ? null : identifier(v.resultRevision),
    changedFields: enumList(v.changedFields, metadataFields),
    errorCode: v.errorCode === null ? null : member(v.errorCode, metadataErrorCodes),
    recoveryActions: enumList(v.recoveryActions, metadataRecoveryActions),
    restoreAvailable: v.restoreAvailable,
  };
  if (
    (result.fileSavedAt !== null && result.resultRevision === null) ||
    (result.reflectedAt !== null &&
      (result.fileSavedAt === null || result.reflectedAt < result.fileSavedAt)) ||
    (['file_saved', 'reflecting', 'succeeded'].includes(result.stage) &&
      result.fileSavedAt === null) ||
    (result.stage === 'succeeded' && (result.reflectedAt === null || result.errorCode !== null)) ||
    (['failed', 'conflict', 'recovery_required'].includes(result.stage) &&
      result.errorCode === null) ||
    (result.restoreAvailable && result.fileSavedAt === null)
  )
    throw new Error('Invalid metadata response');
  return result;
}
export function decodeMetadataJob(value: unknown): MetadataJob {
  const v = record(value, job.required);
  if (!Array.isArray(v.items) || !v.items.length || v.items.length > 100)
    throw new Error('Invalid metadata response');
  const result: MetadataJob = {
    id: identifier(v.id),
    libraryId: identifier(v.libraryId),
    createdAt: timestamp(v.createdAt),
    status: member(v.status, metadataJobStatuses),
    kind: member(v.kind, ['edit', 'retry', 'restore']),
    parentJobId: v.parentJobId === null ? null : identifier(v.parentJobId),
    items: v.items.map(decodeMetadataItem),
  };
  if (
    new Set(result.items.map((item) => item.itemId)).size !== result.items.length ||
    (result.kind === 'edit') !== (result.parentJobId === null)
  )
    throw new Error('Invalid metadata response');
  return result;
}

function boundedText(value: unknown, maxLength = 4096, empty = false): string {
  if (typeof value !== 'string' || value.length > maxLength || (!empty && !value.trim()))
    throw new Error('Invalid metadata response');
  return value;
}
function list<T>(value: unknown, decode: (item: unknown) => T, limit: number): T[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error('Invalid metadata response');
  return value.map(decode);
}
export function decodeMetadataSnapshot(value: unknown): MetadataSnapshot {
  const v = record(value, metadataResponseSchemas.snapshot.required);
  if (v.schemaVersion !== 1 || typeof v.editable !== 'boolean')
    throw new Error('Invalid metadata response');
  const values = record(v.values, [
    'title',
    'artist',
    'album',
    'albumArtist',
    'trackNumber',
    'year',
    'genre',
  ]);
  const scalar = (value: unknown) => (value === null ? null : boundedText(value));
  const result: MetadataSnapshot = {
    schemaVersion: 1,
    trackId: trackIdentifier(v.trackId),
    editable: v.editable,
    reason: v.reason === null ? null : member(v.reason, metadataErrorCodes),
    format: member(v.format, ['mp3', 'unsupported']),
    supportedFields: enumList(v.supportedFields, metadataFields),
    fileRevision: identifier(v.fileRevision),
    values: {
      title: scalar(values.title),
      artist: list(values.artist, (item) => boundedText(item), 32),
      album: scalar(values.album),
      albumArtist: list(values.albumArtist, (item) => boundedText(item), 32),
      trackNumber: scalar(values.trackNumber),
      year: scalar(values.year),
      genre: list(values.genre, (item) => boundedText(item), 32),
    },
    coverFrames: list(
      v.coverFrames,
      (item) => {
        const frame = record(item, [
          'frameId',
          'pictureType',
          'description',
          'mimeType',
          'previewUrl',
        ]);
        const pictureType = timestamp(frame.pictureType);
        const previewUrl = boundedText(frame.previewUrl, 20000);
        if (pictureType > 20 || !previewUrl.startsWith('/api/v1/'))
          throw new Error('Invalid metadata response');
        return {
          frameId: identifier(frame.frameId),
          pictureType,
          description: boundedText(frame.description, 256, true),
          mimeType: member(frame.mimeType, ['image/jpeg', 'image/png']),
          previewUrl,
        };
      },
      128,
    ),
    lyricsFrames: list(
      v.lyricsFrames,
      (item) => {
        const frame = record(item, ['selector', 'text']);
        const selector = record(frame.selector, ['language', 'description']);
        const language = boundedText(selector.language, 3);
        if (!/^[a-z]{3}$/.test(language)) throw new Error('Invalid metadata response');
        return {
          selector: { language, description: boundedText(selector.description, 256, true) },
          text: boundedText(frame.text, 100000, true),
        };
      },
      128,
    ),
    lastVerifiedAt: timestamp(v.lastVerifiedAt),
  };
  if (
    result.editable &&
    (result.reason !== null || result.format !== 'mp3' || !result.supportedFields.length)
  )
    throw new Error('Invalid metadata response');
  return result;
}

export function decodeMetadataPreview(value: unknown): MetadataPreview {
  const v = record(value, metadataResponseSchemas.preview.required);
  if (v.schemaVersion !== 1 || v.writeGuaranteed !== false)
    throw new Error('Invalid metadata response');
  const targets = list(
    v.targets,
    (entry) => {
      const target = record(entry, ['trackId', 'fileRevision']);
      return {
        trackId: trackIdentifier(target.trackId),
        fileRevision: identifier(target.fileRevision),
      };
    },
    100,
  );
  if (
    !targets.length ||
    v.targetCount !== targets.length ||
    new Set(targets.map((target) => target.trackId)).size !== targets.length
  )
    throw new Error('Invalid metadata response');
  const changedFields = enumList(v.changedFields, metadataFields);
  if (!changedFields.length) throw new Error('Invalid metadata response');
  return {
    schemaVersion: 1,
    libraryId: identifier(v.libraryId),
    targetCount: targets.length,
    changedFields,
    targets,
    writeGuaranteed: false,
  };
}
export function decodeMetadataCoverUpload(value: unknown): MetadataCoverUpload {
  const v = record(value, metadataResponseSchemas.upload.required);
  const size = timestamp(v.size);
  const previewUrl = boundedText(v.previewUrl);
  if (
    v.schemaVersion !== 1 ||
    !size ||
    size > 8 * 1024 * 1024 ||
    !previewUrl.startsWith('/api/v1/metadata-covers/')
  )
    throw new Error('Invalid metadata response');
  return {
    schemaVersion: 1,
    uploadId: identifier(v.uploadId),
    libraryId: identifier(v.libraryId),
    mimeType: member(v.mimeType, ['image/jpeg', 'image/png']),
    size,
    expiresAt: timestamp(v.expiresAt),
    previewUrl,
  };
}
export function decodeMetadataChanges(value: unknown): MetadataChangesPage {
  const v = record(value, metadataResponseSchemas.changes.required);
  if (v.schemaVersion !== 1 || typeof v.hasMore !== 'boolean')
    throw new Error('Invalid metadata response');
  const changes = list(
    v.changes,
    (entry): MetadataChange => {
      const c = record(entry, change.required);
      const ids = record(c.relatedIds, ['trackIds', 'albumIds', 'artistIds', 'coverIds']);
      const fileSavedAt = timestamp(c.fileSavedAt);
      const reflectedAt = c.reflectedAt === null ? null : timestamp(c.reflectedAt);
      const reflection = member(c.reflection, [
        'verified',
        'reflection_mismatch',
        'reference_conflict',
      ]);
      const sequence = timestamp(c.sequence);
      if (
        sequence < 1 ||
        (reflectedAt !== null && reflectedAt < fileSavedAt) ||
        (reflection === 'verified') !== (reflectedAt !== null)
      )
        throw new Error('Invalid metadata response');
      return {
        sequence,
        libraryId: identifier(c.libraryId),
        oldTrackId: trackIdentifier(c.oldTrackId),
        newTrackId: trackIdentifier(c.newTrackId),
        oldRevision: identifier(c.oldRevision),
        newRevision: identifier(c.newRevision),
        coverGeneration: identifier(c.coverGeneration),
        relatedIds: {
          trackIds: list(ids.trackIds, trackIdentifier, 100),
          albumIds: list(ids.albumIds, trackIdentifier, 100),
          artistIds: list(ids.artistIds, trackIdentifier, 100),
          coverIds: list(ids.coverIds, trackIdentifier, 100),
        },
        changedFields: enumList(c.changedFields, metadataFields),
        fileSavedAt,
        reflectedAt,
        reflection,
      };
    },
    100,
  );
  if (changes.some((entry, index) => index > 0 && entry.sequence <= changes[index - 1]!.sequence))
    throw new Error('Invalid metadata response');
  return { schemaVersion: 1, changes, hasMore: v.hasMore, nextCursor: boundedText(v.nextCursor) };
}
