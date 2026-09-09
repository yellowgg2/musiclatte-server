import { describe, expect, it } from 'vitest';
import { decodeMetadataSnapshot } from '../../packages/contracts/src/metadata.js';
import { createMetadataPrincipalContext } from '../support/metadata-principal-harness.js';
import { recentNow } from '../support/recent-harness.js';
describe('metadata principal wire compatibility', () => {
  /** Cookie and scoped PAT preview producers preserve the same public DTO without actor credentials. */
  it('should keep the metadata snapshot contract for both authenticated actor types', async () => {
    const c = await createMetadataPrincipalContext();
    try {
      const issued = (
        await c.app.inject({
          method: 'POST',
          url: '/api/v1/access-tokens',
          headers: c.headers,
          payload: {
            name: 'Synthetic contract',
            scopes: ['metadata:read'],
            libraryIds: ['music'],
            expiresAt: recentNow + 10000,
          },
        })
      ).json();
      const pat = await c.app.inject({
        url: '/api/v1/tracks/track-1/metadata',
        headers: { authorization: `Bearer ${issued.token}` },
      });
      expect(pat.statusCode).toBe(200);
      const legacy = decodeMetadataSnapshot((await c.get()).json());
      const token = decodeMetadataSnapshot(pat.json());
      expect(token.values).toEqual(legacy.values);
      expect(token.fileRevision).toBe(legacy.fileRevision);
      expect(token.editable).toBe(false);
      expect(pat.body).not.toContain(issued.token);
      expect(pat.json()).not.toHaveProperty('actorTokenId');
      expect(pat.json()).not.toHaveProperty('encryptedJobGrant');
      const listed = await c.app.inject({
        url: '/api/v1/metadata-jobs',
        headers: { authorization: `Bearer ${issued.token}` },
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.json().jobs).toEqual([]);
    } finally {
      await c.cleanup();
    }
  });
});
