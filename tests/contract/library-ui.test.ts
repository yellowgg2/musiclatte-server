import { afterEach, describe, expect, it } from 'vitest';
import { createMusicClient } from '../../apps/web/src/music/client.js';
import { musicRoute } from '../../apps/web/src/music/queries.js';
import { createTestContext, cookieOf } from '../support/auth-harness.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function makeSUT() {
  const context = await createTestContext();
  cleanups.push(context.cleanup);
  const cookie = cookieOf(await context.login());
  const fetcher: typeof fetch = async (input) => {
    const response = await context.app.inject({ url: String(input), headers: { cookie } });
    return new Response(response.body, { status: response.statusCode });
  };
  const client = createMusicClient({ fetcher });
  return {
    context,
    read: (path: string) => client.read(musicRoute(path)!, new AbortController().signal),
  };
}
describe('S07 producer to S08 consumer', () => {
  /** Real Fastify schemas and Subsonic decoding produce every browser view without fixture shape drift. */
  it('should decode root, indexes, folders, search, artists and albums through the authenticated API', async () => {
    const { read } = await makeSUT();
    for (const [path, kind] of [
      ['/music', 'folders'],
      ['/music?musicFolderId=0', 'indexes'],
      ['/music/folders/al-1', 'folder'],
      ['/music/search?q=%ED%95%9C%EA%B8%80%26', 'search'],
      ['/music/artists/ar-1', 'artist'],
      ['/music/albums/al-1', 'album'],
    ])
      expect((await read(path!)).kind).toBe(kind);
  });
  /** Empty content is successful data; missing IDs and outages remain distinguishable errors. */
  it('should preserve empty and scoped error semantics without surfacing upstream messages', async () => {
    const { context, read } = await makeSUT();
    context.state.emptyLibrary = true;
    expect(await read('/music/search?q=empty')).toEqual({
      kind: 'search',
      result: { artist: [], album: [], song: [] },
    });
    context.state.libraryError = 70;
    await expect(read('/music/folders/missing')).rejects.toMatchObject({ code: 'not_found' });
    context.state.libraryError = 0;
    context.state.malformedLibrary = true;
    await expect(read('/music/search?q=retry')).rejects.toMatchObject({
      code: 'upstream_unavailable',
    });
  });
  /** Artist, album and song offsets remain independent and use the original search3 count contract. */
  it('should pass encoded scope and independent offsets to gonic', async () => {
    const { context, read } = await makeSUT();
    await read(
      '/music/search?q=%ED%95%9C%EA%B8%80%26&musicFolderId=0&artistOffset=20&albumOffset=40&songOffset=60',
    );
    const query = context.requests.find((url) => url.pathname.endsWith('/search3'))!.searchParams;
    expect(query.get('query')).toBe('한글&');
    expect(query.get('musicFolderId')).toBe('0');
    expect(['artistOffset', 'albumOffset', 'songOffset'].map((key) => query.get(key))).toEqual([
      '20',
      '40',
      '60',
    ]);
    expect(['artistCount', 'albumCount', 'songCount'].map((key) => query.get(key))).toEqual([
      '20',
      '20',
      '20',
    ]);
  });
});
