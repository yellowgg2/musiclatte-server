export const curationFailureReasons = [
  'required_fields_missing',
  'revision_conflict',
  'policy_changed',
  'claim_expired',
  'claimed_by_other',
  'pending_job',
  'failed_job',
  'reflection_pending',
  'file_unavailable',
  'identity_changed',
] as const;
export type CurationFailureReason = (typeof curationFailureReasons)[number];
export const mixFailureReasons = ['mix_scope_unavailable'] as const;
export type ApiFailureReason = CurationFailureReason | (typeof mixFailureReasons)[number];
export const apiErrorCodes = [
  'playback_plan_changed',
  'invalid_request',
  'unauthenticated',
  'forbidden',
  'csrf_rejected',
  'token_auth_unsupported',
  'upstream_unavailable',
  'upstream_incompatible',
  'storage_unavailable',
  'not_found',
  'conflict',
  'snapshot_expired',
  'snapshot_scope_changed',
  'snapshot_capacity',
  'outcome_unknown',
  'internal_error',
] as const;
export type ApiErrorCode = (typeof apiErrorCodes)[number];
export interface ApiErrorResponse {
  schemaVersion: 1;
  error: { code: ApiErrorCode; retryable: boolean; reason?: ApiFailureReason };
}
export const apiErrorSchema = {
  type: 'object',
  required: ['schemaVersion', 'error'],
  additionalProperties: false,
  properties: {
    schemaVersion: { const: 1 },
    error: {
      type: 'object',
      required: ['code', 'retryable'],
      additionalProperties: false,
      properties: {
        code: { type: 'string', enum: apiErrorCodes },
        retryable: { type: 'boolean' },
        reason: { type: 'string', enum: [...curationFailureReasons, ...mixFailureReasons] },
      },
    },
  },
} as const;
