import { metadataFields, type MetadataField } from './metadata.js';

export const organizationStages = [
  'queued',
  'validating',
  'references_captured',
  'moving',
  'moved',
  'scanning',
  'rebound',
  'migrating_references',
  'verifying',
  'succeeded',
  'failed',
  'conflict',
  'recovery_required',
] as const;
export type OrganizationStage = (typeof organizationStages)[number];
export const organizationPreviewErrors = [
  'account_unmapped',
  'library_denied',
  'source_outside_account',
  'unsafe_source',
  'metadata_incomplete',
  'excessive_length',
  'destination_conflict',
  'unsafe_target',
] as const;
export type OrganizationPreviewError = (typeof organizationPreviewErrors)[number];
export const organizationEvidenceKinds = [
  'official_artist',
  'official_label',
  'official_store',
  'music_database',
  'other',
] as const;
export type OrganizationEvidenceKind = (typeof organizationEvidenceKinds)[number];

export interface OrganizationCandidate {
  trackId: string;
  libraryId: string;
  title: string;
  artist: string[];
  album: string | null;
  currentRevision: string;
  importSourceId: string | null;
}
export interface OrganizationCandidates {
  schemaVersion: 1;
  candidates: OrganizationCandidate[];
  total: number;
}
export interface OrganizationPreviewRequest {
  trackId: string;
  expectedRevision: string;
  destinationPolicy: 'id3-managed-v1';
}
export type OrganizationPreview = {
  schemaVersion: 1;
  trackId: string;
  libraryId: string;
  currentRevision: string;
  currentKey: string;
  targetKey: string | null;
  writeGuaranteed: false;
} & (
  { status: 'ready' | 'no_op'; code: null } | { status: 'error'; code: OrganizationPreviewError }
);
export interface OrganizationSourceEvidence {
  url: string;
  kind: OrganizationEvidenceKind;
  fields: MetadataField[];
}
export interface OrganizationJobRequest extends OrganizationPreviewRequest {
  operationId: string;
  metadataJobId: string;
  sourceEvidence: OrganizationSourceEvidence[];
}
export interface OrganizationJob {
  id: string;
  itemId: string;
  libraryId: string;
  trackId: string;
  newTrackId: string | null;
  stage: OrganizationStage;
  errorCode: string | null;
  nextOwner: 'filesystem' | 'gonic' | 'references' | 'verification' | null;
}
export interface OrganizationJobResponse {
  schemaVersion: 1;
  job: OrganizationJob;
}

const text = { type: 'string', minLength: 1, maxLength: 4096 } as const;
const id = { type: 'string', minLength: 1, maxLength: 2048 } as const;
const empty = { type: 'object', additionalProperties: false } as const;
const params = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id },
} as const;
const preview = {
  type: 'object',
  additionalProperties: false,
  required: ['trackId', 'expectedRevision', 'destinationPolicy'],
  properties: {
    trackId: id,
    expectedRevision: text,
    destinationPolicy: { const: 'id3-managed-v1' },
  },
} as const;
const evidence = {
  type: 'object',
  additionalProperties: false,
  required: ['url', 'kind', 'fields'],
  properties: {
    url: { type: 'string', minLength: 9, maxLength: 2048, pattern: '^https://' },
    kind: { enum: organizationEvidenceKinds },
    fields: {
      type: 'array',
      minItems: 1,
      maxItems: metadataFields.length,
      uniqueItems: true,
      items: { enum: metadataFields },
    },
  },
} as const;
const job = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'itemId',
    'libraryId',
    'trackId',
    'newTrackId',
    'stage',
    'errorCode',
    'nextOwner',
  ],
  properties: {
    id,
    itemId: id,
    libraryId: id,
    trackId: id,
    newTrackId: { anyOf: [id, { type: 'null' }] },
    stage: { enum: organizationStages },
    errorCode: { anyOf: [text, { type: 'null' }] },
    nextOwner: {
      enum: ['filesystem', 'gonic', 'references', 'verification', null],
    },
  },
} as const;
export const organizationRequestSchemas = {
  empty,
  params,
  candidates: {
    type: 'object',
    additionalProperties: false,
    required: ['title'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 256, pattern: '\\S' },
      libraryId: id,
      limit: { type: 'string', pattern: '^(?:[1-9]|1[0-9]|20)$' },
    },
  },
  preview,
  create: {
    ...preview,
    required: [...preview.required, 'operationId', 'metadataJobId', 'sourceEvidence'],
    properties: {
      ...preview.properties,
      operationId: { type: 'string', minLength: 21, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' },
      metadataJobId: id,
      sourceEvidence: {
        type: 'array',
        minItems: 1,
        maxItems: 8,
        items: evidence,
      },
    },
  },
  retry: {
    type: 'object',
    additionalProperties: false,
    required: ['operationId'],
    properties: {
      operationId: { type: 'string', minLength: 21, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' },
    },
  },
} as const;
export const organizationResponseSchemas = {
  candidates: {
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'candidates', 'total'],
    properties: {
      schemaVersion: { const: 1 },
      candidates: {
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'trackId',
            'libraryId',
            'title',
            'artist',
            'album',
            'currentRevision',
            'importSourceId',
          ],
          properties: {
            trackId: id,
            libraryId: id,
            title: text,
            artist: { type: 'array', maxItems: 64, items: text },
            album: { anyOf: [text, { type: 'null' }] },
            currentRevision: text,
            importSourceId: { anyOf: [id, { type: 'null' }] },
          },
        },
      },
      total: { type: 'integer', minimum: 0, maximum: 20 },
    },
  },
  preview: {
    type: 'object',
    additionalProperties: false,
    required: [
      'schemaVersion',
      'trackId',
      'libraryId',
      'currentRevision',
      'currentKey',
      'targetKey',
      'writeGuaranteed',
      'status',
      'code',
    ],
    properties: {
      schemaVersion: { const: 1 },
      trackId: id,
      libraryId: id,
      currentRevision: text,
      currentKey: text,
      targetKey: { anyOf: [text, { type: 'null' }] },
      writeGuaranteed: { const: false },
      status: { enum: ['ready', 'no_op', 'error'] },
      code: { enum: [...organizationPreviewErrors, null] },
    },
  },
  job: {
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'job'],
    properties: { schemaVersion: { const: 1 }, job },
  },
} as const;

function record(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid organization response');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key)))
    throw new Error('Invalid organization response');
  return row;
}
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value;
function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonempty);
}
export function decodeOrganizationCandidates(value: unknown): OrganizationCandidates {
  const row = record(value, ['schemaVersion', 'candidates', 'total']);
  if (
    row.schemaVersion !== 1 ||
    !Array.isArray(row.candidates) ||
    row.candidates.length > 20 ||
    row.total !== row.candidates.length
  )
    throw new Error('Invalid organization response');
  const candidates = row.candidates.map((value) => {
    const candidate = record(value, [
      'trackId',
      'libraryId',
      'title',
      'artist',
      'album',
      'currentRevision',
      'importSourceId',
    ]);
    if (
      ![candidate.trackId, candidate.libraryId, candidate.title, candidate.currentRevision].every(
        nonempty,
      ) ||
      !stringList(candidate.artist) ||
      !(candidate.album === null || nonempty(candidate.album)) ||
      !(candidate.importSourceId === null || nonempty(candidate.importSourceId))
    )
      throw new Error('Invalid organization response');
    return candidate as unknown as OrganizationCandidate;
  });
  return { schemaVersion: 1, candidates, total: candidates.length };
}
export function decodeOrganizationPreview(value: unknown): OrganizationPreview {
  const row = record(value, [
    'schemaVersion',
    'trackId',
    'libraryId',
    'currentRevision',
    'currentKey',
    'targetKey',
    'writeGuaranteed',
    'status',
    'code',
  ]);
  if (
    row.schemaVersion !== 1 ||
    ![row.trackId, row.libraryId, row.currentRevision, row.currentKey].every(nonempty) ||
    row.writeGuaranteed !== false ||
    !['ready', 'no_op', 'error'].includes(String(row.status)) ||
    (row.status === 'error'
      ? !organizationPreviewErrors.includes(row.code as OrganizationPreviewError) ||
        row.targetKey !== null
      : row.code !== null || !nonempty(row.targetKey))
  )
    throw new Error('Invalid organization response');
  return row as unknown as OrganizationPreview;
}
export function decodeOrganizationJob(value: unknown): OrganizationJob {
  const row = record(value, [
    'id',
    'itemId',
    'libraryId',
    'trackId',
    'newTrackId',
    'stage',
    'errorCode',
    'nextOwner',
  ]);
  if (
    ![row.id, row.itemId, row.libraryId, row.trackId].every(nonempty) ||
    !(row.newTrackId === null || nonempty(row.newTrackId)) ||
    !organizationStages.includes(row.stage as OrganizationStage) ||
    !(row.errorCode === null || nonempty(row.errorCode)) ||
    !['filesystem', 'gonic', 'references', 'verification', null].includes(row.nextOwner as null)
  )
    throw new Error('Invalid organization response');
  return row as unknown as OrganizationJob;
}
export function decodeOrganizationJobResponse(value: unknown): OrganizationJobResponse {
  const row = record(value, ['schemaVersion', 'job']);
  if (row.schemaVersion !== 1) throw new Error('Invalid organization response');
  return { schemaVersion: 1, job: decodeOrganizationJob(row.job) };
}
