/** Engine management exposes selection metadata, never an executable or arbitrary command. */
export const enginePublicStatuses = [
  'never_checked',
  'checking',
  'up_to_date',
  'candidate_pending_validation',
  'active',
  'update_failed',
  'validation_failed',
  'restored',
] as const;
export type EngineActionRequest = { action: 'check_now' } | { action: 'restore_previous' };
export interface EngineStatusResponse {
  schemaVersion: 1;
  channel: 'nightly';
  activeVersion: string | null;
  candidateVersion: string | null;
  previousVersion: string | null;
  lastCheckedAt: number | null;
  lastSuccessfulCheckAt: number | null;
  status: (typeof enginePublicStatuses)[number];
  recoverability: 'available' | 'no_previous' | 'temporarily_unavailable';
}
const object = <T>(required: string[], properties: T) =>
  ({ type: 'object', additionalProperties: false, required, properties }) as const;
export const engineActionSchema = {
  oneOf: [
    object(['action'], { action: { const: 'check_now' } }),
    object(['action'], { action: { const: 'restore_previous' } }),
  ],
} as const;
const version = {
  anyOf: [{ type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' }, { type: 'null' }],
} as const;
const instant = {
  anyOf: [{ type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, { type: 'null' }],
} as const;
export const engineEmptySchema = object([], {});
export const engineStatusSchema = object(
  [
    'schemaVersion',
    'channel',
    'activeVersion',
    'candidateVersion',
    'previousVersion',
    'lastCheckedAt',
    'lastSuccessfulCheckAt',
    'status',
    'recoverability',
  ],
  {
    schemaVersion: { const: 1 },
    channel: { const: 'nightly' },
    activeVersion: version,
    candidateVersion: version,
    previousVersion: version,
    lastCheckedAt: instant,
    lastSuccessfulCheckAt: instant,
    status: { enum: enginePublicStatuses },
    recoverability: { enum: ['available', 'no_previous', 'temporarily_unavailable'] },
  },
);
