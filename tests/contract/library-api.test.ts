import { afterEach, describe, expect, it } from 'vitest';
import { cookieOf, createTestContext } from '../support/auth-harness.js';

describe('library wire contract', () => {
  const contexts: Awaited<ReturnType<typeof createTestContext>>[] = [];
  afterEach(async () => {
    for (const ctx of contexts.splice(0)) await ctx.cleanup();
  });
  /** Folder roots and directory IDs are distinct; top-level browsing uses getIndexes. */
  it('should provide roots then indexes without recursively fetching the library', async () => {
    const ctx = await createTestContext();
    contexts.push(ctx);
    const headers = { cookie: cookieOf(await ctx.login()) };
    const roots = await ctx.app.inject({ url: '/api/v1/music/folders', headers });
    expect(roots.statusCode).toBe(200);
    expect(roots.json()).toEqual({
      schemaVersion: 1,
      folders: [{ id: '0', name: 'Synthetic Music' }],
    });
    const indexes = await ctx.app.inject({ url: '/api/v1/music/folders?musicFolderId=0', headers });
    expect(indexes.statusCode).toBe(200);
    expect(indexes.json().indexes.index[0].artist[0].id).toBe('ar-1');
    expect(ctx.requests.at(-1)?.pathname).toBe('/rest/getIndexes');
    expect(ctx.requests.at(-1)?.searchParams.get('musicFolderId')).toBe('0');
    expect(ctx.requests.some((u) => u.pathname === '/rest/getMusicDirectory')).toBe(false);
  });
  /** Mixed directory/song ordering and absent optional metadata survive the BFF serializer. */
  it('should preserve typed children without upstream envelopes or invented metadata', async () => {
    const ctx = await createTestContext();
    contexts.push(ctx);
    const headers = { cookie: cookieOf(await ctx.login()) };
    const response = await ctx.app.inject({ url: '/api/v1/music/folders/al-1', headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      schemaVersion: 1,
      directory: {
        id: 'al-1',
        name: 'Synthetic Directory',
        child: [
          { id: 'al-2', title: 'Nested', isDir: true },
          {
            id: 'tr-1',
            parent: 'al-1',
            title: '가을 & Café + 100%',
            isDir: false,
            artist: 'Synthetic Artist',
            album: 'Mixed Tags',
            duration: 120,
            contentType: 'audio/mpeg',
          },
        ],
      },
    });
  });
  /** Every endpoint preserves permission/target failures and rejects malformed successful envelopes. */
  it.each([
    '/folders',
    '/folders?musicFolderId=0',
    '/folders/al-1',
    '/search?q=test',
    '/artists/ar-1',
    '/albums/al-1',
    '/random',
  ])('should keep error boundaries for %s', async (route) => {
    const ctx = await createTestContext();
    contexts.push(ctx);
    const headers = { cookie: cookieOf(await ctx.login()) };
    for (const [code, status, expected] of [
      [50, 403, 'forbidden'],
      [70, 404, 'not_found'],
    ] as const) {
      ctx.state.libraryError = code;
      const result = await ctx.app.inject({ url: '/api/v1/music' + route, headers });
      expect(result.statusCode).toBe(status);
      expect(result.json()).toEqual({
        schemaVersion: 1,
        error: { code: expected, retryable: false },
      });
      expect(result.body).not.toContain('synthetic-secret');
    }
    ctx.state.libraryError = 0;
    ctx.state.malformedLibrary = true;
    const malformed = await ctx.app.inject({ url: '/api/v1/music' + route, headers });
    expect(malformed.statusCode).toBe(503);
    expect(malformed.json()).toEqual({
      schemaVersion: 1,
      error: { code: 'upstream_unavailable', retryable: true },
    });
  });
});
