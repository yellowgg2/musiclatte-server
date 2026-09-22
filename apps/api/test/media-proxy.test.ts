import {
  syntheticAudioFixture,
  syntheticMediaMetadata,
} from '../../../packages/test-support/src/media-fixtures.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    vi.restoreAllMocks();
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

  /** Concurrent media loads share one identity check instead of flooding the upstream server. */
  it('should coalesce concurrent identity checks for one media session', async () => {
    const context = await makeSUT();
    let releaseIdentity!: () => void;
    const identityGate = new Promise<void>((resolve) => {
      releaseIdentity = resolve;
    });
    context.state.identityResponseGate = () => identityGate;
    const pending = Array.from({ length: 8 }, (_, index) =>
      context.app.inject({
        url: `/api/v1/media/cover/cover-${index}`,
        headers: context.headers,
      }),
    );
    await expect
      .poll(() => context.requests.filter((request) => request.pathname === '/rest/getUser').length)
      .toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const identityRequestCount = context.requests.filter(
      (request) => request.pathname === '/rest/getUser',
    ).length;
    releaseIdentity();
    const responses = await Promise.all(pending);
    expect(identityRequestCount).toBe(1);
    expect(responses.map((response) => response.statusCode)).toEqual(Array(8).fill(200));
    expect(context.mediaRequests).toHaveLength(8);
  });

  /** Browser connection limits split one cover burst into waves; settled waves still reuse identity. */
  it('should reuse a successful identity check across sequential media waves', async () => {
    const context = await makeSUT();
    const first = await context.app.inject({
      url: '/api/v1/media/cover/cover-1',
      headers: context.headers,
    });
    const second = await context.app.inject({
      url: '/api/v1/media/cover/cover-2',
      headers: context.headers,
    });

    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    expect(context.requests.filter((request) => request.pathname === '/rest/getUser')).toHaveLength(
      1,
    );
    expect(context.mediaRequests).toHaveLength(2);
  });

  /** Reuse is burst-scoped; later media requests revalidate the upstream account. */
  it('should expire a reused media identity after the burst window', async () => {
    const context = await makeSUT();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    expect(
      (
        await context.app.inject({
          url: '/api/v1/media/cover/cover-1',
          headers: context.headers,
        })
      ).statusCode,
    ).toBe(200);
    clock.mockReturnValue(now + 5_001);
    expect(
      (
        await context.app.inject({
          url: '/api/v1/media/cover/cover-2',
          headers: context.headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(context.requests.filter((request) => request.pathname === '/rest/getUser')).toHaveLength(
      2,
    );
  });

  /** A transient upstream identity failure is retried rather than poisoning the burst cache. */
  it('should never reuse a failed media identity check', async () => {
    const context = await makeSUT();
    context.state.status = 503;
    const failed = await context.app.inject({
      url: '/api/v1/media/cover/cover-1',
      headers: context.headers,
    });
    context.state.status = 200;
    const retried = await context.app.inject({
      url: '/api/v1/media/cover/cover-2',
      headers: context.headers,
    });

    expect(failed.statusCode).toBe(503);
    expect(retried.statusCode).toBe(200);
    expect(context.requests.filter((request) => request.pathname === '/rest/getUser')).toHaveLength(
      2,
    );
  });

  /** One disconnected cover request cannot cancel the identity check still used by another request. */
  it('should preserve a shared identity check while another media subscriber remains', async () => {
    const context = await makeSUT(5_000);
    const address = await context.app.listen({ port: 0, host: '127.0.0.1' });
    let releaseIdentity!: () => void;
    const identityGate = new Promise<void>((resolve) => {
      releaseIdentity = resolve;
    });
    context.state.identityResponseGate = () => identityGate;
    const cancelled = new AbortController();
    const first = fetch(`${address}/api/v1/media/cover/cover-1`, {
      headers: context.headers,
      signal: cancelled.signal,
    }).catch(() => undefined);
    const second = fetch(`${address}/api/v1/media/cover/cover-2`, {
      headers: context.headers,
    });
    await expect
      .poll(() => context.requests.filter((request) => request.pathname === '/rest/getUser').length)
      .toBe(1);
    cancelled.abort();
    await first;
    releaseIdentity();
    expect((await second).status).toBe(200);
    expect(context.requests.filter((request) => request.pathname === '/rest/getUser')).toHaveLength(
      1,
    );
    expect(context.mediaRequests).toHaveLength(1);
  });

  /** HTTP/2 cover bursts cannot fan out without bound into the upstream music server. */
  it('should bound concurrent upstream cover requests', async () => {
    const context = await makeSUT(5_000);
    let releaseMedia!: () => void;
    const mediaGate = new Promise<void>((resolve) => {
      releaseMedia = resolve;
    });
    context.state.mediaResponseGate = () => mediaGate;
    const pending = Array.from({ length: 12 }, (_, index) =>
      context.app.inject({
        url: `/api/v1/media/cover/cover-${index}`,
        headers: context.headers,
      }),
    );
    await expect.poll(() => context.mediaRequests.length).toBeGreaterThanOrEqual(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const concurrentUpstreamRequests = context.mediaRequests.length;
    releaseMedia();
    const responses = await Promise.all(pending);

    expect(concurrentUpstreamRequests).toBeLessThanOrEqual(1);
    expect(responses.map((response) => response.statusCode)).toEqual(Array(12).fill(200));
    expect(context.mediaRequests).toHaveLength(12);
  });

  /** A cover permit stays occupied until its response body closes, not merely until headers arrive. */
  it('should hold the cover permit through response body streaming', async () => {
    const context = await makeSUT(5_000);
    const address = await context.app.listen({ port: 0, host: '127.0.0.1' });
    context.state.mediaStallAfterFirstChunk = true;
    const firstController = new AbortController();
    const first = await fetch(`${address}/api/v1/media/cover/cover-1`, {
      headers: context.headers,
      signal: firstController.signal,
    });
    expect((await first.body!.getReader().read()).done).toBe(false);
    const secondController = new AbortController();
    const second = fetch(`${address}/api/v1/media/cover/cover-2`, {
      headers: context.headers,
      signal: secondController.signal,
    }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const concurrentUpstreamRequests = context.mediaRequests.length;
    firstController.abort();
    secondController.abort();
    await second;

    expect(concurrentUpstreamRequests).toBe(1);
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

/** Recent pages reuse media URLs for every song ID allowed by the public contract. */
it('should stream a long opaque recent song ID within the 2048 character contract', async () => {
  const context = await createTestContext();
  try {
    const headers = { cookie: cookieOf(await context.login()) };
    const id = `recent-${'x'.repeat(480)}`;
    const response = await context.app.inject({
      method: 'GET',
      url: `/api/v1/media/songs/${encodeURIComponent(id)}/stream`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(context.mediaRequests[0]?.url.searchParams.get('id')).toBe(id);
  } finally {
    await context.cleanup();
  }
});
