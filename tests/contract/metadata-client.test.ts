import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeMetadataSnapshot } from '../../packages/contracts/src/metadata.js';
import { createRecentContext } from '../support/recent-harness.js';
import { cookieOf } from '../support/auth-harness.js';

const snapshot = decodeMetadataSnapshot({
  schemaVersion: 1,
  trackId: 'song / one',
  editable: true,
  reason: null,
  format: 'mp3',
  supportedFields: ['title'],
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
  lyricsFrames: [],
  lastVerifiedAt: 1,
});
async function makeSUT(fetcher: typeof fetch, isCurrent = () => true) {
  const path = resolve('apps/web/src/metadata/client.ts');
  expect(existsSync(path), 'strict metadata client exists').toBe(true);
  return (await import(path)).createMetadataClient({
    fetcher,
    apiOrigin: 'https://api.example.test',
    isCurrent,
  });
}
describe('metadata client transport', () => {
  /** Mutations reuse caller-owned operation IDs and never replay after an uncertain network result. */
  it('should keep submit retry recheck and restore operation bodies intact with CSRF fencing', async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const item = {
      itemId: 'item',
      originalTrackId: 'song',
      currentTrackId: 'song',
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
    const client = await makeSUT(async (input, init) => {
      const url = String(input);
      sent.push({ url, init: init! });
      const kind = url.endsWith('/retries')
        ? 'retry'
        : url.endsWith('/restores')
          ? 'restore'
          : 'edit';
      return Response.json({
        schemaVersion: 1,
        job: {
          id: kind === 'edit' ? 'job' : 'child',
          libraryId: 'music',
          createdAt: 1,
          status: 'queued',
          kind,
          parentJobId: kind === 'edit' ? null : 'job',
          items: [item],
        },
      });
    });
    const body = {
      operationId: 'same_operation_0123456789',
      targets: [{ trackId: 'song', expectedRevision: 'revision-1' }],
      patch: { title: { op: 'set', value: 'Synthetic' } },
    };
    const options = { csrfToken: 'synthetic-csrf' };
    await client.submit(body, options);
    await client.submit(body, options);
    await client.retry(
      'job',
      {
        operationId: 'retry_operation_0123456789',
        items: [{ itemId: 'item', expectedRevision: 'revision-1' }],
      },
      options,
    );
    await client.recheck(
      'job',
      { operationId: 'recheck_operation_0123456789', itemIds: ['item'] },
      options,
    );
    await client.restore(
      'job',
      {
        operationId: 'restore_operation_0123456789',
        itemId: 'item',
        currentExpectedRevision: 'revision-1',
      },
      options,
    );
    expect(sent).toHaveLength(5);
    expect(sent[0]!.init.body).toBe(sent[1]!.init.body);
    expect(JSON.parse(sent[0]!.init.body as string)).toEqual(body);
    for (const request of sent)
      expect(new Headers(request.init.headers).get('x-csrf-token')).toBe('synthetic-csrf');
    const uncertain = await makeSUT(async () => {
      throw new Error('private transport detail');
    });
    await expect(uncertain.submit(body, options)).rejects.toMatchObject({
      code: 'upstream_unavailable',
    });
  });
  /** Exact current-song projection uses the same authenticated library-read boundary as browse. */
  it('should expose a read-only current-song projection without private file fields', async () => {
    const c = await createRecentContext();
    try {
      c.songs.push({
        id: 'synthetic-song',
        title: 'Indexed title',
        isDir: false,
        path: 'imports/synthetic.mp3',
      });
      expect((await c.app.inject({ url: '/api/v1/music/songs/synthetic-song' })).statusCode).toBe(
        401,
      );
      const headers = { cookie: cookieOf(await c.login()) };
      const response = await c.app.inject({ url: '/api/v1/music/songs/synthetic-song', headers });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        schemaVersion: 1,
        song: { id: 'synthetic-song', title: 'Indexed title' },
      });
      expect(response.json().song).not.toHaveProperty('path');
      expect(
        (await c.app.inject({ url: '/api/v1/music/songs/synthetic-song?path=private', headers }))
          .statusCode,
      ).toBe(400);
    } finally {
      await c.cleanup();
    }
  });
  /** Reads use cookie auth and the private API origin with strict public DTO decoding. */
  it('should encode track IDs and reject leaked fields', async () => {
    let sent: RequestInit | undefined;
    let url = '';
    let value: unknown = snapshot;
    const client = await makeSUT(async (input, init) => {
      url = String(input);
      sent = init;
      return Response.json(value);
    });
    expect(await client.read('song / one')).toEqual(snapshot);
    expect(url).toBe('https://api.example.test/api/v1/tracks/song%20%2F%20one/metadata');
    expect(sent).toMatchObject({ credentials: 'include', cache: 'no-store', redirect: 'error' });
    value = { ...snapshot, privatePath: '/private' };
    await expect(client.read('song / one')).rejects.toMatchObject({ code: 'internal_error' });
  });
  /** Completion fencing applies even when a transport ignores AbortSignal and returns late. */
  it.each(['read', 'changes', 'upload', 'detail'] as const)(
    'should reject an obsolete %s response after account or policy generation changes',
    async (method) => {
      let current = true;
      let resolveResponse!: (response: Response) => void;
      const client = await makeSUT(
        () =>
          new Promise((resolve) => {
            resolveResponse = resolve;
          }),
        () => current,
      );
      const pending =
        method === 'read'
          ? client.read('song / one')
          : method === 'changes'
            ? client.changes('previous-cursor')
            : method === 'detail'
              ? client.detail('job')
              : client.upload(new Blob(['synthetic'], { type: 'image/png' }), {
                  csrfToken: 'synthetic-csrf',
                  operationId: 'upload_operation_0123456789',
                  libraryId: 'music',
                });
      current = false;
      resolveResponse(Response.json(snapshot));
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    },
  );
});
