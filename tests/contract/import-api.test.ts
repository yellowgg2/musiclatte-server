import Fastify from 'fastify';
import {
  importRequestSchemas,
  importResponseSchemas,
} from '../../packages/contracts/src/imports.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  availableEntries,
  clientFeatures,
} from '../../apps/web/src/capabilities/client-features.js';

describe('import wire contract', () => {
  /** Producer implementation must not enable the unimplemented web consumer. */
  it('should keep the imports web consumer disabled', () => {
    expect(clientFeatures['imports.youtube']).toBe(false);
    expect(
      availableEntries({
        schemaVersion: 1,
        instanceId: 'fixture',
        revision: 'fixture',
        features: {
          'music.browse': { supported: true, permission: 'allowed', availability: 'available' },
          'imports.youtube': { supported: true, permission: 'allowed', availability: 'available' },
        },
      }),
    ).not.toContain('imports.youtube');
  });
  /** Import contracts expose exact bodies and bounded query defaults independently of handlers. */
  it('should export strict request and response schemas', async () => {
    const path = resolve('packages/contracts/src/imports.ts');
    expect(existsSync(path)).toBe(true);
    const contract = await import(path);
    expect(contract.importRequestSchemas.create.additionalProperties).toBe(false);
    expect(contract.importRequestSchemas.create.required).toEqual([
      'operationId',
      'libraryId',
      'urls',
    ]);
    expect(contract.importRequestSchemas.retry.additionalProperties).toBe(false);
    expect(contract.importRequestSchemas.list.additionalProperties).toBe(false);
    expect(Object.keys(contract.importRequestSchemas.list.properties)).toEqual(['cursor', 'limit']);
    expect(contract.importResponseSchemas.detail.additionalProperties).toBe(false);
    expect(contract.importResponseSchemas.list.additionalProperties).toBe(false);
  });
  /** JSON-schema validation rejects unknown and malformed fields without coercion or stripping. */
  it('should enforce create, retry and list schemas independently of the import handler', async () => {
    const app = Fastify({
      ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
    });
    app.post('/create', { schema: { body: importRequestSchemas.create } }, async () => ({}));
    app.post('/retry', { schema: { body: importRequestSchemas.retry } }, async () => ({}));
    app.get('/list', { schema: { querystring: importRequestSchemas.list } }, async () => ({}));
    const valid = {
      operationId: 'A'.repeat(22),
      libraryId: 'music',
      urls: ['https://youtu.be/abcdefghijk'],
    };
    try {
      expect(
        (await app.inject({ method: 'POST', url: '/create', payload: valid })).statusCode,
      ).toBe(200);
      for (const payload of [
        { ...valid, rawPath: '/private' },
        { ...valid, operationId: 'A'.repeat(129) },
        { ...valid, urls: [] },
        { ...valid, urls: [1] },
        { ...valid, libraryId: '../x' },
      ])
        expect((await app.inject({ method: 'POST', url: '/create', payload })).statusCode).toBe(
          400,
        );
      for (const payload of [
        { operationId: valid.operationId, itemIds: [] },
        { operationId: valid.operationId, itemIds: ['id', 'id'] },
        { operationId: valid.operationId, itemIds: ['id'], urls: valid.urls },
      ])
        expect((await app.inject({ method: 'POST', url: '/retry', payload })).statusCode).toBe(400);
      expect((await app.inject('/list?limit=100')).statusCode).toBe(200);
      for (const query of ['limit=101', 'limit=01', 'libraryId=music', 'limit=1&limit=2'])
        expect((await app.inject(`/list?${query}`)).statusCode).toBe(400);
      expect(
        importResponseSchemas.detail.properties.job.properties.items.items.additionalProperties,
      ).toBe(false);
    } finally {
      await app.close();
    }
  });
});
