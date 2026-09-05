import type { SubsonicErrorKind } from '@musiclatte/contracts';

/** Safe for diagnostics: no upstream messages, URLs, credentials, bodies or original causes. */
export class SubsonicError extends Error {
  readonly capability = 'unknown';
  constructor(readonly kind: SubsonicErrorKind, readonly code?: number, readonly httpStatus?: number) {
    super(kind);
    this.name = 'SubsonicError';
  }
}
export function standardError(code: number): SubsonicError {
  const kinds: Partial<Record<number, SubsonicErrorKind>> = {
    10: 'invalid_request', 20: 'protocol_incompatible', 30: 'protocol_incompatible',
    40: 'authentication', 41: 'token_auth_unsupported', 50: 'forbidden', 70: 'not_found',
  };
  return new SubsonicError(kinds[code] ?? 'upstream_error', code);
}
