import { describe, expect, it } from 'vitest';
import {
  decodeAccessTokenCreated,
  decodeAccessTokenList,
} from '../../packages/contracts/src/access-tokens.js';
import { createAccessTokenTestContext } from '../support/access-token-harness.js';
describe('access token HTTP contract', () => {
  /** Actual HTTP producer responses match strict consumer decoders and expose the secret only once. */
  it('should decode real creation and owner list responses', async () => {
    const c = await createAccessTokenTestContext();
    try {
      const response = await c.app.inject({
        method: 'POST',
        url: '/api/v1/access-tokens',
        headers: c.headers,
        payload: c.payload,
      });
      expect(response.statusCode).toBe(201);
      const created = decodeAccessTokenCreated(response.json());
      const listed = await c.app.inject({ url: '/api/v1/access-tokens', headers: c.headers });
      const list = decodeAccessTokenList(listed.json());
      expect(list.accessTokens).toEqual([created.accessToken]);
      expect(() => decodeAccessTokenCreated({ ...created, proof: {} })).toThrow();
      expect(() => decodeAccessTokenList({ ...list, token: created.token })).toThrow();
      expect(() => decodeAccessTokenList({ ...list, total: -1 })).toThrow();
    } finally {
      await c.cleanup();
    }
  });
});
