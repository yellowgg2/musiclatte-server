import { describe, expect, it } from 'vitest';
import {
  availableEntries,
  clientFeatures,
} from '../../apps/web/src/capabilities/client-features.js';
import { safeReturnPath } from '../../apps/web/src/auth/guards.js';
import { importResponseSchemas } from '../../packages/contracts/src/imports.js';
import Fastify from 'fastify';

const job = {
  id: 'job-one',
  libraryId: 'music',
  createdAt: 1,
  cancelRequestedAt: null,
  retryOfJobId: null,
  status: 'completed',
  items: [{ id: 'item-one', sourceId: 'abcdefghijk', stage: 'ready', mediaLinkId: 'media-one' }],
};
async function makeSUT() {
  const path = '../../apps/web/src/imports/client.js';
  const module = await import(path).catch(() => null);
  expect(module, 'strict browser import decoder exists').not.toBeNull();
  return module!;
}
describe('imports web consumer contract', () => {
  /** Consumer activation respects the complete producer capability intersection. */
  it('should enable only the implemented available imports feature', () => {
    expect(clientFeatures['imports.youtube']).toBe(true);
    for (const permission of ['allowed', 'denied'] as const)
      for (const availability of ['available', 'temporarily_unavailable'] as const) {
        const entries = availableEntries({
          schemaVersion: 1,
          instanceId: 'fixture',
          revision: '1',
          features: { 'imports.youtube': { supported: true, permission, availability } },
        });
        expect(entries.includes('imports.youtube')).toBe(
          permission === 'allowed' && availability === 'available',
        );
      }
    expect(safeReturnPath('/imports')).toBe('/imports');
    expect(safeReturnPath('/music/imports', '/music/')).toBe('/music/imports');
    for (const path of ['/imports?url=private', '/imports/extra', '/imports#private', '//imports'])
      expect(safeReturnPath(path)).not.toBe(path);
  });
  /** Strict decoding accepts schema-serialized producer output and rejects private or malformed fields. */
  it('should consume the exact producer schema and reject invalid ready and unknown fields', async () => {
    const m = await makeSUT();
    const app = Fastify();
    app.get('/', { schema: { response: { 200: importResponseSchemas.list } } }, async () => ({
      schemaVersion: 1,
      jobs: [job],
      libraries: [{ id: 'music' }],
      nextCursor: null,
    }));
    try {
      const response = (await app.inject('/')).json();
      expect(m.decodeImportList(response)).toEqual(response);
      for (const invalid of [
        { ...response, schemaVersion: 2 },
        { ...response, privatePath: '/private' },
        { ...response, jobs: [{ ...job, status: 'invented' }] },
        {
          ...response,
          jobs: [{ ...job, items: [{ ...job.items[0], stage: 'ready', mediaLinkId: undefined }] }],
        },
        {
          ...response,
          jobs: [{ ...job, items: [{ ...job.items[0], failureCode: 'raw server error' }] }],
        },
        { ...response, jobs: [{ ...job, items: [{ ...job.items[0], path: '/private' }] }] },
      ])
        expect(() => m.decodeImportList(invalid)).toThrow();
    } finally {
      await app.close();
    }
  });
  /** Raw links appear only in POST bodies; cancellation sends no body or query. */
  it('should preserve API origin, csrf, abort and body-only mutation contracts', async () => {
    const m = await makeSUT();
    const calls: { url: string; init: RequestInit }[] = [];
    const client = m.createImportClient({
      apiOrigin: 'https://api.example.test',
      fetcher: async (input: string, init: RequestInit) => {
        calls.push({ url: String(input), init });
        return Response.json({ schemaVersion: 1, job });
      },
    });
    const signal = new AbortController().signal;
    await client.create(
      { operationId: 'A'.repeat(32), libraryId: 'music', urls: ['https://youtu.be/abcdefghijk'] },
      { csrfToken: 'synthetic', signal },
    );
    await client.retry(
      'job-one',
      { operationId: 'B'.repeat(32), itemIds: ['item-one'] },
      { csrfToken: 'synthetic', signal },
    );
    await client.cancel('job-one', { csrfToken: 'synthetic', signal });
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.example.test/api/v1/imports',
      'https://api.example.test/api/v1/imports/job-one/retries',
      'https://api.example.test/api/v1/imports/job-one',
    ]);
    expect(calls[2]!.init.body).toBeUndefined();
    expect(new Headers(calls[0]!.init.headers).get('x-csrf-token')).toBe('synthetic');
    expect(
      calls.every((c) => c.init.signal instanceof AbortSignal && c.init.credentials === 'include'),
    ).toBe(true);
  });
});
