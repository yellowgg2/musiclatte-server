import { inspect } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createTestContext,
  failed,
  loadClient,
  ok,
  proof,
  type ClientOptions,
  type Scenario,
} from '../../../tests/support/subsonic-harness.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});
async function makeSUT(scenario: Scenario = {}, overrides: Partial<ClientOptions> = {}) {
  const ctx = await createTestContext(scenario, overrides);
  cleanups.push(() => ctx.upstream.close());
  return ctx;
}

async function makeCollectionSUT(scenario: Scenario = {}) {
  return makeSUT({ ...scenario, collections: true });
}

describe('Subsonic adapter', () => {
  /** Metadata requests use the fixed origin, JSON protocol and BFF token identity. */
  it('should send token proof and return ping through real HTTP', async () => {
    const { client, upstream } = await makeSUT();
    await expect(client.ping()).resolves.toEqual({ status: 'ok', version: '1.15.0' });
    const url = upstream.requests[0]!;
    expect(url.pathname).toBe('/rest/ping');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      u: proof.username,
      t: proof.t,
      s: proof.s,
      v: '1.15.0',
      c: 'musiclatte-web',
      f: 'json',
    });
  });
  /** Identity comes from the authenticated server response, never a submitted alias or folder ACL. */
  it('should return actual identity and discard the fixed folder array', async () => {
    const { client, upstream } = await makeSUT({
      body: ok({ user: { username: 'actual-account', adminRole: true, folder: [1] } }),
    });
    await expect(client.currentUser()).resolves.toEqual({
      username: 'actual-account',
      adminRole: true,
    });
    expect(upstream.requests[0]!.searchParams.get('username')).toBe(proof.username);
  });
  /** Invalid role or username cannot silently grant management rights. */
  it.each([
    { username: 'fixture' },
    { username: '', adminRole: true },
    { username: 'fixture', adminRole: 'true' },
  ])('should reject incomplete account evidence %j', async (user) => {
    const { client } = await makeSUT({ body: ok({ user }) });
    await expect(client.currentUser()).rejects.toMatchObject({ kind: 'invalid_response' });
  });
  /** Opaque IDs remain a single query value even when they contain URL syntax. */
  it('should preserve opaque IDs and encode search counts without URL injection', async () => {
    const { client, upstream } = await makeSUT();
    const id = '../https://other.invalid/한글?u=other&t=secret#%2F+&';
    await client.directory(id);
    await client.search('가을 + café & ? /', {
      artistCount: 0,
      albumCount: 4,
      songCount: 12,
      songOffset: 7,
    });
    expect(upstream.requests[0]!.pathname).toBe('/rest/getMusicDirectory');
    expect(upstream.requests[0]!.searchParams.getAll('id')).toEqual([id]);
    expect(upstream.requests[0]!.searchParams.getAll('u')).toEqual([proof.username]);
    expect(Object.fromEntries(upstream.requests[1]!.searchParams)).toMatchObject({
      query: '가을 + café & ? /',
      artistCount: '0',
      albumCount: '4',
      songCount: '12',
      songOffset: '7',
    });
  });
  /** Invalid input fails locally rather than issuing accidental broad queries. */
  it('should reject empty IDs and invalid counts before contacting upstream', async () => {
    const { client, upstream } = await makeSUT();
    await expect(client.directory('')).rejects.toMatchObject({ kind: 'invalid_request' });
    await expect(client.search('q', { songCount: -1 })).rejects.toMatchObject({
      kind: 'invalid_request',
    });
    await expect(client.random({ size: 1.5 })).rejects.toMatchObject({ kind: 'invalid_request' });
    expect(upstream.requests).toHaveLength(0);
  });
  /** The configuration accepts a trusted HTTP(S) origin without credentials or alternate path. */
  it.each([
    'file:///etc/passwd',
    'https://user:private@host.invalid',
    'https://host.invalid/subpath',
    'https://host.invalid/?t=private',
    'https://host.invalid/#private',
    'private-value',
  ])('should reject unsafe upstream configuration %s', async (upstream) => {
    const { createSubsonicClient } = await loadClient();
    expect(() => createSubsonicClient({ upstream, proof, timeoutMs: 100 })).toThrow(
      'invalid_configuration',
    );
  });
  /** A caller cannot mutate the pinned upstream proof after client creation. */
  it('should snapshot proof and hide credentials from client inspection', async () => {
    const supplied = { ...proof };
    const { client, upstream } = await makeSUT({}, { proof: supplied });
    supplied.username = 'changed';
    supplied.t = 'changed';
    await client.ping();
    expect(upstream.requests[0]!.searchParams.get('t')).toBe(proof.t);
    expect(inspect(client)).not.toContain(proof.t);
    expect(JSON.stringify(client)).not.toContain(proof.username);
  });
  /** A timeout remains active while the response body is pending as well as before headers. */
  it.each(['headers', 'body'] as const)('should time out stalled %s', async (stall) => {
    const { client } = await makeSUT({ stall }, { timeoutMs: 50 });
    await expect(client.ping()).rejects.toMatchObject({ kind: 'timeout' });
  });
  /** Caller abort reasons are never exposed and cancellation is distinct from timeout. */
  it('should cancel an in-flight request without exposing its reason', async () => {
    const { client, upstream } = await makeSUT({ stall: 'body' });
    const controller = new AbortController();
    const result = client.ping({ signal: controller.signal }).catch((error: unknown) => error);
    await upstream.waitForRequest();
    controller.abort(new Error('private-abort-reason'));
    const error = await result;
    expect(error).toMatchObject({ kind: 'cancelled' });
    expect(inspect(error)).not.toContain('private-abort-reason');
  });
  /** Already cancelled calls never reach the server. */
  it('should reject pre-aborted requests before HTTP', async () => {
    const { client, upstream } = await makeSUT();
    const controller = new AbortController();
    controller.abort();
    await expect(client.ping({ signal: controller.signal })).rejects.toMatchObject({
      kind: 'cancelled',
    });
    expect(upstream.requests).toHaveLength(0);
  });
  /** Redirects cannot forward token-bearing requests to a different origin. */
  it('should refuse upstream redirects without contacting the destination', async () => {
    const target = await makeSUT();
    const { client } = await makeSUT({ redirectTo: `${target.upstream.url}/rest/ping` });
    await expect(client.ping()).rejects.toMatchObject({ kind: 'http_error', httpStatus: 302 });
    expect(target.upstream.requests).toHaveLength(0);
  });
  /** Logs and errors contain only stable diagnostic fields, including network failures. */
  it.each(['standard', 'http', 'html', 'network'] as const)(
    'should redact %s failure details',
    async (mode) => {
      const secret = `${proof.username} ${proof.t} ${proof.s} private-search enc:70617373`;
      const scenario: Scenario =
        mode === 'standard'
          ? { body: failed(40, secret) }
          : mode === 'http'
            ? { status: 503, body: secret }
            : mode === 'html'
              ? { contentType: 'text/html', body: secret }
              : { disconnect: true };
      const events: Readonly<Record<string, unknown>>[] = [];
      const { client } = await makeSUT(scenario, { logger: (event) => events.push(event) });
      const error: unknown = await client.search('private-search').catch((error: unknown) => error);
      expect(error).toBeInstanceOf(Error);
      expect(events).toHaveLength(1);
      const serialized = `${inspect(error)} ${JSON.stringify(error)} ${JSON.stringify(events)}`;
      for (const value of [
        proof.username,
        proof.t,
        proof.s,
        'private-search',
        'enc:70617373',
        '/rest/',
        '127.0.0.1',
      ])
        expect(serialized).not.toContain(value);
      expect(events[0]).toMatchObject({ operation: 'search3', outcome: 'error' });
      if (mode === 'network') expect(error).toMatchObject({ kind: 'network' });
    },
  );
  /** Binary requests stay server-side and retain only the requested media parameters. */
  it('should build fixed-origin media requests without fetching media', async () => {
    const { client, upstream } = await makeSUT();
    const request = client.mediaRequest('stream', 'tr-1?x=2&u=other', {
      method: 'HEAD',
      range: 'bytes=10-20',
    });
    const url = new URL(request.url);
    expect(url.origin).toBe(upstream.url);
    expect(url.pathname).toBe('/rest/stream');
    expect(url.searchParams.get('id')).toBe('tr-1?x=2&u=other');
    expect(request.method).toBe('HEAD');
    expect(request.headers.get('range')).toBe('bytes=10-20');
    expect(request.redirect).toBe('manual');
    const cover = new URL(client.mediaRequest('getCoverArt', 'al-2', { size: 128 }).url);
    expect(cover.pathname).toBe('/rest/getCoverArt');
    expect(cover.searchParams.get('size')).toBe('128');
    expect(upstream.requests).toHaveLength(0);
  });

  /** Collection mutations expose named methods and preserve the source-defined pair order. */
  it('should encode explicit playlist and song-star mutations losslessly', async () => {
    const { client, upstream } = await makeCollectionSUT();

    await client.createPlaylist({
      name: '여름 + Café &',
      songIds: ['tr-A', 'tr-A', '한글+&%?'],
    });
    await client.createPlaylist({
      playlistId: 'pl-existing',
      name: '교체',
      songIds: ['tr-B', 'tr-A'],
    });
    await client.updatePlaylist({
      playlistId: 'pl-existing',
      name: 'renamed',
      songIdsToAdd: ['tr-A', 'tr-A'],
      songIndexesToRemove: [0, 2],
    });
    await client.deletePlaylist('pl-existing');
    await client.starSong('tr-A');
    await client.unstarSong('tr-A');

    expect(upstream.requests.map((url) => url.pathname)).toEqual([
      '/rest/createPlaylist',
      '/rest/createPlaylist',
      '/rest/updatePlaylist',
      '/rest/deletePlaylist',
      '/rest/star',
      '/rest/unstar',
    ]);
    expect(
      Array.from(upstream.requests[0]!.searchParams).filter(([key]) =>
        ['playlistId', 'name', 'songId'].includes(key),
      ),
    ).toEqual([
      ['name', '여름 + Café &'],
      ['songId', 'tr-A'],
      ['songId', 'tr-A'],
      ['songId', '한글+&%?'],
    ]);
    expect(
      Array.from(upstream.requests[1]!.searchParams).filter(([key]) =>
        ['playlistId', 'name', 'songId'].includes(key),
      ),
    ).toEqual([
      ['playlistId', 'pl-existing'],
      ['name', '교체'],
      ['songId', 'tr-B'],
      ['songId', 'tr-A'],
    ]);
    expect(
      Array.from(upstream.requests[2]!.searchParams).filter(([key]) =>
        ['playlistId', 'name', 'songIdToAdd', 'songIndexToRemove'].includes(key),
      ),
    ).toEqual([
      ['playlistId', 'pl-existing'],
      ['name', 'renamed'],
      ['songIdToAdd', 'tr-A'],
      ['songIdToAdd', 'tr-A'],
      ['songIndexToRemove', '0'],
      ['songIndexToRemove', '2'],
    ]);
    expect(
      upstream.requests.slice(3).map((url) => Array.from(url.searchParams.getAll('id'))),
    ).toEqual([['pl-existing'], ['tr-A'], ['tr-A']]);
  });

  /** Invalid collection input fails before credentials can reach the upstream server. */
  it('should reject empty collection IDs names and invalid removal indexes locally', async () => {
    const { client, upstream } = await makeCollectionSUT();

    await expect(client.createPlaylist({ name: '' })).rejects.toMatchObject({
      kind: 'invalid_request',
    });
    await expect(client.createPlaylist({ name: 'valid', songIds: [''] })).rejects.toMatchObject({
      kind: 'invalid_request',
    });
    await expect(client.updatePlaylist({ playlistId: '' })).rejects.toMatchObject({
      kind: 'invalid_request',
    });
    await expect(
      client.updatePlaylist({ playlistId: 'pl-1', songIndexesToRemove: [-1] }),
    ).rejects.toMatchObject({ kind: 'invalid_request' });
    await expect(
      client.updatePlaylist({ playlistId: 'pl-1', songIndexesToRemove: [1.5] }),
    ).rejects.toMatchObject({ kind: 'invalid_request' });
    await expect(client.deletePlaylist('')).rejects.toMatchObject({
      kind: 'invalid_request',
    });
    await expect(client.starSong('')).rejects.toMatchObject({ kind: 'invalid_request' });
    await expect(client.unstarSong('')).rejects.toMatchObject({ kind: 'invalid_request' });
    expect(upstream.requests).toHaveLength(0);
  });

  /** Collection traffic inherits HTTP, HTML, timeout and cancellation sanitization. */
  it.each(['http', 'html', 'timeout', 'cancel'] as const)(
    'should sanitize collection %s failures',
    async (mode) => {
      const scenario: Scenario =
        mode === 'http'
          ? { status: 503, body: 'private collection body' }
          : mode === 'html'
            ? { contentType: 'text/html', body: '<p>private collection message</p>' }
            : { stall: 'body' };
      const events: Readonly<Record<string, unknown>>[] = [];
      const { client, upstream } = await makeSUT(
        { ...scenario, collections: true },
        {
          timeoutMs: mode === 'timeout' ? 50 : 1000,
          logger: (event) => events.push(event),
        },
      );
      const controller = new AbortController();
      const result = client
        .getPlaylist('pl-private', { signal: controller.signal })
        .catch((error: unknown) => error);
      if (mode === 'cancel') {
        await upstream.waitForRequest();
        controller.abort(new Error('private collection abort'));
      }
      const error = await result;
      const serialized = `${inspect(error)} ${JSON.stringify(error)} ${JSON.stringify(events)}`;
      expect(serialized).not.toContain('private collection');
      expect(events[0]).toMatchObject({ operation: 'getPlaylist', outcome: 'error' });
      expect(error).toMatchObject({
        kind:
          mode === 'http'
            ? 'http_error'
            : mode === 'html'
              ? 'invalid_response'
              : mode === 'timeout'
                ? 'timeout'
                : 'cancelled',
      });
    },
  );
});
