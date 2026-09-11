import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decodeAccessToken,
  validateTokenScopes,
} from '../../packages/contracts/src/access-tokens.js';

describe('access token public metadata', () => {
  /** Public decoders reject credentials, unsupported scopes and invalid lifetimes. */
  it('should accept metadata without permitting private storage or secret fields', () => {
    const token = {
      id: randomUUID(),
      name: 'Synthetic client',
      scopes: ['metadata:read'],
      libraryIds: ['library-1'],
      createdAt: 1000,
      expiresAt: 2000,
      revokedAt: null,
      lastUsedAt: null,
    };
    expect(decodeAccessToken(token)).toEqual(token);
    for (const change of [
      { token: 'private' },
      { encryptedProof: 'private' },
      { tokenHash: 'private' },
      { ownerUsername: 'private' },
      { scopes: ['lyrics:write'] },
      { scopes: ['metadata:read', 'media:organize'] },
      { scopes: ['metadata:read', 'metadata:read'] },
      { scopes: ['admin'] },
      { libraryIds: [] },
      { expiresAt: 1000 },
      { lastUsedAt: 999 },
      { name: 'invalid\nname' },
    ]) {
      expect(() => decodeAccessToken({ ...token, ...change })).toThrow();
    }
    expect(validateTokenScopes(['metadata:read', 'metadata:write', 'media:organize'])).toEqual([
      'media:organize',
      'metadata:read',
      'metadata:write',
    ]);
  });
});
