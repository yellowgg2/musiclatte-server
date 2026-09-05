export type SessionExchange = { kind: 'password'; username: string; password: string } | { kind: 'subsonic-token'; username: string; t: string; s: string };
export type AuthScheme = 'cookie' | 'bearer';
export interface SessionResponse { schemaVersion: 1; username: string; authScheme: AuthScheme; expiresAt: number; csrfToken?: string; accessToken?: string }
const username = { type: 'string', minLength: 1, maxLength: 256 } as const;
export const sessionExchangeSchema = { oneOf: [
  { type: 'object', additionalProperties: false, required: ['kind', 'username', 'password'], properties: { kind: { const: 'password' }, username, password: { type: 'string', minLength: 1, maxLength: 4096 } } },
  { type: 'object', additionalProperties: false, required: ['kind', 'username', 't', 's'], properties: { kind: { const: 'subsonic-token' }, username, t: { type: 'string', pattern: '^[a-f0-9]{32}$' }, s: { type: 'string', minLength: 1, maxLength: 256 } } },
] } as const;
export const sessionResponseSchema = {
  type: 'object', additionalProperties: false, required: ['schemaVersion', 'username', 'authScheme', 'expiresAt'],
  properties: { schemaVersion: { const: 1 }, username, authScheme: { enum: ['cookie', 'bearer'] }, expiresAt: { type: 'integer', minimum: 1 }, csrfToken: { type: 'string' }, accessToken: { type: 'string' } },
} as const;
