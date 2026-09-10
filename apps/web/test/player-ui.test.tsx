// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicEntry } from '@musiclatte/contracts';

const songs = [
  {
    id: 'song / one',
    title: 'First patient song',
    artist: 'Fixture artist',
    album: 'Small hours',
    coverArt: 'cover one',
    duration: 180,
    isDir: false,
  },
  {
    id: 'song-two',
    title: 'Second song with a deliberately long localized-player-safe title',
    artist: 'Another artist',
    duration: 245,
    isDir: false,
  },
] satisfies MusicEntry[];

const longQueueSongs = [
  ...songs,
  ...Array.from({ length: 20 }, (_, index) => ({
    id: `queue-song-${index + 1}`,
    title: `Queue song ${index + 1} with a deliberately long localized-player-safe title`,
    artist: index % 2 === 0 ? '긴 대기열 아티스트' : 'Long queue artist',
    duration: 180 + index,
    isDir: false,
  })),
] satisfies MusicEntry[];

class FakeAudio extends EventTarget {
  src = '';
  currentTime = 0;
  duration = 180;
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
    if (type === 'ended') this.ended = true;
    this.dispatchEvent(new Event(type));
  }
}

function createTestContext(folderSongs: MusicEntry[] = songs) {
  let randomMode: 'success' | 'empty' | 'error' = 'success';
  const calls: URL[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    calls.push(url);
    if (url.pathname.endsWith('/session')) {
      if (init?.method === 'DELETE')
        return new Response(null, { status: 204, headers: { 'x-csrf-token': 'next' } });
      return Response.json({
        schemaVersion: 1,
        authScheme: 'cookie',
        username: 'fixture-listener',
        role: 'user',
        expiresAt: Date.now() + 3_600_000,
        csrfToken: 'synthetic-csrf',
      });
    }
    if (url.pathname.endsWith('/capabilities'))
      return Response.json({
        schemaVersion: 1,
        instanceId: 'fixture',
        revision: 'player',
        features: {
          'music.browse': { supported: true, permission: 'allowed', availability: 'available' },
          'music.stream': { supported: true, permission: 'allowed', availability: 'available' },
          'imports.youtube': { supported: true, permission: 'allowed', availability: 'available' },
          'library.randomSongs': {
            supported: true,
            permission: 'allowed',
            availability: 'available',
          },
        },
      });
    if (url.pathname.endsWith('/imports'))
      return Response.json({
        schemaVersion: 1,
        jobs: [],
        libraries: [{ id: 'music' }],
        nextCursor: null,
      });
    if (url.pathname.endsWith('/folders/fixture'))
      return Response.json({
        schemaVersion: 1,
        directory: { id: 'fixture', name: 'Fixture folder', child: folderSongs },
      });
    if (url.pathname.endsWith('/random')) {
      if (randomMode === 'error')
        return Response.json({ error: { code: 'upstream_unavailable' } }, { status: 503 });
      return Response.json({
        schemaVersion: 1,
        songs: randomMode === 'empty' ? [] : songs.slice().reverse(),
      });
    }
    throw new Error(`Unexpected endpoint ${url.pathname}`);
  };
  return {
    fetcher,
    calls,
    setRandomMode(value: typeof randomMode) {
      randomMode = value;
    },
  };
}

interface RouterProps {
  fetcher: typeof fetch;
  apiOrigin: string;
  audioFactory: () => FakeAudio;
}

async function makeSUT({ folderSongs = songs }: { folderSongs?: MusicEntry[] } = {}) {
  const audio = new FakeAudio();
  const context = createTestContext(folderSongs);
  localStorage.setItem('musiclatte.locale', 'en');
  window.history.replaceState(null, '', '/music/folders/fixture');
  const modulePath = '../src/app/Router';
  const { Router } = (await import(modulePath)) as { Router: ComponentType<RouterProps> };
  const view = render(
    <Router
      fetcher={context.fetcher}
      apiOrigin="https://api.example.test"
      audioFactory={() => audio}
    />,
  );
  return { audio, context, view, user: userEvent.setup() };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('persistent player UI', () => {
  /** Imports route and locale changes preserve the playing resource and queue without reloading audio. */
  it('should preserve playback while entering imports and changing its locale', async () => {
    const { audio, user } = await makeSUT();
    await user.click(await screen.findByRole('button', { name: 'Play First patient song' }));
    act(() => audio.emit('playing'));
    const src = audio.src;
    const loads = audio.load.mock.calls.length;
    await user.click(screen.getByRole('link', { name: 'Imports' }));
    await screen.findByRole('heading', { name: 'Import music' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'ko');
    expect(audio.src).toBe(src);
    expect(audio.play).toHaveBeenCalledOnce();
    expect(audio.load).toHaveBeenCalledTimes(loads);
    expect(audio.paused).toBe(false);
    expect(screen.getAllByRole('button', { name: /First patient song/ }).length).toBeGreaterThan(0);
  });

  /** Activates a folder song through a query-free media URL and waits for the media event. */
  it('should start loading from a song action and report playing only after audio confirms it', async () => {
    const { audio, user } = await makeSUT();
    await user.click(await screen.findByRole('button', { name: 'Play First patient song' }));

    expect(audio.src).toBe('https://api.example.test/api/v1/media/songs/song%20%2F%20one/stream');
    expect(audio.play).toHaveBeenCalledOnce();
    expect(screen.getByText('Loading audio')).toBeDefined();

    act(() => audio.emit('playing'));
    expect(
      screen.getAllByRole('button', { name: 'Pause First patient song' }).length,
    ).toBeGreaterThan(0);
  });

  /** Ignores an obsolete play rejection but exposes a rejection from the current audio request. */
  it('should keep late play failures from overwriting the active song state', async () => {
    const { audio, user } = await makeSUT();
    let rejectFirst: () => void = () => {};
    audio.play.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectFirst = () => reject(new DOMException('obsolete play'));
        }),
    );
    await user.click(await screen.findByRole('button', { name: 'Play First patient song' }));
    await user.click(screen.getAllByRole('button', { name: 'Next track' })[0]!);

    await act(async () => rejectFirst());
    expect(screen.queryByText('Playback did not start. Press play to try again.')).toBeNull();
    act(() => audio.emit('playing'));
    expect(
      screen.getAllByRole('button', {
        name: 'Pause Second song with a deliberately long localized-player-safe title',
      }).length,
    ).toBeGreaterThan(0);

    audio.play.mockRejectedValueOnce(new DOMException('current play'));
    await user.click(screen.getAllByRole('button', { name: 'Previous track' })[0]!);
    expect(
      await screen.findByText('Playback did not start. Press play to try again.'),
    ).toBeDefined();
  });

  /** Reloads a failed media resource before retrying the current song. */
  it('should recover the current audio resource after a media error', async () => {
    const { audio, user } = await makeSUT();
    await user.click(await screen.findByRole('button', { name: 'Play First patient song' }));
    act(() => {
      audio.error = {} as MediaError;
      audio.emit('error');
    });
    expect(
      await screen.findByText('This song could not be played. Try another song.'),
    ).toBeDefined();
    const loadCalls = audio.load.mock.calls.length;
    audio.error = null;

    const desktop = screen.getAllByRole('complementary', { name: 'Now playing' })[0]!;
    await user.click(within(desktop).getByRole('button', { name: 'Play First patient song' }));
    expect(audio.load).toHaveBeenCalledTimes(loadCalls + 1);
  });

  /** Keeps one audio instance and playback identity across SPA route and locale changes. */
  it('should preserve playback across route and language changes', async () => {
    const { audio, user } = await makeSUT();
    await user.click(await screen.findByRole('button', { name: 'Play First patient song' }));
    act(() => audio.emit('playing'));

    await user.click(screen.getByRole('link', { name: 'Settings' }));
    expect(screen.getAllByText('First patient song').length).toBeGreaterThan(0);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'ko');

    expect(audio.play).toHaveBeenCalledOnce();
    expect(
      screen.getAllByRole('button', { name: 'First patient song 일시 정지' }).length,
    ).toBeGreaterThan(0);
  });

  /** Advances on ended and exposes shuffle, repeat, seek, volume, and queue controls by name and state. */
  it('should advance media and expose named keyboard controls', async () => {
    const { audio, user } = await makeSUT();
    await user.click(await screen.findByRole('button', { name: 'Play First patient song' }));
    act(() => audio.emit('playing'));
    act(() => audio.emit('ended'));

    await waitFor(() => expect(audio.src).toContain('/songs/song-two/stream'));
    expect(
      screen.getAllByRole('button', { name: 'Shuffle' })[0]?.getAttribute('aria-pressed'),
    ).toBe('false');
    expect(screen.getAllByRole('button', { name: 'Repeat: Off' })[0]).toBeDefined();
    expect(screen.getAllByRole('slider', { name: 'Seek' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('slider', { name: 'Volume' }).length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole('button', { name: 'Show queue' })[0]!);
    expect(screen.getByRole('region', { name: 'Queue' }).getAttribute('tabindex')).toBe('0');
  });

  /** Restarts an ended song in repeat-one while keeping explicit next and previous available. */
  it('should restart repeat-one on ended without trapping manual navigation', async () => {
    const { audio, user } = await makeSUT();
    await user.click(await screen.findByRole('button', { name: 'Play First patient song' }));
    act(() => audio.emit('playing'));
    await user.click(screen.getAllByRole('button', { name: 'Repeat: Off' })[0]!);
    expect(screen.getAllByRole('button', { name: 'Repeat: One' }).length).toBeGreaterThan(0);

    audio.currentTime = 73;
    act(() => audio.emit('timeupdate'));
    const source = audio.src;
    const loads = audio.load.mock.calls.length;
    const plays = audio.play.mock.calls.length;
    act(() => audio.emit('ended'));

    await waitFor(() => expect(audio.load).toHaveBeenCalledTimes(loads + 1));
    expect(audio.src).toBe(source);
    expect(audio.currentTime).toBe(0);
    expect(audio.play).toHaveBeenCalledTimes(plays + 1);

    await user.click(screen.getAllByRole('button', { name: 'Next track' })[0]!);
    expect(audio.src).toContain('/songs/song-two/stream');
    audio.currentTime = 0;
    await user.click(screen.getAllByRole('button', { name: 'Previous track' })[0]!);
    expect(audio.src).toContain('/songs/song%20%2F%20one/stream');
  });

  /** Wraps the final item in repeat-all and leaves it ended when repeat is off. */
  it('should wrap repeat-all and stop repeat-off at the queue edge', async () => {
    const { audio, user } = await makeSUT();
    await user.click(await screen.findByRole('button', { name: 'Play First patient song' }));
    act(() => audio.emit('playing'));
    await user.click(screen.getAllByRole('button', { name: 'Next track' })[0]!);
    await user.click(screen.getAllByRole('button', { name: 'Repeat: Off' })[0]!);
    await user.click(screen.getAllByRole('button', { name: 'Repeat: One' })[0]!);

    act(() => audio.emit('ended'));
    await waitFor(() => expect(audio.src).toContain('/songs/song%20%2F%20one/stream'));

    await user.click(screen.getAllByRole('button', { name: 'Repeat: All' })[0]!);
    await user.click(screen.getAllByRole('button', { name: 'Next track' })[0]!);
    const loads = audio.load.mock.calls.length;
    const plays = audio.play.mock.calls.length;
    act(() => audio.emit('ended'));

    expect(audio.src).toContain('/songs/song-two/stream');
    expect(audio.load).toHaveBeenCalledTimes(loads);
    expect(audio.play).toHaveBeenCalledTimes(plays);
    expect(
      screen.getAllByRole('button', {
        name: 'Play Second song with a deliberately long localized-player-safe title',
      }).length,
    ).toBeGreaterThan(0);
  });

  /** A paused seek immediately updates the visible time and slider before delayed media events. */
  it('should reflect the requested seek position while paused', async () => {
    const { audio, user } = await makeSUT();
    await user.click(await screen.findByRole('button', { name: 'Play First patient song' }));
    act(() => audio.emit('playing'));
    await user.click(screen.getAllByRole('button', { name: 'Pause First patient song' })[0]!);
    const seek = screen.getAllByRole('slider', { name: 'Seek' })[0] as HTMLInputElement;
    fireEvent.change(seek, { target: { value: '42' } });
    expect(audio.currentTime).toBe(42);
    expect(seek.value).toBe('42');
    expect(within(seek.parentElement!).getByText('0:42')).toBeTruthy();
  });

  /** The mobile sheet is a named modal and Escape closes it back to its opener. */
  it('should contain keyboard focus in the expanded player and restore its opener', async () => {
    const { audio, user } = await makeSUT();
    await user.click(await screen.findByRole('button', { name: 'Play First patient song' }));
    act(() => audio.emit('playing'));
    const opener = screen.getByRole('button', { name: 'Open player: First patient song' });
    await user.click(opener);

    const dialog = screen.getByRole('dialog', { name: 'Now playing' });
    expect(dialog).toBeDefined();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(screen.queryByRole('dialog', { name: 'Now playing' })).toBeNull();
  });

  /** Keeps a long queue under one dialog-owned scroll body without nesting the fixed header. */
  it('should contain a long queue in the expanded player scroll body', async () => {
    const { audio, user } = await makeSUT({ folderSongs: longQueueSongs });
    await user.click(await screen.findByRole('button', { name: 'Play First patient song' }));
    act(() => audio.emit('playing'));
    await user.click(screen.getByRole('button', { name: 'Open player: First patient song' }));

    const dialog = screen.getByRole('dialog', { name: 'Now playing' });
    const scrollBody = within(dialog).getByTestId('expanded-player-scroll-body');
    const queue = within(scrollBody).getByRole('region', { name: 'Queue' });
    expect(within(queue).getByRole('button', { name: /Queue song 20/ })).toBeDefined();
    expect(scrollBody.contains(dialog.querySelector('header'))).toBe(false);
  });

  /** Preserves the current queue when random is empty or unavailable and replaces it on success. */
  it('should keep the current queue until a nonempty random response succeeds', async () => {
    const { audio, context, user } = await makeSUT();
    await user.click(await screen.findByRole('button', { name: 'Play First patient song' }));
    act(() => audio.emit('playing'));

    context.setRandomMode('empty');
    await user.click(screen.getByRole('button', { name: 'Play random songs' }));
    expect(
      await screen.findByText('No random songs were returned. Your queue is unchanged.'),
    ).toBeDefined();
    expect(audio.src).toContain('/songs/song%20%2F%20one/stream');

    context.setRandomMode('error');
    await user.click(screen.getByRole('button', { name: 'Play random songs' }));
    expect(
      await screen.findByText('Random songs are temporarily unavailable. Your queue is unchanged.'),
    ).toBeDefined();

    context.setRandomMode('success');
    await user.click(screen.getByRole('button', { name: 'Play random songs' }));
    await waitFor(() => expect(audio.src).toContain('/songs/song-two/stream'));
  });

  /** Stops and clears authenticated media when logout succeeds. */
  it('should stop and clear audio on logout', async () => {
    const { audio, user } = await makeSUT();
    await user.click(await screen.findByRole('button', { name: 'Play First patient song' }));
    act(() => audio.emit('playing'));
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(audio.pause).toHaveBeenCalled();
    expect(audio.src).toBe('');
  });
});
