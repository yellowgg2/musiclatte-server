import {
  syntheticAudioFixture,
  syntheticMediaMetadata,
} from '../../../packages/test-support/src/media-fixtures.js';
import { afterEach, describe, expect, it } from 'vitest';
import { cookieOf, createTestContext } from '../../../tests/support/auth-harness.js';

describe('authenticated media proxy', () => {
  const contexts: Awaited<ReturnType<typeof createTestContext>>[] = [];

  async function makeSUT(timeoutMs = 300) {
    const context = await createTestContext({ timeoutMs });
    contexts.push(context);
    const headers = { cookie: cookieOf(await context.login()) };
    context.requests.length = 0;
    return { ...context, headers };
  }

  afterEach(async () => {
    for (const context of contexts.splice(0)) await context.cleanup();
  });

  /** Both media resources and both safe methods require a valid browser session. */
  it.each([
    ['GET', '/api/v1/media/songs/song-1/stream'],
    ['HEAD', '/api/v1/media/songs/song-1/stream'],
    ['GET', '/api/v1/media/cover/cover-1'],
    ['HEAD', '/api/v1/media/cover/cover-1'],
  ] as const)('should reject unauthenticated %s %s before media I/O', async (method, url) => {
    const context = await createTestContext();
    contexts.push(context);
    const result = await context.app.inject({ method, url });
    expect(result.statusCode).toBe(401);
    expect(context.mediaRequests).toHaveLength(0);
  });

  /** A single byte range preserves opaque identity, status, body and seek headers. */
  it('should stream an exact byte range without exposing upstream credentials or headers', async () => {
    const context = await makeSUT();
    const id = '한글 / + % &?u=other';
    const result = await context.app.inject({
      url: `/api/v1/media/songs/${encodeURIComponent(id)}/stream`,
      headers: {
        ...context.headers,
        range: 'bytes=44-51',
        'if-range': syntheticMediaMetadata.lastModified,
      },
    });
    expect(result.statusCode).toBe(206);
    expect(result.rawPayload).toEqual(syntheticAudioFixture.subarray(44, 52));
    expect(result.headers).toMatchObject({
      'content-type': syntheticMediaMetadata.audioContentType,
      'content-length': '8',
      'content-range': `bytes 44-51/${syntheticAudioFixture.length}`,
      'accept-ranges': 'bytes',
      etag: syntheticMediaMetadata.etag,
      'last-modified': syntheticMediaMetadata.lastModified,
      'cache-control': 'private, max-age=60',
    });
    expect(result.headers).not.toHaveProperty('x-synthetic-secret');
    expect(result.body).not.toContain('synthetic-secret');
    expect(context.mediaRequests).toHaveLength(1);
    expect(context.mediaRequests[0]).toMatchObject({
      method: 'GET',
      range: 'bytes=44-51',
      ifRange: syntheticMediaMetadata.lastModified,
    });
    expect(context.mediaRequests[0]!.url.searchParams.getAll('id')).toEqual([id]);
    expect(context.mediaRequests[0]!.url.searchParams.has('p')).toBe(false);
    expect(context.mediaRequests[0]!.url.searchParams.has('format')).toBe(false);
  });

  /** HEAD reaches upstream as HEAD and returns the same metadata without a response body. */
  it('should preserve upstream HEAD metadata without downloading a body', async () => {
    const context = await makeSUT();
    const result = await context.app.inject({
      method: 'HEAD',
      url: '/api/v1/media/cover/cover-1',
      headers: context.headers,
    });
    expect(result.statusCode).toBe(200);
    expect(result.rawPayload).toHaveLength(0);
    expect(result.headers['content-type']).toBe('image/svg+xml');
    expect(Number(result.headers['content-length'])).toBeGreaterThan(0);
    expect(context.mediaRequests).toHaveLength(1);
    expect(context.mediaRequests[0]?.method).toBe('HEAD');
  });

  /** Browser validators are forwarded and a cache hit remains an empty 304 response. */
  it('should preserve cover cache validators and conditional responses', async () => {
    const context = await makeSUT();
    const result = await context.app.inject({
      url: '/api/v1/media/cover/cover-1',
      headers: {
        ...context.headers,
        'if-none-match': syntheticMediaMetadata.etag,
        'if-modified-since': syntheticMediaMetadata.lastModified,
      },
    });
    expect(result.statusCode).toBe(304);
    expect(result.rawPayload).toHaveLength(0);
    expect(result.headers.etag).toBe(syntheticMediaMetadata.etag);
    expect(result.headers['cache-control']).toBe('private, max-age=60');
    expect(context.mediaRequests[0]).toMatchObject({
      ifNoneMatch: syntheticMediaMetadata.etag,
      ifModifiedSince: syntheticMediaMetadata.lastModified,
    });
  });

  /** Unsatisfied ranges retain 416 and the total-length hint needed by media clients. */
  it('should preserve an upstream unsatisfied range without inventing a success body', async () => {
    const context = await makeSUT();
    const result = await context.app.inject({
      url: '/api/v1/media/songs/song-1/stream',
      headers: { ...context.headers, range: 'bytes=999999-' },
    });
    expect(result.statusCode).toBe(416);
    expect(result.rawPayload).toHaveLength(0);
    expect(result.headers['content-range']).toBe(`bytes */${syntheticAudioFixture.length}`);
  });

  /** Invalid Range and query input cannot become upstream parameters or alternate destinations. */
  it.each([
    ['/api/v1/media/songs/song-1/stream?format=mp3', undefined],
    ['/api/v1/media/cover/cover-1?size=128', undefined],
    ['/api/v1/media/songs/song-1/stream', 'items=0-1'],
  ])('should reject invalid media input for %s', async (url, range) => {
    const context = await makeSUT();
    const result = await context.app.inject({
      url,
      headers: { ...context.headers, ...(range ? { range } : {}) },
    });
    expect(result.statusCode).toBe(400);
    expect(context.mediaRequests).toHaveLength(0);
  });

  /** Header timeout closes the pending media request without revoking a still-valid session. */
  it('should bound upstream media headers and preserve the session through a timeout', async () => {
    const context = await makeSUT(30);
    context.state.mediaStallHeaders = true;
    const result = await context.app.inject({
      url: '/api/v1/media/songs/song-1/stream',
      headers: context.headers,
    });
    expect(result.statusCode).toBe(503);
    expect(result.json().error.code).toBe('upstream_unavailable');
    await expect.poll(() => context.state.closedMediaRequests).toBe(1);
    expect(
      (await context.app.inject({ url: '/api/v1/session', headers: context.headers })).statusCode,
    ).toBe(200);
  });

  /** Redirects, HTML successes and media failures become secret-free scoped API errors. */
  it.each([
    ['redirect', 0, '', 503, 'upstream_unavailable'],
    ['html', 0, 'text/html', 503, 'upstream_unavailable'],
    ['missing', 404, '', 404, 'not_found'],
    ['forbidden', 403, '', 403, 'forbidden'],
  ])('should sanitize %s upstream media responses', async (_name, status, type, expected, code) => {
    const context = await makeSUT();
    context.state.mediaStatus = Number(status);
    context.state.mediaContentType = String(type);
    if (_name === 'redirect') context.state.mediaRedirect = 'https://synthetic-secret.example.test';
    const result = await context.app.inject({
      url: '/api/v1/media/cover/cover-1',
      headers: context.headers,
    });
    expect(result.statusCode).toBe(expected);
    expect(result.json()).toEqual({
      schemaVersion: 1,
      error: { code, retryable: expected === 503 },
    });
    expect(result.body).not.toContain('synthetic-secret');
    expect(result.headers).not.toHaveProperty('location');
    expect(context.mediaRequests).toHaveLength(1);
  });

  /** A media authentication rejection revokes the stale session and clears its cookie. */
  it('should revoke a session when media credentials are rejected after identity verification', async () => {
    const context = await makeSUT();
    context.state.mediaStatus = 401;
    const result = await context.app.inject({
      url: '/api/v1/media/songs/song-1/stream',
      headers: context.headers,
    });
    expect(result.statusCode).toBe(401);
    expect(result.headers['set-cookie']).toContain('Max-Age=0');
    expect(
      (await context.app.inject({ url: '/api/v1/session', headers: context.headers })).statusCode,
    ).toBe(401);
  });

  /** The first chunk is observable before completion and browser cancellation closes upstream. */
  it('should stream incrementally and abort the upstream body when the browser disconnects', async () => {
    const context = await makeSUT(5_000);
    const address = await context.app.listen({ port: 0, host: '127.0.0.1' });
    context.state.mediaStallAfterFirstChunk = true;
    const controller = new AbortController();
    const response = await fetch(`${address}/api/v1/media/songs/song-1/stream`, {
      headers: context.headers,
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    const first = await response.body!.getReader().read();
    expect(first.done).toBe(false);
    expect(first.value?.byteLength).toBeGreaterThan(0);
    expect(first.value?.byteLength).toBeLessThan(syntheticAudioFixture.length);
    controller.abort();
    await expect.poll(() => context.state.closedMediaRequests).toBe(1);
  });
});
