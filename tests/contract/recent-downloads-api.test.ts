import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { clientFeatures } from '../../apps/web/src/capabilities/client-features.js';

describe('recent downloads wire contract', () => {
  /** Recent production support cannot enable the future web consumer. */
  it('should keep the recent web consumer disabled', () => {
    expect(clientFeatures['library.recentDownloads']).toBe(false);
  });
  /** Native consumers validate all states and reject selection-bearing unavailable items. */
  it('should export strict recent schemas and native decoder fixtures', async () => {
    const path = resolve('packages/contracts/src/recent.ts');
    expect(existsSync(path)).toBe(true);
    const contract = await import(path);
    const fixturesPath = resolve('packages/test-support/src/recent-fixtures.ts');
    expect(existsSync(fixturesPath)).toBe(true);
    const { recentFixtures, recentErrorFixture } = await import(fixturesPath);
    const app = Fastify({
      ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
    });
    app.post('/decode', { schema: { body: contract.recentResponseSchema } }, async () => ({}));
    app.get('/query', { schema: { querystring: contract.recentQuerySchema } }, async () => ({}));
    try {
      for (const key of ['empty', 'registering', 'ready', 'missing', 'cursor', 'date']) {
        expect(
          (await app.inject({ method: 'POST', url: '/decode', payload: recentFixtures[key] }))
            .statusCode,
          key,
        ).toBe(200);
      }
      for (const payload of [
        { ...recentFixtures.empty, privatePath: '/private' },
        {
          ...recentFixtures.ready,
          items: [{ ...recentFixtures.ready.items[0], state: 'registering' }],
        },
        {
          ...recentFixtures.ready,
          items: [{ ...recentFixtures.ready.items[0], state: 'missing' }],
        },
        { ...recentFixtures.ready, items: [{ ...recentFixtures.ready.items[0], song: undefined }] },
        {
          ...recentFixtures.ready,
          items: [
            {
              ...recentFixtures.ready.items[0],
              song: { ...recentFixtures.ready.items[0].song, isDir: true },
            },
          ],
        },
        { ...recentFixtures.empty, filter: { from: 'yesterday', to: 'today' } },
      ])
        expect((await app.inject({ method: 'POST', url: '/decode', payload })).statusCode).toBe(
          400,
        );
      for (const query of [
        'from=2026-09-01T00:00:00Z',
        'limit=101',
        'limit=1&limit=2',
        'libraryId=music',
      ])
        expect((await app.inject(`/query?${query}`)).statusCode).toBe(400);
      expect(recentErrorFixture).toEqual({
        schemaVersion: 1,
        error: { code: 'upstream_unavailable', retryable: true },
      });
    } finally {
      await app.close();
    }
  });
});
