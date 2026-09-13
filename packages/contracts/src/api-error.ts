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
  'inventory_incomplete',
  'selection_too_large',
  'outcome_unknown',
  'internal_error',
] as const;
export type ApiErrorCode = (typeof apiErrorCodes)[number];
export interface InventoryIncompleteDetails {
  libraries: Array<{
    libraryId: string;
    status: 'missing' | 'discovering' | 'partial' | 'stale' | 'error' | 'retry_pending';
  }>;
}
export type ApiErrorDetails = InventoryIncompleteDetails;
export interface ApiErrorResponse {
  schemaVersion: 1;
  error: {
    code: ApiErrorCode;
    retryable: boolean;
    reason?: ApiFailureReason;
    details?: ApiErrorDetails;
  };
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
        details: {
          type: 'object',
          additionalProperties: false,
          required: ['libraries'],
          properties: {
            libraries: {
              type: 'array',
              minItems: 1,
              maxItems: 100,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['libraryId', 'status'],
                properties: {
                  libraryId: { type: 'string', minLength: 1, maxLength: 256 },
                  status: {
                    enum: ['missing', 'discovering', 'partial', 'stale', 'error', 'retry_pending'],
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;
