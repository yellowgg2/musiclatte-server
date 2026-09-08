import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  metadataRequestSchemas as schemas,
  decodeMetadataPreview,
  decodeMetadataCoverUpload,
  decodeMetadataChanges,
  decodeMetadataJob,
} from '../../packages/contracts/src/metadata.js';
import { playlistMutationSchemas } from '../../packages/contracts/src/collections.js';
import { decodeCapabilities } from '../../packages/contracts/src/capabilities.js';
import { clientFeatures } from '../../apps/web/src/capabilities/client-features.js';

describe('metadata API consumer-independent contract', () => {
  /** Future descriptors are optional; malformed known descriptors are never treated as permission. */
  it('should preserve strict optional descriptors while exposing completed editors and keeping future consumers closed', () => {
    const feature = {
      supported: true,
      permission: 'allowed',
      availability: 'available',
      formats: ['mp3'],
      fields: ['title', 'lyrics'],
      bulkFields: [],
      future: 'ignored',
    };
    const body = {
      schemaVersion: 1,
      instanceId: 'instance',
      revision: 'revision',
      features: { 'music.browse': feature, 'metadata.write': feature, future: {} },
    };
    expect(decodeCapabilities(body).features['metadata.write']).toEqual({
      supported: true,
      permission: 'allowed',
      availability: 'available',
      formats: ['mp3'],
      fields: ['title', 'lyrics'],
      bulkFields: [],
    });
    for (const change of [{ formats: ['mp3', 'mp3'] }, { fields: [''] }, { bulkFields: true }])
      expect(() =>
        decodeCapabilities({ ...body, features: { 'music.browse': { ...feature, ...change } } }),
      ).toThrow();
    expect(clientFeatures['metadata.write']).toBe(true);
    expect(clientFeatures['metadata.lyrics.write']).toBe(true);
    expect(clientFeatures['metadata.curation']).toBe(false);
    expect(clientFeatures['automation.tokens']).toBe(false);
  });
  /** Retry/restore/recheck intent has one closed wire representation and reuses P2 operation IDs. */
  it('should share P2 operation keys and reject unknown recovery intent independently of routes', async () => {
    expect(schemas.create.properties.operationId).toEqual(
      playlistMutationSchemas.create.properties.operationId,
    );
    const app = Fastify({
      ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
    });
    for (const kind of ['retry', 'restore', 'recheck'] as const)
      app.post(`/${kind}`, { schema: { body: schemas[kind] } }, async () => ({}));
    const operationId = 'operation-key-of-22-chars';
    const cases = {
      retry: { operationId, items: [{ itemId: 'item', expectedRevision: 'fresh' }] },
      restore: { operationId, itemId: 'item', currentExpectedRevision: 'fresh' },
      recheck: { operationId, itemIds: ['item'] },
    };
    try {
      for (const [kind, payload] of Object.entries(cases)) {
        expect((await app.inject({ method: 'POST', url: `/${kind}`, payload })).statusCode).toBe(
          200,
        );
        for (const change of [
          { operationId: 'short' },
          { backupPath: '/private' },
          { operationId: 'A'.repeat(129) },
        ])
          expect(
            (
              await app.inject({
                method: 'POST',
                url: `/${kind}`,
                payload: { ...payload, ...change },
              })
            ).statusCode,
          ).toBe(400);
      }
    } finally {
      await app.close();
    }
  });
  /** Preview/cover/event DTOs reject filesystem and ownership fields and inconsistent saved receipts. */
  it('should decode bounded public previews and reflection receipts without private data', () => {
    const preview = {
      schemaVersion: 1,
      libraryId: 'music',
      targetCount: 1,
      changedFields: ['title'],
      targets: [{ trackId: 'a'.repeat(1800), fileRevision: 'revision' }],
      writeGuaranteed: false,
    };
    expect(decodeMetadataPreview(preview)).toEqual(preview);
    expect(() => decodeMetadataPreview({ ...preview, writeGuaranteed: true })).toThrow();
    expect(() => decodeMetadataPreview({ ...preview, targetCount: 2 })).toThrow();
    const cover = {
      schemaVersion: 1,
      uploadId: 'upload',
      libraryId: 'music',
      mimeType: 'image/png',
      size: 123,
      expiresAt: 10,
      previewUrl: '/api/v1/metadata-covers/upload',
    };
    expect(decodeMetadataCoverUpload(cover)).toEqual(cover);
    expect(() => decodeMetadataCoverUpload({ ...cover, relativeKey: 'private.upload' })).toThrow();
    const change = {
      sequence: 1,
      libraryId: 'music',
      oldTrackId: 'old',
      newTrackId: 'new',
      oldRevision: 'before',
      newRevision: 'after',
      coverGeneration: 'generation',
      relatedIds: { trackIds: ['new'], albumIds: [], artistIds: [], coverIds: ['cover'] },
      changedFields: ['cover'],
      fileSavedAt: 1,
      reflectedAt: null,
      reflection: 'reflection_mismatch',
    };
    const page = { schemaVersion: 1, changes: [change], hasMore: false, nextCursor: 'cursor' };
    expect(decodeMetadataChanges(page)).toEqual(page);
    for (const delta of [
      { identityKey: 'private' },
      { reflection: 'verified' },
      { reflectedAt: 0 },
      { changedFields: ['path'] },
    ])
      expect(() =>
        decodeMetadataChanges({ ...page, changes: [{ ...change, ...delta }] }),
      ).toThrow();
  });
  /** Saved-but-unreflected and failed-unsaved items coexist without a fabricated all-success result. */
  it('should preserve partial saved results and narrow retry/recheck actions', () => {
    const common = {
      previousRevision: 'previous',
      resultRevision: null,
      changedFields: ['title'],
      reflectedAt: null,
      fileSavedAt: null,
      restoreAvailable: false,
    };
    const job = {
      id: 'job',
      libraryId: 'music',
      createdAt: 1,
      status: 'reflecting',
      kind: 'edit',
      parentJobId: null,
      items: [
        {
          ...common,
          itemId: 'one',
          originalTrackId: 'one',
          currentTrackId: 'one',
          stage: 'failed',
          errorCode: 'read_only',
          recoveryActions: ['retry'],
        },
        {
          ...common,
          itemId: 'two',
          originalTrackId: 'two',
          currentTrackId: 'two',
          stage: 'reflecting',
          fileSavedAt: 2,
          resultRevision: 'saved',
          restoreAvailable: true,
          errorCode: 'reflection_mismatch',
          recoveryActions: ['recheck', 'restore'],
        },
      ],
    };
    expect(decodeMetadataJob(job)).toEqual(job);
    expect(() =>
      decodeMetadataJob({ ...job, items: [{ ...job.items[1], resultRevision: null }] }),
    ).toThrow();
  });
});
