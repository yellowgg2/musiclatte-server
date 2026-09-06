// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from '../src/app/Router';
import type { MusicEntry, MusicSearchResult } from '@musiclatte/contracts';

const song: MusicEntry = {
  id: 'song/한글?&',
  title: '아주 긴 노래 제목 — Afternoon & sunshine / 특별한 하루 '.repeat(4).trim(),
  isDir: false,
  artist: 'Daylight',
  artistId: 'artist/1',
  album: 'Small hours',
  albumId: 'album/1',
  duration: 185,
};
const result: MusicSearchResult = {
  song: [song],
  artist: [{ id: 'artist/1', name: 'Daylight', album: [] }],
  album: [{ id: 'album/1', name: 'Small hours', song: [] }],
};
function createTestContext() {
  let signedIn = true;
  let failure = '';
  let pending: ((value: Response) => void) | undefined;
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    calls.push({ url, ...(init ? { init } : {}) });
    if (url.pathname.endsWith('/session')) {
      if (init?.method === 'POST') signedIn = true;
      return signedIn
        ? Response.json({
            schemaVersion: 1,
            authScheme: 'cookie',
            username: 'fixture-listener',
            role: 'user',
            expiresAt: Date.now() + 3600000,
            csrfToken: 'synthetic-csrf',
          })
        : Response.json({ error: { code: 'unauthenticated' } }, { status: 401 });
    }
    if (url.pathname.endsWith('/capabilities'))
      return Response.json({
        schemaVersion: 1,
        instanceId: 'fixture',
        revision: 'one',
        features: {
          'music.browse': { supported: true, permission: 'allowed', availability: 'available' },
        },
      });
    if (failure)
      return Response.json(
        { error: { code: failure } },
        { status: failure === 'not_found' ? 404 : failure === 'unauthenticated' ? 401 : 503 },
      );
    if (url.pathname.endsWith('/search')) {
      const q = url.searchParams.get('q');
      if (q === 'old')
        return new Promise<Response>((resolve) => {
          pending = resolve;
        });
      return Response.json({
        schemaVersion: 1,
        result:
          q === 'empty'
            ? { song: [], artist: [], album: [] }
            : {
                ...result,
                song:
                  q === 'pages'
                    ? Array.from({ length: 20 }, (_, i) => ({
                        ...song,
                        id: String(i),
                        title: `Page ${url.searchParams.get('songOffset') ?? '0'} song ${i}`,
                      }))
                    : [{ ...song, title: q === 'new' ? 'Newest result' : song.title }],
              },
      });
    }
    if (url.pathname.endsWith('/folders'))
      return Response.json(
        url.searchParams.has('musicFolderId')
          ? {
              schemaVersion: 1,
              indexes: {
                index: [
                  { name: 'D', artist: [{ id: 'dir/한글?&', name: 'Daylight folder', album: [] }] },
                ],
              },
            }
          : { schemaVersion: 1, folders: [{ id: 'root & 1', name: 'My music' }] },
      );
    if (url.pathname.includes('/folders/'))
      return Response.json({
        schemaVersion: 1,
        directory: {
          id: 'dir/한글?&',
          name: 'Daylight folder',
          child: [{ id: 'empty', title: 'Empty folder', isDir: true }, song],
        },
      });
    if (url.pathname.includes('/artists/'))
      return Response.json({
        schemaVersion: 1,
        artist: {
          id: 'artist/1',
          name: 'Daylight',
          album: [{ id: 'album/1', name: 'Small hours', song: [] }],
        },
      });
    if (url.pathname.includes('/albums/'))
      return Response.json({
        schemaVersion: 1,
        album: {
          id: 'album/1',
          name: 'Small hours',
          artist: 'Daylight',
          artistId: 'artist/1',
          song: [song],
        },
      });
    throw new Error(`Unexpected endpoint ${url.pathname}`);
  };
  return {
    fetcher,
    calls,
    fail: (value: string) => {
      failure = value;
    },
    signOut: () => {
      signedIn = false;
    },
    finishOld: () =>
      pending?.(
        Response.json({
          schemaVersion: 1,
          result: { ...result, song: [{ ...song, title: 'Obsolete result' }] },
        }),
      ),
  };
}
function makeSUT(path = '/music', context = createTestContext(), base = '/') {
  localStorage.setItem('musiclatte.locale', 'en');
  window.history.replaceState(null, '', path);
  const view = render(
    <Router fetcher={context.fetcher} base={base} apiOrigin="https://api.example.test" />,
  );
  return { context, view, user: userEvent.setup() };
}
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});
describe('library UI', () => {
  /** The first authenticated entry exposes browsing, while unfinished transport stays absent. */
  it('should enter music after login and drill through opaque folder IDs', async () => {
    const context = createTestContext();
    context.signOut();
    const { user } = makeSUT('/login', context);
    await user.type(await screen.findByLabelText('Username'), 'fixture-listener');
    await user.type(screen.getByLabelText('Password'), 'synthetic-password{Enter}');
    await waitFor(() =>
      expect(context.calls.some((c) => c.url.pathname.endsWith('/capabilities'))).toBe(true),
    );
    expect(screen.queryByRole('heading', { name: 'Music' })).not.toBeNull();
    await user.click(await screen.findByRole('link', { name: 'My music' }));
    await user.click(await screen.findByRole('link', { name: 'Daylight folder' }));
    expect(await screen.findAllByText(song.title)).toBeTruthy();
    expect(window.location.pathname).toBe('/music/folders/dir%2F%ED%95%9C%EA%B8%80%3F%26');
    expect(window.location.search).toContain('musicFolderId=root');
    expect(screen.queryByRole('button', { name: /play|random/i })).toBeNull();
    const call = context.calls.find((c) => c.url.pathname.includes('/music/folders/'))!;
    expect(call.url.origin).toBe('https://api.example.test');
    expect(call.url.search).toBe('');
    expect(call.init?.credentials).toBe('include');
    expect(call.init?.signal).toBeTruthy();
  });
  /** URL query identity wins even when upstream ignores abort and responds out of order. */
  it('should discard a late search response and restore the previous query on back', async () => {
    const { user, context } = makeSUT('/music/search?q=start');
    await screen.findByRole('navigation', { name: 'Main navigation' });
    expect(screen.queryByLabelText('Search music')).not.toBeNull();
    const input = screen.getByLabelText('Search music');
    await user.clear(input);
    await user.type(input, 'old{Enter}');
    await waitFor(() =>
      expect(context.calls.some((c) => c.url.searchParams.get('q') === 'old')).toBe(true),
    );
    await user.clear(input);
    await user.type(input, 'new{Enter}');
    expect(await screen.findByText('Newest result')).toBeTruthy();
    await act(async () => context.finishOld());
    expect(screen.queryByText('Obsolete result')).toBeNull();
    expect(new URLSearchParams(window.location.search).get('q')).toBe('new');
    expect(
      context.calls.find((c) => c.url.searchParams.get('q') === 'old')?.init?.signal?.aborted,
    ).toBe(true);
    await act(async () => window.history.back());
    await waitFor(() =>
      expect((screen.getByLabelText('Search music') as HTMLInputElement).value).toBe('old'),
    );
  });
  /** Search keeps scope, pagination, original IDs and detail routes through navigation and reload. */
  it('should preserve search scope and traverse artist and album details', async () => {
    const { user, context, view } = makeSUT(
      '/latte/music/search?q=%ED%95%9C%EA%B8%80%26&musicFolderId=root%20%26%201',
      undefined,
      '/latte/',
    );
    await user.click(await screen.findByRole('link', { name: 'Daylight' }));
    expect(await screen.findByRole('heading', { name: 'Daylight' })).toBeTruthy();
    await user.click(screen.getByRole('link', { name: 'Small hours' }));
    expect(await screen.findByRole('heading', { name: 'Small hours' })).toBeTruthy();
    expect(screen.getAllByText(song.title)).toBeTruthy();
    const path = window.location.pathname + window.location.search;
    view.unmount();
    makeSUT(path, context, '/latte/');
    expect(await screen.findByRole('heading', { name: 'Small hours' })).toBeTruthy();
    expect(
      context.calls
        .find((c) => c.url.pathname.endsWith('/search'))
        ?.url.searchParams.get('musicFolderId'),
    ).toBe('root & 1');
  });
  /** Empty and missing results stay in the library with a localized recovery path. */
  it('should recover from a scoped error and distinguish empty search and missing ID', async () => {
    const context = createTestContext();
    context.fail('upstream_unavailable');
    const { user } = makeSUT('/music/search?q=empty', context);
    expect((await screen.findByRole('alert')).textContent).toContain('Cannot reach the server');
    expect(screen.getByLabelText('Search music')).toBeTruthy();
    context.fail('');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No matches found')).toBeTruthy();
    context.fail('not_found');
    await user.clear(screen.getByLabelText('Search music'));
    await user.type(screen.getByLabelText('Search music'), 'missing{Enter}');
    expect(await screen.findByText('Music not found')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'All music' })).toBeTruthy();
  });
  /** A successful full page offers independent offset navigation without inventing totals. */
  it('should advance song pages and retain the query in the URL', async () => {
    const { user, context } = makeSUT('/music/search?q=pages');
    expect(await screen.findByText('Page 0 song 0')).toBeTruthy();
    await user.click(screen.getByRole('link', { name: 'Next songs' }));
    expect(await screen.findByText('Page 20 song 0')).toBeTruthy();
    expect(new URLSearchParams(window.location.search).get('songOffset')).toBe('20');
    expect(context.calls.at(-1)?.url.searchParams.get('q')).toBe('pages');
  });
  /** Expired library credentials clear protected results and preserve a safe query return target. */
  it('should reauthenticate on a library 401 without losing the deep link', async () => {
    const context = createTestContext();
    context.fail('unauthenticated');
    context.signOut();
    const { user } = makeSUT('/music/search?q=hello%26world', context);
    await user.type(await screen.findByLabelText('Username'), 'fixture-listener');
    context.fail('');
    await user.type(screen.getByLabelText('Password'), 'synthetic-password{Enter}');
    expect(await screen.findAllByText(song.title)).toBeTruthy();
    expect(new URLSearchParams(window.location.search).get('q')).toBe('hello&world');
  });
  /** Locale switches preserve content and the search URL while translating controls. */
  it('should keep long original content and query while changing language', async () => {
    const { user } = makeSUT('/music/search?q=hello');
    expect(await screen.findAllByText(song.title)).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Language'), 'ko');
    expect(await screen.findByLabelText('음악 검색')).toBeTruthy();
    expect(screen.getAllByText(song.title)).toBeTruthy();
    expect(window.location.search).toBe('?q=hello');
    expect(within(screen.getByRole('main')).queryByRole('button', { name: /재생/ })).toBeNull();
  });
});

describe('library regression boundaries', () => {
  /** A revoked music request clears the signed-in UI rather than leaving protected data visible. */
  it('should clear a signed-in library on a 401 and keep its search return path', async () => {
    const context = createTestContext();
    context.fail('unauthenticated');
    makeSUT('/music/search?q=revoked', context);
    expect(await screen.findByLabelText('Username')).toBeTruthy();
    expect(new URLSearchParams(window.location.search).get('returnTo')).toBe(
      '/music/search?q=revoked',
    );
    expect(screen.queryByText(song.title)).toBeNull();
  });
  /** The gallery renders and exercises the exact shared music-row play action without real media. */
  it('should expose the shared music row in the development gallery', async () => {
    const { Gallery } = await import('../src/dev/Gallery');
    render(<Gallery />);
    expect(document.querySelector('#music-row')).not.toBeNull();
    const gallery = document.querySelector<HTMLElement>('#music-row')!;
    expect(gallery.querySelectorAll('li').length).toBeGreaterThanOrEqual(2);
    const play = within(gallery).getAllByRole('button', { name: /재생$/ })[0]!;
    await userEvent.setup().click(play);
    expect(within(gallery).getAllByRole('button', { name: /일시 정지$/ })).toHaveLength(1);
    const select = within(gallery).getAllByRole('checkbox')[0]!;
    await userEvent.setup().click(select);
    expect((select as HTMLInputElement).checked).toBe(true);
  });
  /** Unsafe dot path segments cannot become requests to a different endpoint after URL normalization. */
  it('should reject encoded traversal while accepting canonical opaque deep links', async () => {
    const { safeReturnPath } = await import('../src/auth/guards');
    expect(safeReturnPath('/music/folders/%2e%2e')).toBe('/music');
    expect(safeReturnPath('/music/search?q=a%26b')).toBe('/music/search?q=a%26b');
    expect(safeReturnPath('/music/search?q=a&q=b')).toBe('/music');
    expect(safeReturnPath('//evil.test/music')).toBe('/music');
  });
  /** Browser history restores the actual previous list position after async content is available. */
  it('should save and restore list scroll position during drill-in and back', async () => {
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(420);
    const { user } = makeSUT('/music?musicFolderId=root');
    await user.click(await screen.findByRole('link', { name: 'Daylight folder' }));
    await screen.findByRole('heading', { name: 'Daylight folder' });
    await act(async () => window.history.back());
    await screen.findByRole('link', { name: 'Daylight folder' });
    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ top: 420, behavior: 'instant' }));
  });
});

describe('compact song details', () => {
  /** Expanding a song reveals its complete title in place, without a second repeated title block. */
  it('should show one full title with compact artist and album navigation when expanded', async () => {
    const { MusicRow } = await import('../src/music/components/MusicRow');
    render(
      <ul>
        <MusicRow song={song} locale="en" />
      </ul>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByText(song.title).closest('summary')!);
    await waitFor(() => expect(document.querySelector('details')?.open).toBe(true));
    expect(screen.getAllByText(song.title)).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'View artist: Daylight' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View album: Small hours' })).toBeTruthy();
  });
  /** Missing optional tags provide one concise localized note rather than empty information cards. */
  it('should keep missing metadata compact and localized without empty links', async () => {
    const { MusicRow } = await import('../src/music/components/MusicRow');
    render(
      <ul>
        <MusicRow song={{ id: 'untagged', title: '이름 없는 곡', isDir: false }} locale="ko" />
      </ul>,
    );
    await userEvent.setup().click(screen.getByText('이름 없는 곡').closest('summary')!);
    expect(await screen.findByText('연결된 아티스트나 앨범 정보가 없어요.')).toBeTruthy();
    expect(screen.getAllByText('이름 없는 곡')).toHaveLength(1);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
