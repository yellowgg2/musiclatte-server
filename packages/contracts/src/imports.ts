import { playlistMutationSchemas } from './collections.js';

export const importStages = [
  'queued',
  'resolving',
  'downloading',
  'postprocessing',
  'publishing',
  'registering',
  'ready',
  'failed',
  'cancelled',
  'duplicate',
] as const;
export type ImportStage = (typeof importStages)[number];
export const importFailureCodes = [
  'invalid_metadata',
  'invalid_media',
  'file_conflict',
  'invalid_file_key',
  'download_failed',
  'process_aborted',
  'process_output_limit',
  'process_spawn_failed',
  'process_cleanup_failed',
  'publish_failed',
  'publish_uncertain',
  'worker_interrupted',
  'invalid_engine',
] as const;
export type ImportFailureCode = (typeof importFailureCodes)[number];
export interface ImportLibrary {
  id: string;
}
export interface ImportItem {
  id: string;
  sourceId: string;
  stage: ImportStage;
  title?: string;
  channel?: string;
  failureCode?: ImportFailureCode;
  mediaLinkId?: string;
  duplicate?: { kind: 'item' | 'media'; id: string };
}
export interface ImportJob {
  id: string;
  libraryId: string;
  createdAt: number;
  cancelRequestedAt: number | null;
  retryOfJobId: string | null;
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
  items: ImportItem[];
}
export interface ImportDetailResponse {
  schemaVersion: 1;
  job: ImportJob;
}
export interface ImportListResponse {
  schemaVersion: 1;
  jobs: ImportJob[];
  libraries: ImportLibrary[];
  nextCursor: string | null;
}
export interface ImportCreateRequest {
  operationId: string;
  libraryId: string;
  urls: string[];
}
export interface ImportRetryRequest {
  operationId: string;
  itemIds: string[];
}
export interface ImportListQuery {
  cursor?: string;
  limit?: string;
}
const object = <T>(required: string[], properties: T) =>
  ({ type: 'object', additionalProperties: false, required, properties }) as const;
const text = { type: 'string', minLength: 1 } as const;
const id = {
  type: 'string',
  minLength: 1,
  maxLength: 1024,
  pattern: '^[A-Za-z0-9_.:-]+$',
} as const;
const timestamp = { type: 'integer', minimum: 0 } as const;
const nullableId = { anyOf: [id, { type: 'null' }] } as const;
const item = object(['id', 'sourceId', 'stage'], {
  id,
  sourceId: { type: 'string', pattern: '^[A-Za-z0-9_-]{11}$' },
  stage: { type: 'string', enum: importStages },
  title: text,
  channel: text,
  failureCode: { type: 'string', enum: importFailureCodes },
  mediaLinkId: id,
  duplicate: object(['kind', 'id'], { kind: { enum: ['item', 'media'] }, id }),
});
const job = object(
  ['id', 'libraryId', 'createdAt', 'cancelRequestedAt', 'retryOfJobId', 'status', 'items'],
  {
    id,
    libraryId: text,
    createdAt: timestamp,
    cancelRequestedAt: { anyOf: [timestamp, { type: 'null' }] },
    retryOfJobId: nullableId,
    status: { enum: ['queued', 'running', 'completed', 'partial', 'failed', 'cancelled'] },
    items: { type: 'array', items: item },
  },
);
export const importRequestSchemas = {
  empty: object([], {}),
  params: object(['id'], { id }),
  list: object([], {
    cursor: { type: 'string', minLength: 1, maxLength: 4096 },
    limit: { type: 'string', pattern: '^(?:[1-9]|[1-9][0-9]|100)$' },
  }),
  create: object(['operationId', 'libraryId', 'urls'], {
    operationId: playlistMutationSchemas.create.properties.operationId,
    libraryId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,128}$' },
    urls: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1, maxLength: 2048 } },
  }),
  retry: object(['operationId', 'itemIds'], {
    operationId: playlistMutationSchemas.create.properties.operationId,
    itemIds: { type: 'array', minItems: 1, uniqueItems: true, items: id },
  }),
} as const;
export const importResponseSchemas = {
  detail: object(['schemaVersion', 'job'], { schemaVersion: { const: 1 }, job }),
  list: object(['schemaVersion', 'jobs', 'libraries', 'nextCursor'], {
    schemaVersion: { const: 1 },
    jobs: { type: 'array', items: job },
    libraries: { type: 'array', items: object(['id'], { id: text }) },
    nextCursor: { anyOf: [text, { type: 'null' }] },
  }),
} as const;
