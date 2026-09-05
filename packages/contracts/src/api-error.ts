export const apiErrorCodes = [
  'invalid_request',
  'unauthenticated',
  'forbidden',
  'csrf_rejected',
  'token_auth_unsupported',
  'upstream_unavailable',
  'upstream_incompatible',
  'storage_unavailable',
  'not_found',
  'internal_error',
] as const;
export type ApiErrorCode = (typeof apiErrorCodes)[number];
export interface ApiErrorResponse {
  schemaVersion: 1;
  error: { code: ApiErrorCode; retryable: boolean };
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
      properties: { code: { type: 'string', enum: apiErrorCodes }, retryable: { type: 'boolean' } },
    },
  },
} as const;
