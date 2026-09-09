import {
  metadataRequestSchemas,
  decodeMetadataJob,
  metadataFields,
  type MetadataJob,
  type MetadataJobRequest,
  type MetadataField,
} from './metadata.js';
import {
  curationRecord,
  decodeFieldState,
  type ClaimPurpose,
  type OptionalCurationField,
  type FieldState,
} from './curation.js';
export interface AutomationJobRequest extends MetadataJobRequest {
  automation: {
    claimId: string;
    claimGeneration: number;
    purpose: ClaimPurpose;
    sourceNotes: string | null;
  };
  dryRun: boolean;
}
export const automationFailureReasons = [
  'not_found',
  'revision_conflict',
  'claim_conflict',
  'file_busy',
  'inventory_pending',
  'invalid_metadata',
  'permission_changed',
  'unsupported_format',
] as const;
export type AutomationFailureReason = (typeof automationFailureReasons)[number];
export interface AutomationDiff {
  field: MetadataField;
  op: 'set' | 'clear';
  before: string[];
  after: string[];
  status: 'changed' | 'no_change';
}
export interface AutomationDryRun {
  schemaVersion: 1;
  dryRun: true;
  writeGuaranteed: false;
  results: {
    trackId: string;
    status: 'changed' | 'no_change' | 'rejected';
    diff: AutomationDiff[];
    reason?: AutomationFailureReason;
  }[];
}
export interface AutomationAdmission {
  trackId: string;
  status: 'accepted' | 'rejected';
  jobItemId: string | null;
  reason?: AutomationFailureReason;
}
export interface AutomationJobResponse {
  schemaVersion: 1;
  job: MetadataJob | null;
  admissionResults: AutomationAdmission[];
}
export interface MetadataAttemptRequest {
  operationId: string;
  claimId: string;
  claimGeneration: number;
  expectedRevision: string;
  field: OptionalCurationField;
  status: 'unavailable' | 'not_applicable';
  reason: string;
  sourceNotes: string | null;
}
const notes = { anyOf: [{ type: 'string', maxLength: 4096 }, { type: 'null' }] } as const;
const claimProperties = {
  claimId: { type: 'string', minLength: 1, maxLength: 1024 },
  claimGeneration: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
} as const;
const base = metadataRequestSchemas.create;
export const automationJobRequestSchema = {
  ...base,
  required: [...base.required, 'automation', 'dryRun'],
  properties: {
    ...base.properties,
    automation: {
      type: 'object',
      additionalProperties: false,
      required: ['claimId', 'claimGeneration', 'purpose', 'sourceNotes'],
      properties: {
        ...claimProperties,
        purpose: { enum: ['required_review', 'optional_enrichment'] },
        sourceNotes: notes,
      },
    },
    dryRun: { type: 'boolean' },
  },
} as const;
export const metadataAttemptRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'operationId',
    'claimId',
    'claimGeneration',
    'expectedRevision',
    'field',
    'status',
    'reason',
    'sourceNotes',
  ],
  properties: {
    ...claimProperties,
    operationId: base.properties.operationId,
    expectedRevision: base.properties.targets.items.properties.expectedRevision,
    field: { enum: ['album', 'cover', 'lyrics'] },
    status: { enum: ['unavailable', 'not_applicable'] },
    reason: { type: 'string', minLength: 1, maxLength: 4096, pattern: '\\S' },
    sourceNotes: notes,
  },
} as const;
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
function reason(v: Record<string, unknown>) {
  if (
    v.reason !== undefined &&
    !automationFailureReasons.includes(v.reason as AutomationFailureReason)
  )
    throw new Error('Invalid automation reason');
}
export function decodeAutomationDiff(value: unknown): AutomationDiff {
  const v = curationRecord(value, ['field', 'op', 'before', 'after', 'status']);
  if (
    !metadataFields.includes(v.field as MetadataField) ||
    !['set', 'clear'].includes(String(v.op)) ||
    !['changed', 'no_change'].includes(String(v.status)) ||
    ![v.before, v.after].every((a) => Array.isArray(a) && a.every((x) => typeof x === 'string'))
  )
    throw new Error('Invalid automation diff');
  return v as unknown as AutomationDiff;
}
export function decodeAutomationDryRun(value: unknown): AutomationDryRun {
  const v = curationRecord(value, ['schemaVersion', 'dryRun', 'writeGuaranteed', 'results']);
  if (
    v.schemaVersion !== 1 ||
    v.dryRun !== true ||
    v.writeGuaranteed !== false ||
    !Array.isArray(v.results) ||
    !v.results.length
  )
    throw new Error('Invalid automation preview');
  for (const entry of v.results) {
    const r = curationRecord(entry, [
      'trackId',
      'status',
      'diff',
      ...(Object.hasOwn(entry, 'reason') ? ['reason'] : []),
    ]);
    reason(r);
    if (
      !text(r.trackId) ||
      !['changed', 'no_change', 'rejected'].includes(String(r.status)) ||
      !Array.isArray(r.diff) ||
      (r.status === 'rejected') !== (r.reason !== undefined)
    )
      throw new Error('Invalid automation preview');
    const diff = r.diff.map(decodeAutomationDiff);
    if (
      r.status === 'rejected'
        ? diff.length !== 0
        : !diff.length || (r.status === 'no_change') !== diff.every((d) => d.status === 'no_change')
    )
      throw new Error('Invalid automation preview');
  }
  return v as unknown as AutomationDryRun;
}
export function decodeAutomationJobResponse(value: unknown): AutomationJobResponse {
  const v = curationRecord(value, ['schemaVersion', 'job', 'admissionResults']);
  if (v.schemaVersion !== 1 || !Array.isArray(v.admissionResults) || !v.admissionResults.length)
    throw new Error('Invalid automation job');
  const job = v.job === null ? null : decodeMetadataJob(v.job);
  for (const entry of v.admissionResults) {
    const r = curationRecord(entry, [
      'trackId',
      'status',
      'jobItemId',
      ...(Object.hasOwn(entry, 'reason') ? ['reason'] : []),
    ]);
    reason(r);
    if (
      !text(r.trackId) ||
      !['accepted', 'rejected'].includes(String(r.status)) ||
      (r.status === 'accepted'
        ? !text(r.jobItemId) ||
          r.reason !== undefined ||
          !job?.items.some((i) => i.itemId === r.jobItemId)
        : r.jobItemId !== null || r.reason === undefined)
    )
      throw new Error('Invalid automation admission');
  }
  if (
    (job !== null) !==
    v.admissionResults.some((r: AutomationAdmission) => r.status === 'accepted')
  )
    throw new Error('Invalid automation job');
  const admitted = v.admissionResults.filter((r: AutomationAdmission) => r.status === 'accepted');
  if (
    new Set(v.admissionResults.map((r: AutomationAdmission) => r.trackId)).size !==
      v.admissionResults.length ||
    new Set(admitted.map((r: AutomationAdmission) => r.jobItemId)).size !== admitted.length ||
    admitted.length !== (job?.items.length ?? 0)
  )
    throw new Error('Invalid automation admission');
  return { ...v, job } as AutomationJobResponse;
}
export function decodeMetadataAttemptResponse(value: unknown): {
  schemaVersion: 1;
  trackId: string;
  field: OptionalCurationField;
  fieldState: FieldState;
} {
  const v = curationRecord(value, ['schemaVersion', 'trackId', 'field', 'fieldState']);
  if (
    v.schemaVersion !== 1 ||
    !text(v.trackId) ||
    !['album', 'cover', 'lyrics'].includes(String(v.field))
  )
    throw new Error('Invalid metadata attempt');
  if (!['unavailable', 'not_applicable'].includes(decodeFieldState(v.fieldState).status))
    throw new Error('Invalid metadata attempt');
  return v as unknown as {
    schemaVersion: 1;
    trackId: string;
    field: OptionalCurationField;
    fieldState: FieldState;
  };
}
