import * as contracts from '@musiclatte/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { cookieOf, createTestContext, password } from '../support/auth-harness.js';

describe('account summary producer contract', () => {
  const contexts: Awaited<ReturnType<typeof createTestContext>>[] = [];

  afterEach(async () => {
    for (const ctx of contexts.splice(0)) await ctx.cleanup();
  });

  /** The public contract exports a closed versioned response with non-negative integer counts. */
  it('should publish strict account summary schemas', () => {
    const responseSchema = Reflect.get(contracts, 'accountSummaryResponseSchema');
    const querySchema = Reflect.get(contracts, 'accountSummaryQuerySchema');

    expect(responseSchema).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['schemaVersion', 'favoriteSongCount', 'playlistCount'],
      properties: {
        schemaVersion: { const: 1 },
        favoriteSongCount: { type: 'integer', minimum: 0 },
        playlistCount: { type: 'integer', minimum: 0 },
      },
    });
    expect(querySchema).toEqual({ type: 'object', additionalProperties: false, properties: {} });
  });

  /** The HTTP producer exposes only counts and rejects every account-selection query. */
  it('should publish a current-principal-only HTTP surface', async () => {
    const ctx = await createTestContext();
    contexts.push(ctx);
    const headers = { cookie: cookieOf(await ctx.login()) };
    ctx.state.favoriteSongIdsByUsername.set(password.username, ['tr-A', 'tr-B']);
    ctx.state.playlistIds = ['pl-1', 'pl-2'];

    const response = await ctx.app.inject({ url: '/api/v1/account/summary', headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      schemaVersion: 1,
      favoriteSongCount: 2,
      playlistCount: 2,
    });
    expect(Object.keys(response.json()).sort()).toEqual([
      'favoriteSongCount',
      'playlistCount',
      'schemaVersion',
    ]);

    const before = ctx.requests.length;
    expect(
      (
        await ctx.app.inject({
          url: '/api/v1/account/summary?accountId=other',
          headers,
        })
      ).statusCode,
    ).toBe(400);
    expect(ctx.requests).toHaveLength(before);
  });
});
