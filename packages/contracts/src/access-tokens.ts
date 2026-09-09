export const accessTokenScopes = [
  'metadata:read',
  'metadata:write',
  'lyrics:write',
  'curation:write',
] as const;
export type AccessTokenScope = (typeof accessTokenScopes)[number];
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
    (value.includes('lyrics:write') && !value.includes('metadata:write'))
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
