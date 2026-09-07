import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

describe('metadata wire contract', () => {
  /** Snapshot values and frame selectors remain strict, including unsupported/read-only responses. */
  it('should decode actual tag snapshots without accepting binary or private frame keys', async () => {
    const metadata = await import(resolve('packages/contracts/src/metadata.ts'));
    expect(typeof metadata.decodeMetadataSnapshot).toBe('function');
    const snapshot = {
      schemaVersion: 1,
      trackId: 'song-1',
      editable: true,
      reason: null,
      format: 'mp3',
      supportedFields: ['title', 'cover', 'lyrics'],
      fileRevision: 'revision-1',
      values: {
        title: 'Synthetic',
        artist: [],
        album: null,
        albumArtist: [],
        trackNumber: null,
        year: null,
        genre: [],
      },
      coverFrames: [],
      lyricsFrames: [{ selector: { language: 'eng', description: '' }, text: 'Synthetic lyrics' }],
      lastVerifiedAt: 1,
    };
    expect(metadata.decodeMetadataSnapshot(snapshot)).toEqual(snapshot);
    for (const extra of [
      { filePath: '/private/file' },
      { values: { ...snapshot.values, privateHash: 'private' } },
      { lyricsFrames: [{ selector: { language: 'ko', description: '' }, text: 'Synthetic' }] },
      { editable: true, format: 'unsupported' },
      {
        coverFrames: [
          {
            frameId: 'frame-1',
            pictureType: 3,
            description: '',
            mimeType: 'image/png',
            previewUrl: 'https://external.invalid/image',
          },
        ],
      },
    ])
      expect(() => metadata.decodeMetadataSnapshot({ ...snapshot, ...extra })).toThrow();
  });
  /** Public decoders reject internal ledger fields and impossible success receipts. */
  it('should decode a projected job and reject leaked or inconsistent item state', async () => {
    const path = resolve('packages/contracts/src/metadata.ts');
    const metadata = await import(path);
    expect(typeof metadata.decodeMetadataJob).toBe('function');
    const item = {
      itemId: 'item-1',
      originalTrackId: 'song-1',
      currentTrackId: 'song-1',
      stage: 'queued',
      fileSavedAt: null,
      reflectedAt: null,
      previousRevision: 'revision-1',
      resultRevision: null,
      changedFields: ['title'],
      errorCode: null,
      recoveryActions: [],
      restoreAvailable: false,
    };
    const job = {
      id: 'job-1',
      libraryId: 'library-1',
      createdAt: 1,
      status: 'queued',
      kind: 'edit',
      parentJobId: null,
      items: [item],
    };
    expect(metadata.decodeMetadataJob(job)).toEqual(job);
    for (const change of [
      { filePath: '/private/song.mp3' },
      { stage: 'succeeded' },
      { errorCode: 'raw-private-error' },
      { changedFields: ['path'] },
      { fileSavedAt: 1 },
      { restoreAvailable: true },
    ]) {
      expect(() =>
        metadata.decodeMetadataJob({ ...job, items: [{ ...item, ...change }] }),
      ).toThrow();
    }
    expect(() => metadata.decodeMetadataJob({ ...job, identityKey: 'private' })).toThrow();
  });
  /** Explicit patch intent preserves omitted fields and rejects ambiguous or private inputs. */
  it('should validate bounded explicit metadata intent without accepting paths', async () => {
    const path = resolve('packages/contracts/src/metadata.ts');
    expect(existsSync(path)).toBe(true);
    const { metadataRequestSchemas } = await import(path);
    const app = Fastify({
      ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
    });
    app.post('/', { schema: { body: metadataRequestSchemas.create } }, async () => ({}));
    const request = {
      operationId: '11111111-1111-4111-8111-111111111111',
      targets: [{ trackId: 'track-1', expectedRevision: 'revision-1' }],
      patch: { title: { op: 'set', value: 'Synthetic title' } },
    };
    try {
      for (const patch of [
        request.patch,
        { artist: { op: 'set', value: ['Synthetic artist'] }, album: { op: 'clear' } },
        { lyrics: { op: 'clear', selector: { language: 'eng', description: '' } } },
        { cover: { op: 'set', selector: { kind: 'new' }, uploadId: 'upload-1' } },
      ]) {
        expect(
          (await app.inject({ method: 'POST', url: '/', payload: { ...request, patch } }))
            .statusCode,
        ).toBe(200);
      }
      for (const patch of [
        {},
        null,
        { title: null },
        { title: {} },
        { title: { op: 'set', value: '' } },
        { title: { op: 'mixed' } },
        { path: { op: 'set', value: '/private/file' } },
        { artist: { op: 'set', value: 'artist' } },
        { artist: { op: 'set', value: [] } },
        { cover: { op: 'clear' } },
        { lyrics: { op: 'clear' } },
        { lyrics: { op: 'set', selector: { language: 'ko', description: '' }, text: 'Synthetic' } },
      ]) {
        expect(
          (await app.inject({ method: 'POST', url: '/', payload: { ...request, patch } }))
            .statusCode,
        ).toBe(400);
      }
      for (const extra of [
        { targets: [] },
        { targets: [...request.targets, ...request.targets] },
        { filePath: '/private/song.mp3' },
      ]) {
        expect(
          (await app.inject({ method: 'POST', url: '/', payload: { ...request, ...extra } }))
            .statusCode,
        ).toBe(400);
      }
    } finally {
      await app.close();
    }
  });
});
