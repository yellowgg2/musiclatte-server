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
export const organizationStates = [
  'organized',
  'needs_organization',
  'processing',
  'attention',
  'unknown',
] as const;
export type OrganizationState = (typeof organizationStates)[number];
export const organizationStateReasons = [
  'verified',
  'never_organized',
  'path_metadata_changed',
  'path_binding_changed',
  'policy_changed',
  'job_active',
  'job_failed',
  'job_conflict',
  'recovery_required',
  'identity_unavailable',
  'verification_missing',
] as const;
export type OrganizationStateReason = (typeof organizationStateReasons)[number];
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
export interface OrganizationTargetReplacementRequest {
  operationId: string;
  displacedTrackId: string;
  backupReceiptDigest: string;
  referenceSnapshotDigests: string[];
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
export type OrganizationStatusTarget =
  { kind: 'track'; trackId: string } | { kind: 'media_link'; mediaLinkId: string };
export interface OrganizationStatusRequest {
  schemaVersion: 1;
  targets: OrganizationStatusTarget[];
}
export interface OrganizationStatusItem {
  target: OrganizationStatusTarget;
  state: OrganizationState;
  reason: OrganizationStateReason;
  stage: OrganizationStage | null;
  changedAt: number | null;
}
export interface OrganizationStatusResponse {
  schemaVersion: 1;
  capturedAt: number;
  items: OrganizationStatusItem[];
}
export interface OrganizationStateFacts {
  stage: OrganizationStage | null;
  identityAvailable: boolean;
  verificationComplete: boolean;
  pathMetadataChanged: boolean;
  bindingMatches: boolean;
  policyMatches: boolean;
}
export type OrganizationSelectionRequest = {
  source: { kind: 'favorites' } | { kind: 'playlist'; playlistId: string };
};
export type OrganizationSelectionSource =
  { kind: 'favorites' } | { kind: 'playlist'; playlistId: string; name: string };
export interface OrganizationSelectionItem {
  trackId: string;
  title: string;
  artist: string | null;
  album: string | null;
  occurrenceIndexes: number[];
}
export interface OrganizationSelection {
  schemaVersion: 1;
  capturedAt: number;
  source: OrganizationSelectionSource;
  selectionRevision: string;
  occurrenceCount: number;
  uniqueTrackCount: number;
  items: OrganizationSelectionItem[];
}
export interface UnorganizedSelectionRequest {
  schemaVersion: 1;
}
export interface UnorganizedSelectionSummary {
  total: number;
  organized: number;
  needsOrganization: number;
  processing: number;
  attention: number;
  unknown: number;
}
export interface UnorganizedSelectionItem {
  mediaLinkId: string;
  trackId: string;
  title: string;
  artist: string | null;
  album: string | null;
}
export interface UnorganizedSelectionPage {
  schemaVersion: 1;
  selectionId: string;
  capturedAt: number;
  expiresAt: number;
  inventoryRevision: string;
  completeCoverage: true;
  summary: UnorganizedSelectionSummary;
  items: UnorganizedSelectionItem[];
  nextCursor: string | null;
}
export interface OrganizationReferencePlaylist {
  id: string;
  name: string;
  owner: string;
  songIds: string[];
}
export interface OrganizationReferenceSnapshot {
  schemaVersion: 1;
  trackId: string;
  starred: boolean;
  playlists: OrganizationReferencePlaylist[];
}
export interface OrganizationReferenceRestoreRequest {
  trackId: string;
  newTrackId: string;
  starred: boolean;
  playlists: OrganizationReferencePlaylist[];
}
export interface OrganizationReferenceRestore {
  schemaVersion: 1;
  trackId: string;
  newTrackId: string;
  starred: boolean;
  playlistsRestored: number;
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
const selectionSourceRequest = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      properties: { kind: { const: 'favorites' } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'playlistId'],
      properties: { kind: { const: 'playlist' }, playlistId: id },
    },
  ],
} as const;
const selectionSourceResponse = {
  oneOf: [
    selectionSourceRequest.oneOf[0],
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'playlistId', 'name'],
      properties: { kind: { const: 'playlist' }, playlistId: id, name: text },
    },
  ],
} as const;
const selectionItem = {
  type: 'object',
  additionalProperties: false,
  required: ['trackId', 'title', 'artist', 'album', 'occurrenceIndexes'],
  properties: {
    trackId: id,
    title: text,
    artist: { anyOf: [text, { type: 'null' }] },
    album: { anyOf: [text, { type: 'null' }] },
    occurrenceIndexes: {
      type: 'array',
      minItems: 1,
      maxItems: 1000,
      uniqueItems: true,
      items: { type: 'integer', minimum: 0, maximum: 999 },
    },
  },
} as const;
const unorganizedSelectionSummary = {
  type: 'object',
  additionalProperties: false,
  required: ['total', 'organized', 'needsOrganization', 'processing', 'attention', 'unknown'],
  properties: Object.fromEntries(
    ['total', 'organized', 'needsOrganization', 'processing', 'attention', 'unknown'].map((key) => [
      key,
      { type: 'integer', minimum: 0 },
    ]),
  ),
} as const;
const unorganizedSelectionItem = {
  type: 'object',
  additionalProperties: false,
  required: ['mediaLinkId', 'trackId', 'title', 'artist', 'album'],
  properties: {
    mediaLinkId: id,
    trackId: id,
    title: text,
    artist: { anyOf: [text, { type: 'null' }] },
    album: { anyOf: [text, { type: 'null' }] },
  },
} as const;
const referencePlaylist = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'owner', 'songIds'],
  properties: {
    id,
    name: text,
    owner: id,
    songIds: { type: 'array', maxItems: 100000, items: id },
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
const organizationStatusTarget = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'trackId'],
      properties: { kind: { const: 'track' }, trackId: id },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'mediaLinkId'],
      properties: { kind: { const: 'media_link' }, mediaLinkId: id },
    },
  ],
} as const;
const organizationStatusItem = {
  type: 'object',
  additionalProperties: false,
  required: ['target', 'state', 'reason', 'stage', 'changedAt'],
  properties: {
    target: organizationStatusTarget,
    state: { enum: organizationStates },
    reason: { enum: organizationStateReasons },
    stage: { enum: [...organizationStages, null] },
    changedAt: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
  },
} as const;
export const organizationRequestSchemas = {
  empty,
  params,
  selection: {
    type: 'object',
    additionalProperties: false,
    required: ['source'],
    properties: { source: selectionSourceRequest },
  },
  unorganizedSelection: {
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion'],
    properties: { schemaVersion: { const: 1 } },
  },
  unorganizedSelectionPage: {
    type: 'object',
    additionalProperties: false,
    required: ['cursor'],
    properties: {
      cursor: { type: 'string', minLength: 1, maxLength: 2048 },
      limit: { type: 'string', pattern: '^(?:[1-9]|[1-9][0-9]|100)$' },
    },
  },
  referenceSnapshot: {
    type: 'object',
    additionalProperties: false,
    required: ['trackId'],
    properties: { trackId: id },
  },
  referenceRestore: {
    type: 'object',
    additionalProperties: false,
    required: ['trackId', 'newTrackId', 'starred', 'playlists'],
    properties: {
      trackId: id,
      newTrackId: id,
      starred: { type: 'boolean' },
      playlists: { type: 'array', maxItems: 1000, items: referencePlaylist },
    },
  },
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
  targetReplacement: {
    type: 'object',
    additionalProperties: false,
    required: [
      'operationId',
      'displacedTrackId',
      'backupReceiptDigest',
      'referenceSnapshotDigests',
    ],
    properties: {
      operationId: { type: 'string', minLength: 21, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' },
      displacedTrackId: id,
      backupReceiptDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      referenceSnapshotDigests: {
        type: 'array',
        minItems: 1,
        maxItems: 16,
        uniqueItems: true,
        items: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      },
    },
  },
  statuses: {
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'targets'],
    properties: {
      schemaVersion: { const: 1 },
      targets: {
        type: 'array',
        minItems: 1,
        maxItems: 100,
        uniqueItems: true,
        items: organizationStatusTarget,
      },
    },
  },
} as const;
export const organizationResponseSchemas = {
  selection: {
    type: 'object',
    additionalProperties: false,
    required: [
      'schemaVersion',
      'capturedAt',
      'source',
      'selectionRevision',
      'occurrenceCount',
      'uniqueTrackCount',
      'items',
    ],
    properties: {
      schemaVersion: { const: 1 },
      capturedAt: { type: 'integer', minimum: 0 },
      source: selectionSourceResponse,
      selectionRevision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      occurrenceCount: { type: 'integer', minimum: 0, maximum: 1000 },
      uniqueTrackCount: { type: 'integer', minimum: 0, maximum: 1000 },
      items: { type: 'array', maxItems: 1000, items: selectionItem },
    },
  },
  unorganizedSelection: {
    type: 'object',
    additionalProperties: false,
    required: [
      'schemaVersion',
      'selectionId',
      'capturedAt',
      'expiresAt',
      'inventoryRevision',
      'completeCoverage',
      'summary',
      'items',
      'nextCursor',
    ],
    properties: {
      schemaVersion: { const: 1 },
      selectionId: id,
      capturedAt: { type: 'integer', minimum: 0 },
      expiresAt: { type: 'integer', minimum: 1 },
      inventoryRevision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      completeCoverage: { const: true },
      summary: unorganizedSelectionSummary,
      items: { type: 'array', maxItems: 100, items: unorganizedSelectionItem },
      nextCursor: {
        anyOf: [{ type: 'string', minLength: 1, maxLength: 2048 }, { type: 'null' }],
      },
    },
  },
  referenceSnapshot: {
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'trackId', 'starred', 'playlists'],
    properties: {
      schemaVersion: { const: 1 },
      trackId: id,
      starred: { type: 'boolean' },
      playlists: { type: 'array', maxItems: 1000, items: referencePlaylist },
    },
  },
  referenceRestore: {
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'trackId', 'newTrackId', 'starred', 'playlistsRestored'],
    properties: {
      schemaVersion: { const: 1 },
      trackId: id,
      newTrackId: id,
      starred: { type: 'boolean' },
      playlistsRestored: { type: 'integer', minimum: 0, maximum: 1000 },
    },
  },
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
  statuses: {
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'capturedAt', 'items'],
    properties: {
      schemaVersion: { const: 1 },
      capturedAt: { type: 'integer', minimum: 0 },
      items: { type: 'array', maxItems: 100, items: organizationStatusItem },
    },
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
function decodeOrganizationStatusTarget(value: unknown): OrganizationStatusTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid organization status target');
  const target = value as Record<string, unknown>;
  if (target.kind === 'track') {
    const row = record(target, ['kind', 'trackId']);
    if (!nonempty(row.trackId)) throw new Error('Invalid organization status target');
    return { kind: 'track', trackId: row.trackId };
  }
  if (target.kind === 'media_link') {
    const row = record(target, ['kind', 'mediaLinkId']);
    if (!nonempty(row.mediaLinkId)) throw new Error('Invalid organization status target');
    return { kind: 'media_link', mediaLinkId: row.mediaLinkId };
  }
  throw new Error('Invalid organization status target');
}

function organizationStatusTargetKey(target: OrganizationStatusTarget) {
  return target.kind === 'track' ? `track:${target.trackId}` : `media_link:${target.mediaLinkId}`;
}
function decodeOrganizationSelectionSource(value: unknown): OrganizationSelectionSource {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid organization response');
  const source = value as Record<string, unknown>;
  if (source.kind === 'favorites') {
    if (Object.keys(source).length !== 1) throw new Error('Invalid organization response');
    return { kind: 'favorites' };
  }
  if (
    source.kind !== 'playlist' ||
    Object.keys(source).length !== 3 ||
    !nonempty(source.playlistId) ||
    !nonempty(source.name)
  )
    throw new Error('Invalid organization response');
  return { kind: 'playlist', playlistId: source.playlistId, name: source.name };
}
export function decodeOrganizationSelection(value: unknown): OrganizationSelection {
  const row = record(value, [
    'schemaVersion',
    'capturedAt',
    'source',
    'selectionRevision',
    'occurrenceCount',
    'uniqueTrackCount',
    'items',
  ]);
  if (
    row.schemaVersion !== 1 ||
    !Number.isSafeInteger(row.capturedAt) ||
    Number(row.capturedAt) < 0 ||
    typeof row.selectionRevision !== 'string' ||
    !/^[a-f0-9]{64}$/.test(row.selectionRevision) ||
    !Number.isSafeInteger(row.occurrenceCount) ||
    Number(row.occurrenceCount) < 0 ||
    Number(row.occurrenceCount) > 1000 ||
    !Number.isSafeInteger(row.uniqueTrackCount) ||
    Number(row.uniqueTrackCount) < 0 ||
    Number(row.uniqueTrackCount) > 1000 ||
    !Array.isArray(row.items) ||
    row.items.length !== row.uniqueTrackCount
  )
    throw new Error('Invalid organization response');
  const seenTracks = new Set<string>();
  const seenOccurrences = new Set<number>();
  let previousFirst = -1;
  const items = row.items.map((value) => {
    const item = record(value, ['trackId', 'title', 'artist', 'album', 'occurrenceIndexes']);
    if (
      !nonempty(item.trackId) ||
      seenTracks.has(item.trackId) ||
      !nonempty(item.title) ||
      !(item.artist === null || nonempty(item.artist)) ||
      !(item.album === null || nonempty(item.album)) ||
      !Array.isArray(item.occurrenceIndexes) ||
      item.occurrenceIndexes.length === 0 ||
      item.occurrenceIndexes.some(
        (index, position) =>
          !Number.isSafeInteger(index) ||
          Number(index) < 0 ||
          Number(index) >= Number(row.occurrenceCount) ||
          (position > 0 &&
            Number(index) <= Number((item.occurrenceIndexes as unknown[])[position - 1])) ||
          seenOccurrences.has(Number(index)),
      ) ||
      Number(item.occurrenceIndexes[0]) <= previousFirst
    )
      throw new Error('Invalid organization response');
    seenTracks.add(item.trackId);
    for (const index of item.occurrenceIndexes) seenOccurrences.add(Number(index));
    previousFirst = Number(item.occurrenceIndexes[0]);
    return item as unknown as OrganizationSelectionItem;
  });
  if (seenOccurrences.size !== row.occurrenceCount)
    throw new Error('Invalid organization response');
  return {
    schemaVersion: 1,
    capturedAt: Number(row.capturedAt),
    source: decodeOrganizationSelectionSource(row.source),
    selectionRevision: row.selectionRevision,
    occurrenceCount: Number(row.occurrenceCount),
    uniqueTrackCount: Number(row.uniqueTrackCount),
    items,
  };
}
export function decodeUnorganizedSelectionRequest(value: unknown): UnorganizedSelectionRequest {
  const row = record(value, ['schemaVersion']);
  if (row.schemaVersion !== 1) throw new Error('Invalid unorganized selection request');
  return { schemaVersion: 1 };
}

export function decodeUnorganizedSelectionPage(value: unknown): UnorganizedSelectionPage {
  const row = record(value, [
    'schemaVersion',
    'selectionId',
    'capturedAt',
    'expiresAt',
    'inventoryRevision',
    'completeCoverage',
    'summary',
    'items',
    'nextCursor',
  ]);
  const summary = record(row.summary, [
    'total',
    'organized',
    'needsOrganization',
    'processing',
    'attention',
    'unknown',
  ]);
  const counts: unknown[] = [
    summary.organized,
    summary.needsOrganization,
    summary.processing,
    summary.attention,
    summary.unknown,
  ];
  if (
    row.schemaVersion !== 1 ||
    !nonempty(row.selectionId) ||
    !Number.isSafeInteger(row.capturedAt) ||
    Number(row.capturedAt) < 0 ||
    !Number.isSafeInteger(row.expiresAt) ||
    Number(row.expiresAt) <= Number(row.capturedAt) ||
    typeof row.inventoryRevision !== 'string' ||
    !/^[a-f0-9]{64}$/.test(row.inventoryRevision) ||
    row.completeCoverage !== true ||
    !Number.isSafeInteger(summary.total) ||
    Number(summary.total) < 0 ||
    counts.some((count) => !Number.isSafeInteger(count) || Number(count) < 0) ||
    counts.map(Number).reduce((total, count) => total + count, 0) !== Number(summary.total) ||
    !Array.isArray(row.items) ||
    row.items.length > 100 ||
    !(row.nextCursor === null || (nonempty(row.nextCursor) && row.nextCursor.length <= 2048))
  )
    throw new Error('Invalid unorganized selection response');
  const seen = new Set<string>();
  const items = row.items.map((value) => {
    const item = record(value, ['mediaLinkId', 'trackId', 'title', 'artist', 'album']);
    if (
      !nonempty(item.mediaLinkId) ||
      seen.has(item.mediaLinkId) ||
      !nonempty(item.trackId) ||
      !nonempty(item.title) ||
      !(item.artist === null || nonempty(item.artist)) ||
      !(item.album === null || nonempty(item.album))
    )
      throw new Error('Invalid unorganized selection response');
    seen.add(item.mediaLinkId);
    return item as unknown as UnorganizedSelectionItem;
  });
  if (items.length > Number(summary.needsOrganization))
    throw new Error('Invalid unorganized selection response');
  return {
    schemaVersion: 1,
    selectionId: row.selectionId,
    capturedAt: Number(row.capturedAt),
    expiresAt: Number(row.expiresAt),
    inventoryRevision: row.inventoryRevision,
    completeCoverage: true,
    summary: summary as unknown as UnorganizedSelectionSummary,
    items,
    nextCursor: row.nextCursor as string | null,
  };
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

export function decodeOrganizationStatusRequest(value: unknown): OrganizationStatusRequest {
  const row = record(value, ['schemaVersion', 'targets']);
  if (
    row.schemaVersion !== 1 ||
    !Array.isArray(row.targets) ||
    row.targets.length < 1 ||
    row.targets.length > 100
  )
    throw new Error('Invalid organization status request');
  const targets = row.targets.map(decodeOrganizationStatusTarget);
  if (new Set(targets.map(organizationStatusTargetKey)).size !== targets.length)
    throw new Error('Invalid organization status request');
  return { schemaVersion: 1, targets };
}

function isOrganizationStatusCombination(
  state: OrganizationState,
  reason: OrganizationStateReason,
  stage: OrganizationStage | null,
) {
  if (state === 'organized') return reason === 'verified' && stage === 'succeeded';
  if (state === 'needs_organization')
    return (
      (reason === 'never_organized' && stage === null) ||
      ((['path_metadata_changed', 'path_binding_changed', 'policy_changed'] as const).includes(
        reason as 'path_metadata_changed',
      ) &&
        stage === 'succeeded')
    );
  if (state === 'processing')
    return (
      reason === 'job_active' &&
      stage !== null &&
      !['succeeded', 'failed', 'conflict', 'recovery_required'].includes(stage)
    );
  if (state === 'attention')
    return (
      (reason === 'job_failed' && stage === 'failed') ||
      (reason === 'job_conflict' && stage === 'conflict') ||
      (reason === 'recovery_required' && stage === 'recovery_required')
    );
  return (
    (reason === 'identity_unavailable' && stage === null) ||
    (reason === 'verification_missing' && stage === 'succeeded')
  );
}

export function decodeOrganizationStatusResponse(value: unknown): OrganizationStatusResponse {
  const row = record(value, ['schemaVersion', 'capturedAt', 'items']);
  if (
    row.schemaVersion !== 1 ||
    !Number.isSafeInteger(row.capturedAt) ||
    Number(row.capturedAt) < 0 ||
    !Array.isArray(row.items) ||
    row.items.length > 100
  )
    throw new Error('Invalid organization status response');
  const items = row.items.map((value) => {
    const item = record(value, ['target', 'state', 'reason', 'stage', 'changedAt']);
    const target = decodeOrganizationStatusTarget(item.target);
    if (
      !organizationStates.includes(item.state as OrganizationState) ||
      !organizationStateReasons.includes(item.reason as OrganizationStateReason) ||
      !(item.stage === null || organizationStages.includes(item.stage as OrganizationStage)) ||
      !(
        item.changedAt === null ||
        (Number.isSafeInteger(item.changedAt) && Number(item.changedAt) >= 0)
      ) ||
      !isOrganizationStatusCombination(
        item.state as OrganizationState,
        item.reason as OrganizationStateReason,
        item.stage as OrganizationStage | null,
      )
    )
      throw new Error('Invalid organization status response');
    return {
      target,
      state: item.state,
      reason: item.reason,
      stage: item.stage,
      changedAt: item.changedAt,
    } as OrganizationStatusItem;
  });
  if (new Set(items.map((item) => organizationStatusTargetKey(item.target))).size !== items.length)
    throw new Error('Invalid organization status response');
  return { schemaVersion: 1, capturedAt: Number(row.capturedAt), items };
}

export function mapOrganizationState(
  facts: OrganizationStateFacts,
): Pick<OrganizationStatusItem, 'state' | 'reason'> {
  if (!facts.identityAvailable) return { state: 'unknown', reason: 'identity_unavailable' };
  if (facts.stage === null) return { state: 'needs_organization', reason: 'never_organized' };
  switch (facts.stage) {
    case 'queued':
    case 'validating':
    case 'references_captured':
    case 'moving':
    case 'moved':
    case 'scanning':
    case 'rebound':
    case 'migrating_references':
    case 'verifying':
      return { state: 'processing', reason: 'job_active' };
    case 'failed':
      return { state: 'attention', reason: 'job_failed' };
    case 'conflict':
      return { state: 'attention', reason: 'job_conflict' };
    case 'recovery_required':
      return { state: 'attention', reason: 'recovery_required' };
    case 'succeeded':
      if (!facts.verificationComplete) return { state: 'unknown', reason: 'verification_missing' };
      if (facts.pathMetadataChanged)
        return { state: 'needs_organization', reason: 'path_metadata_changed' };
      if (!facts.bindingMatches)
        return { state: 'needs_organization', reason: 'path_binding_changed' };
      if (!facts.policyMatches) return { state: 'needs_organization', reason: 'policy_changed' };
      return { state: 'organized', reason: 'verified' };
  }
}
