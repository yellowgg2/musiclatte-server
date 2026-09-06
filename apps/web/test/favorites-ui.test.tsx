// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FavoriteSongResponse, MusicEntry } from '@musiclatte/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from '../src/app/Router';

const songs = [
  { id: 'song-a', title: 'First song', artist: 'Fixture artist', isDir: false },
  { id: 'song-b', title: 'Second song', artist: 'Fixture artist', isDir: false },
] satisfies MusicEntry[];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function createTestContext() {
  let favorites: MusicEntry[] = [];
  let failNextWrite = false;
  let pendingWrite: ReturnType<typeof deferred<FavoriteSongResponse>> | undefined;
  const calls: Array<{ url: URL; method: string }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ url, method });
    if (url.pathname.endsWith('/session'))
      return Response.json({
        schemaVersion: 1,
        authScheme: 'cookie',
        username: 'fixture-listener',
        role: 'user',
        expiresAt: Date.now() + 3_600_000,
        csrfToken: 'synthetic-csrf',
      });
    if (url.pathname.endsWith('/capabilities'))
      return Response.json({
        schemaVersion: 1,
        instanceId: 'fixture',
        revision: 'favorites',
        features: {
          'music.browse': { supported: true, permission: 'allowed', availability: 'available' },
          'music.stream': { supported: true, permission: 'allowed', availability: 'available' },
          'playlists.read': { supported: true, permission: 'allowed', availability: 'available' },
          'playlists.write': { supported: true, permission: 'allowed', availability: 'available' },
          'favorites.songs': { supported: true, permission: 'allowed', availability: 'available' },
        },
      });
    if (url.pathname.endsWith('/music/folders/fixture'))
      return Response.json({
        schemaVersion: 1,
        directory: { id: 'fixture', name: 'Fixture folder', child: songs },
      });
    if (url.pathname === '/api/v1/favorites/songs' && method === 'GET')
      return Response.json({ schemaVersion: 1, songs: favorites });
    if (url.pathname.startsWith('/api/v1/favorites/songs/') && method === 'PUT') {
      if (failNextWrite) {
        failNextWrite = false;
        return Response.json({ error: { code: 'upstream_unavailable' } }, { status: 503 });
      }
      if (pendingWrite) return Response.json(await pendingWrite.promise);
      const id = decodeURIComponent(url.pathname.split('/').at(-1)!);
      const starred = JSON.parse(String(init?.body)).starred as boolean;
      favorites = starred
        ? [songs.find((entry) => entry.id === id)!, ...favorites.filter((entry) => entry.id !== id)]
        : favorites.filter((entry) => entry.id !== id);
      return Response.json(
        starred
          ? { schemaVersion: 1, id, starred: true, song: favorites[0] }
          : { schemaVersion: 1, id, starred: false },
      );
    }
    if (url.pathname === '/api/v1/playlists' && method === 'GET')
      return Response.json({ schemaVersion: 1, playlists: [] });
    throw new Error(`Unexpected ${method} ${url.pathname}`);
  };
  return {
    calls,
    fetcher,
    failWrite() {
      failNextWrite = true;
    },
    delayWrite() {
      pendingWrite = deferred<FavoriteSongResponse>();
      return pendingWrite;
    },
    setFavorites(value: MusicEntry[]) {
      favorites = value;
    },
  };
}

function makeSUT(path = '/music/folders/fixture') {
  const context = createTestContext();
  const audio = {
    src: '',
    currentTime: 0,
    duration: 180,
    volume: 1,
    paused: true,
    load: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(async () => {}),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  localStorage.setItem('musiclatte.locale', 'en');
  window.history.replaceState(null, '', path);
  render(
    <Router
      fetcher={context.fetcher}
      apiOrigin="https://api.example.test"
      audioFactory={() => audio as never}
    />,
  );
  return { context, audio, user: userEvent.setup() };
}

beforeEach(() => vi.spyOn(window, 'scrollTo').mockImplementation(() => {}));
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('favorites UI', () => {
  /** Row state flips immediately, blocks a duplicate request, and commits the server result. */
  it('should expose optimistic pressed and pending state on every song row', async () => {
    const { context, user } = makeSUT();
    const write = context.delayWrite();
    const action = await screen.findByRole('button', { name: 'Add First song to favorites' });
    await user.click(action);
    expect(action.getAttribute('aria-pressed')).toBe('true');
    expect(action.getAttribute('aria-busy')).toBe('true');
    expect((action as HTMLButtonElement).disabled).toBe(true);
    await user.click(action);
    expect(context.calls.filter((call) => call.method === 'PUT')).toHaveLength(1);

    write.resolve({ schemaVersion: 1, id: songs[0]!.id, starred: true, song: songs[0]! });
    await waitFor(() => expect((action as HTMLButtonElement).disabled).toBe(false));
    expect(action.getAttribute('aria-pressed')).toBe('true');
  });

  /** Failed optimistic state rolls back inline and retry replays the failed desired state. */
  it('should rollback a failed row action and recover through its inline retry', async () => {
    const { context, user } = makeSUT();
    context.failWrite();
    const action = await screen.findByRole('button', { name: 'Add First song to favorites' });
    await user.click(action);

    expect((await screen.findByRole('alert')).textContent).toContain('favorite');
    expect(action.getAttribute('aria-pressed')).toBe('false');
    await user.click(screen.getByRole('button', { name: 'Retry adding First song to favorites' }));
    await waitFor(() => expect(action.getAttribute('aria-pressed')).toBe('true'));
  });

  /** The favorites route reuses ordered playback and selection-to-playlist behavior. */
  it('should open favorites from Music and play or select its authoritative order', async () => {
    const { context, audio, user } = makeSUT();
    context.setFavorites([songs[1]!, songs[0]!]);
    window.dispatchEvent(new Event('focus'));
    await user.click(await screen.findByRole('link', { name: 'Favorites' }));

    expect(await screen.findByRole('heading', { name: 'Favorites' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Play favorites' }));
    expect(audio.src).toContain('/songs/song-b/stream');
    await user.click(screen.getByRole('button', { name: 'Select songs' }));
    await user.click(screen.getByRole('button', { name: 'Select this page' }));
    expect(screen.getByText('2 songs selected').textContent).toContain('2 songs selected');
  });

  /** Focus refresh updates row and current-player actions without restarting audio. */
  it('should share refreshed state with the persistent player without replaying audio', async () => {
    const { context, audio, user } = makeSUT();
    await user.click(await screen.findByRole('button', { name: 'Play First song' }));
    context.setFavorites([songs[0]!]);
    act(() => window.dispatchEvent(new Event('focus')));

    await waitFor(() =>
      expect(
        screen
          .getAllByRole('button', { name: 'Remove First song from favorites' })
          .every((button) => button.getAttribute('aria-pressed') === 'true'),
      ).toBe(true),
    );
    expect(audio.play).toHaveBeenCalledOnce();
  });
});
