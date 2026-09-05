// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicEntry, PlaylistDetail, PlaylistSummary } from '@musiclatte/contracts';
import { Router } from '../src/app/Router';

const songA: MusicEntry = {
  id: 'song/A 한글',
  title: 'First song with a title that stays readable across narrow playlist layouts',
  artist: 'Fixture artist',
  album: 'Small hours',
  coverArt: 'cover/A',
  duration: 181,
  isDir: false,
};
const songB: MusicEntry = {
  id: 'song-B',
  title: 'Second song',
  duration: 245,
  isDir: false,
};
const revision = 'A'.repeat(43);
const playlistSummary: PlaylistSummary = {
  id: 'playlist / 한글?&',
  name: 'A very long afternoon playlist name that must wrap without hiding its song count',
  owner: 'fixture-listener',
  songCount: 3,
  created: '2026-09-05T00:00:00.000Z',
  changed: '2026-09-05T01:00:00.000Z',
  duration: 607,
  public: false,
  editable: true,
  coverState: 'fallback',
  revision,
};
const emptySummary: PlaylistSummary = {
  id: 'empty',
  name: 'Empty playlist',
  owner: 'fixture-listener',
  songCount: 0,
  created: '2026-09-05T00:00:00.000Z',
  changed: '2026-09-05T00:00:00.000Z',
  duration: 0,
  public: false,
  editable: true,
  coverState: 'fallback',
  revision: 'B'.repeat(43),
};
const summaries = [playlistSummary, emptySummary];

class FakeAudio extends EventTarget {
  src = '';
  currentTime = 0;
  duration = 181;
  volume = 1;
  paused = true;
  ended = false;
  error: MediaError | null = null;
  load = vi.fn();
  pause = vi.fn(() => {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  });
  play = vi.fn<() => Promise<void>>(async () => {});

  emit(type: string) {
    if (type === 'playing') this.paused = false;
    this.dispatchEvent(new Event(type));
  }
}

function createTestContext() {
  let signedIn = true;
  let playlistCapability: 'available' | 'denied' | 'temporarily_unavailable' = 'available';
  let detailFailure = '';
  let pendingId = '';
  let finishPending: ((response: Response) => void) | undefined;
  const calls: URL[] = [];
  const details = new Map<string, PlaylistDetail>([
    [
      playlistSummary.id,
      {
        ...playlistSummary,
        coverState: 'available',
        coverArt: 'cover/A',
        entries: [
          { position: 0, song: songA },
          { position: 1, song: songB },
          { position: 2, song: { ...songA } },
        ],
      },
    ],
    [emptySummary.id, { ...emptySummary, entries: [] }],
  ]);
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input), 'http://localhost');
    calls.push(url);
    if (url.pathname.endsWith('/session'))
      return signedIn
        ? Response.json({
            schemaVersion: 1,
            authScheme: 'cookie',
            username: 'fixture-listener',
            role: 'user',
            expiresAt: Date.now() + 3_600_000,
            csrfToken: 'synthetic-csrf',
          })
        : Response.json({ error: { code: 'unauthenticated' } }, { status: 401 });
    if (url.pathname.endsWith('/capabilities'))
      return Response.json({
        schemaVersion: 1,
        instanceId: 'fixture',
        revision: 'playlist-read',
        features: {
          'music.browse': { supported: true, permission: 'allowed', availability: 'available' },
          'music.stream': { supported: true, permission: 'allowed', availability: 'available' },
          'playlists.read': {
            supported: true,
            permission: playlistCapability === 'denied' ? 'denied' : 'allowed',
            availability:
              playlistCapability === 'temporarily_unavailable'
                ? 'temporarily_unavailable'
                : 'available',
          },
        },
      });
    if (url.pathname === '/api/v1/playlists')
      return Response.json({ schemaVersion: 1, playlists: summaries });
    if (url.pathname.startsWith('/api/v1/playlists/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/v1/playlists/'.length));
      if (detailFailure) {
        const status =
          detailFailure === 'unauthenticated' ? 401 : detailFailure === 'forbidden' ? 403 : 503;
        if (status === 401) signedIn = false;
        return Response.json({ error: { code: detailFailure } }, { status });
      }
      const playlist = details.get(id);
      if (!playlist) return Response.json({ error: { code: 'not_found' } }, { status: 404 });
      if (id === pendingId)
        return new Promise<Response>((resolve) => {
          finishPending = resolve;
        });
      return Response.json({ schemaVersion: 1, playlist });
    }
    throw new Error(`Unexpected endpoint ${url.pathname}`);
  };
  return {
    fetcher,
    calls,
    setCapability(value: typeof playlistCapability) {
      playlistCapability = value;
    },
    failDetail(value: string) {
      detailFailure = value;
    },
    delayDetail(id: string) {
      pendingId = id;
    },
    finishDelayed(playlist: PlaylistDetail) {
      finishPending?.(Response.json({ schemaVersion: 1, playlist }));
    },
  };
}

function makeSUT(path = '/playlists', context = createTestContext()) {
  const audio = new FakeAudio();
  localStorage.setItem('musiclatte.locale', 'en');
  window.history.replaceState(null, '', path);
  render(
    <Router
      fetcher={context.fetcher}
      apiOrigin="https://api.example.test"
      audioFactory={() => audio}
    />,
  );
  return { audio, context, user: userEvent.setup() };
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

describe('playlist read UI', () => {
  /** List navigation avoids detail fan-out and ordered playback preserves duplicate occurrences. */
  it('should browse opaque playlists and play every occurrence in its original order', async () => {
    const { audio, context, user } = makeSUT();
    expect(await screen.findByRole('heading', { name: 'Playlists' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Playlists' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(context.calls.filter((call) => call.pathname === '/api/v1/playlists')).toHaveLength(1);
    expect(context.calls.some((call) => call.pathname.startsWith('/api/v1/playlists/'))).toBe(
      false,
    );

    await user.click(
      screen.getByRole('link', {
        name: /A very long afternoon playlist name that must wrap without hiding its song count/,
      }),
    );
    expect(await screen.findByRole('heading', { name: playlistSummary.name })).toBeTruthy();
    expect(window.location.pathname).toBe('/playlists/playlist%20%2F%20%ED%95%9C%EA%B8%80%3F%26');
    expect(screen.getAllByText(songA.title)).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Play Second song' }));
    expect(audio.src).toContain('/songs/song-B/stream');
    await user.click(screen.getAllByRole('button', { name: 'Next track' })[0]!);
    expect(audio.src).toContain('/songs/song%2FA%20%ED%95%9C%EA%B8%80/stream');

    await user.click(screen.getByRole('button', { name: 'Play playlist' }));
    expect(audio.src).toContain('/songs/song%2FA%20%ED%95%9C%EA%B8%80/stream');
    act(() => audio.emit('playing'));
    await user.click(screen.getAllByRole('button', { name: 'Next track' })[0]!);
    expect(audio.src).toContain('/songs/song-B/stream');
    await user.click(screen.getAllByRole('button', { name: 'Next track' })[0]!);
    expect(audio.src).toContain('/songs/song%2FA%20%ED%95%9C%EA%B8%80/stream');
  });

  /** Empty, missing-cover, and temporary-error states do not clear an established player queue. */
  it('should preserve current playback while showing recoverable playlist states', async () => {
    const { audio, context, user } = makeSUT(
      `/playlists/${encodeURIComponent(playlistSummary.id)}`,
    );
    await user.click(await screen.findByRole('button', { name: 'Play playlist' }));
    const headerArtwork = screen.getByRole('img', { name: playlistSummary.name });
    const image = headerArtwork.querySelector('img');
    expect(image).not.toBeNull();
    fireEvent.error(image!);
    expect(headerArtwork.getAttribute('data-state')).toBe('failure');

    await user.click(screen.getByRole('link', { name: 'Playlists' }));
    await user.click(await screen.findByRole('link', { name: /Empty playlist/ }));
    expect(await screen.findByText('This playlist is empty')).toBeTruthy();
    expect(audio.src).toContain('/songs/song%2FA%20%ED%95%9C%EA%B8%80/stream');

    context.failDetail('upstream_unavailable');
    act(() => {
      window.history.pushState(null, '', `/playlists/${encodeURIComponent(playlistSummary.id)}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect((await screen.findByRole('alert')).textContent).toContain('Cannot reach the server');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(audio.src).toContain('/songs/song%2FA%20%ED%95%9C%EA%B8%80/stream');
  });

  /** Route generation discards obsolete detail responses and a 401 returns to the same safe deep link. */
  it('should discard stale detail responses and reauthenticate at the playlist deep link', async () => {
    const context = createTestContext();
    context.delayDetail(playlistSummary.id);
    makeSUT(`/playlists/${encodeURIComponent(playlistSummary.id)}`, context);
    await waitFor(() =>
      expect(context.calls.some((call) => call.pathname.startsWith('/api/v1/playlists/'))).toBe(
        true,
      ),
    );
    act(() => {
      window.history.pushState(null, '', '/playlists/empty');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(await screen.findByRole('heading', { name: 'Empty playlist' })).toBeTruthy();
    act(() => context.finishDelayed({ ...playlistSummary, entries: [] }));
    expect(screen.queryByRole('heading', { name: playlistSummary.name })).toBeNull();

    context.failDetail('unauthenticated');
    act(() => {
      window.history.pushState(null, '', `/playlists/${encodeURIComponent(playlistSummary.id)}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(await screen.findByLabelText('Username')).toBeTruthy();
    expect(new URLSearchParams(window.location.search).get('returnTo')).toBe(
      `/playlists/${encodeURIComponent(playlistSummary.id)}`,
    );
  });

  /** Capability denial blocks direct requests while KO/EN copy changes without changing playlist data. */
  it('should gate direct routes and localize the available playlist presentation', async () => {
    const denied = createTestContext();
    denied.setCapability('denied');
    makeSUT('/playlists', denied);
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeTruthy();
    expect(denied.calls.some((call) => call.pathname === '/api/v1/playlists')).toBe(false);
    cleanup();

    const { user } = makeSUT();
    expect(await screen.findByText('2 playlists')).toBeTruthy();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'ko');
    expect(await screen.findByRole('heading', { name: '재생목록' })).toBeTruthy();
    expect(screen.getByText('재생목록 2개')).toBeTruthy();
    expect(screen.getByText(playlistSummary.name)).toBeTruthy();
  });
});
