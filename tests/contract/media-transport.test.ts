import { mediaRoutes } from '../../packages/contracts/src/index.js';
import { syntheticCoverFixture } from '../../packages/test-support/src/media-fixtures.js';
import { afterEach, describe, expect, it } from 'vitest';
import { cookieOf, createTestContext } from '../support/auth-harness.js';

describe('media transport contract', () => {
  const contexts: Awaited<ReturnType<typeof createTestContext>>[] = [];

  afterEach(async () => {
    for (const context of contexts.splice(0)) await context.cleanup();
  });

  /** Browser route builders encode opaque IDs into fixed same-origin paths only. */
  it('should expose fixed secret-free media route builders', () => {
    expect(mediaRoutes.songStream('한글 /?u=other')).toBe(
      '/api/v1/media/songs/%ED%95%9C%EA%B8%80%20%2F%3Fu%3Dother/stream',
    );
    expect(mediaRoutes.cover('cover + 1')).toBe('/api/v1/media/cover/cover%20%2B%201');
    expect(() => mediaRoutes.songStream('')).toThrow();
  });

  /** The public cover contract returns exact bytes without a Subsonic wrapper or secret query. */
  it('should serve authenticated cover bytes through a clean BFF URL', async () => {
    const context = await createTestContext();
    contexts.push(context);
    const headers = { cookie: cookieOf(await context.login()) };
    context.requests.length = 0;
    const response = await context.app.inject({
      url: '/api/v1/media/cover/cover-1',
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(syntheticCoverFixture);
    expect(response.headers['content-type']).toBe('image/svg+xml');
    expect(response.body).not.toContain('subsonic-response');
    expect(context.mediaRequests[0]!.url.searchParams.has('t')).toBe(true);
    expect(response.headers).not.toHaveProperty('x-synthetic-secret');
  });
});
