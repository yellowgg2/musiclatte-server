import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  availableEntries,
  clientFeatures,
} from '../../apps/web/src/capabilities/client-features.js';

describe('engine wire contract', () => {
  /** A ready producer does not expose the settings consumer before Step 12. */
  it('should keep engine settings disabled in the web client', () => {
    expect(clientFeatures['engine.manage']).toBe(false);
    expect(
      availableEntries({
        schemaVersion: 1,
        instanceId: 'fixture',
        revision: 'fixture',
        features: {
          'music.browse': { supported: true, permission: 'allowed', availability: 'available' },
          'engine.manage': { supported: true, permission: 'allowed', availability: 'available' },
        },
      }),
    ).not.toContain('engine.manage');
  });
  /** Independent JSON-schema validation enforces a closed request union and public projection. */
  it('should export strict action and response schemas', async () => {
    const path = resolve('packages/contracts/src/engine.ts');
    expect(existsSync(path)).toBe(true);
    const { engineActionSchema, engineStatusSchema } = await import(path);
    const app = Fastify({
      ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
    });
    app.post('/action', { schema: { body: engineActionSchema } }, async () => ({}));
    app.post('/status', { schema: { body: engineStatusSchema } }, async () => ({}));
    try {
      for (const action of ['check_now', 'restore_previous']) {
        expect(
          (await app.inject({ method: 'POST', url: '/action', payload: { action } })).statusCode,
        ).toBe(200);
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/action',
              payload: { action, version: 'nightly-2' },
            })
          ).statusCode,
        ).toBe(400);
      }
      const status = {
        schemaVersion: 1,
        channel: 'nightly',
        activeVersion: 'nightly-1',
        candidateVersion: null,
        previousVersion: null,
        lastCheckedAt: null,
        lastSuccessfulCheckAt: null,
        status: 'never_checked',
        recoverability: 'no_previous',
      };
      expect(
        (await app.inject({ method: 'POST', url: '/status', payload: status })).statusCode,
      ).toBe(200);
      for (const extra of [
        { executable: '/private/path' },
        { hash: 'a'.repeat(64) },
        { status: 'raw failure' },
        { channel: 'stable' },
        { lastCheckedAt: -1 },
      ]) {
        expect(
          (await app.inject({ method: 'POST', url: '/status', payload: { ...status, ...extra } }))
            .statusCode,
        ).toBe(400);
      }
    } finally {
      await app.close();
    }
  });
});
