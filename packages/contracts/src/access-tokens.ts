export const accessTokenScopes = [
  'metadata:read',
  'metadata:write',
  'lyrics:write',
  'curation:write',
  'media:organize',
  'collections:read',
] as const;
export type AccessTokenScope = (typeof accessTokenScopes)[number];
export interface AccessTokenRequest {
  name: string;
  scopes: AccessTokenScope[];
  libraryIds: string[];
  expiresAt: number;
}
export const accessTokenRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'scopes', 'libraryIds', 'expiresAt'],
  properties: {
    name: { type: 'string', minLength: 1 },
    scopes: {
      type: 'array',
      minItems: 1,
      maxItems: accessTokenScopes.length,
      uniqueItems: true,
      items: { enum: accessTokenScopes },
    },
    libraryIds: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
      items: { type: 'string', minLength: 1, maxLength: 256 },
    },
    expiresAt: { type: 'integer', minimum: 1 },
  },
} as const;
export interface AccessToken {
  id: string;
  name: string;
  scopes: AccessTokenScope[];
  libraryIds: string[];
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  lastUsedAt: number | null;
}
export function validateTokenScopes(value: unknown): AccessTokenScope[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    new Set(value).size !== value.length ||
    !value.every((scope): scope is AccessTokenScope => accessTokenScopes.includes(scope)) ||
    !value.includes('metadata:read') ||
    (value.includes('collections:read') && !value.includes('metadata:read')) ||
    (value.includes('lyrics:write') && !value.includes('metadata:write')) ||
    (value.includes('media:organize') &&
      (!value.includes('metadata:read') || !value.includes('metadata:write')))
  ) {
    throw new Error('Invalid token scopes');
  }
  return [...value].sort();
}
export function validateTokenLibraries(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 100 ||
    new Set(value).size !== value.length ||
    !value.every(
      (id): id is string =>
        typeof id === 'string' &&
        id.length > 0 &&
        id.length <= 256 &&
        !/[\u0000-\u001f\u007f]/u.test(id),
    )
  ) {
    throw new Error('Invalid token libraries');
  }
  return [...value].sort();
}
export function validateTokenName(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    [...value.trim()].length > 120 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    throw new Error('Invalid token name');
  return value.trim();
}
export function decodeAccessToken(value: unknown): AccessToken {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid access token');
  const row = value as Record<string, unknown>;
  const keys = [
    'id',
    'name',
    'scopes',
    'libraryIds',
    'createdAt',
    'expiresAt',
    'revokedAt',
    'lastUsedAt',
  ];
  const time = (v: unknown): v is number =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
  if (
    Object.keys(row).length !== keys.length ||
    Object.keys(row).some((key) => !keys.includes(key)) ||
    typeof row.id !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(row.id) ||
    !time(row.createdAt) ||
    !time(row.expiresAt) ||
    row.expiresAt <= row.createdAt ||
    !(row.revokedAt === null || time(row.revokedAt)) ||
    !(row.lastUsedAt === null || (time(row.lastUsedAt) && row.lastUsedAt >= row.createdAt))
  )
    throw new Error('Invalid access token');
  return {
    id: row.id,
    name: validateTokenName(row.name),
    scopes: validateTokenScopes(row.scopes),
    libraryIds: validateTokenLibraries(row.libraryIds),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    lastUsedAt: row.lastUsedAt,
  };
}
function responseRecord(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid token response');
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(record, key)) ||
    record.schemaVersion !== 1
  )
    throw new Error('Invalid token response');
  return record;
}
export function decodeAccessTokenCreated(value: unknown): {
  schemaVersion: 1;
  token: string;
  accessToken: AccessToken;
} {
  const row = responseRecord(value, ['schemaVersion', 'token', 'accessToken']);
  if (typeof row.token !== 'string' || !/^mlpat_[A-Za-z0-9_-]{43}$/.test(row.token))
    throw new Error('Invalid token response');
  return { schemaVersion: 1, token: row.token, accessToken: decodeAccessToken(row.accessToken) };
}
export function decodeAccessTokenList(value: unknown): {
  schemaVersion: 1;
  accessTokens: AccessToken[];
  total: number;
  nextCursor: string | null;
} {
  const row = responseRecord(value, ['schemaVersion', 'accessTokens', 'total', 'nextCursor']);
  if (
    !Array.isArray(row.accessTokens) ||
    row.accessTokens.length > 100 ||
    typeof row.total !== 'number' ||
    !Number.isSafeInteger(row.total) ||
    row.total < row.accessTokens.length ||
    !(
      row.nextCursor === null ||
      (typeof row.nextCursor === 'string' &&
        row.nextCursor.length > 0 &&
        row.nextCursor.length <= 2048)
    )
  )
    throw new Error('Invalid token response');
  return {
    schemaVersion: 1,
    accessTokens: row.accessTokens.map(decodeAccessToken),
    total: row.total,
    nextCursor: row.nextCursor,
  };
}

export interface AccessTokenOptions {
  schemaVersion: 1;
  now: number;
  maxTokenAgeMs: number;
  libraryIds: string[];
  scopes: AccessTokenScope[];
}
export function decodeAccessTokenOptions(value: unknown): AccessTokenOptions {
  const row = responseRecord(value, [
    'schemaVersion',
    'now',
    'maxTokenAgeMs',
    'libraryIds',
    'scopes',
  ]);
  if (
    typeof row.now !== 'number' ||
    !Number.isSafeInteger(row.now) ||
    row.now < 0 ||
    typeof row.maxTokenAgeMs !== 'number' ||
    !Number.isSafeInteger(row.maxTokenAgeMs) ||
    row.maxTokenAgeMs < 1 ||
    row.maxTokenAgeMs > 366 * 86400000
  )
    throw new Error('Invalid token options');
  return {
    schemaVersion: 1,
    now: row.now,
    maxTokenAgeMs: row.maxTokenAgeMs,
    libraryIds: validateTokenLibraries(row.libraryIds),
    scopes: validateTokenScopes(row.scopes),
  };
}
