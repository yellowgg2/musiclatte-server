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

function createTestContext(
  folderSongs: MusicEntry[] = songs,
  detail?: (id: string, signal: AbortSignal) => Promise<Response>,
) {
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
    if (url.pathname.includes('/music/songs/')) {
      const id = decodeURIComponent(url.pathname.split('/').at(-1)!);
      return detail
        ? detail(id, init!.signal as AbortSignal)
        : Response.json({
            schemaVersion: 1,
            song: { ...songs.find((song) => song.id === id), year: 2024, genre: 'Jazz', track: 3 },
          });
    }
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

async function makeSUT({
  folderSongs = songs,
  detail,
}: {
  folderSongs?: MusicEntry[];
  detail?: (id: string, signal: AbortSignal) => Promise<Response>;
} = {}) {
  const audio = new FakeAudio();
  const context = createTestContext(folderSongs, detail);
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
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});

afterEach(() => {
  cleanup();
});

describe('current track details', () => {
  /** Opening and dismissing information does not reload or pause the active audio. */
  it('should show fetched details in one dialog and preserve playback through time updates and close', async () => {
    const { audio, user, context } = await makeSUT();
    await user.click(
      (await screen.findAllByRole('button', { name: 'Play First patient song' }))[0]!,
    );
    act(() => audio.emit('playing'));
    const source = audio.src;
    const loads = audio.load.mock.calls.length;
    const pauses = audio.pause.mock.calls.length;
    const opener = screen.getAllByRole('button', {
      name: 'View song details: First patient song',
    })[0]!;
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Song details' });
    expect(await within(dialog).findByText('Jazz')).toBeTruthy();
    expect(within(dialog).getByText('2024')).toBeTruthy();
    expect(within(dialog).getByText('Small hours')).toBeTruthy();
    expect(dialog.querySelector('[data-fit="contain"] img')?.getAttribute('src')).toContain(
      'cover%20one',
    );
    act(() => {
      audio.currentTime = 42;
      audio.emit('timeupdate');
    });
    expect(context.calls.filter((url) => url.pathname.includes('/music/songs/'))).toHaveLength(1);
    await user.click(within(dialog).getByRole('button', { name: 'Close song details' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(audio.src).toBe(source);
    expect(audio.currentTime).toBe(42);
    expect(audio.load.mock.calls).toHaveLength(loads);
    expect(audio.pause.mock.calls).toHaveLength(pauses);
  });

  /** A failed detail read leaves the queue's known information visible and permits explicit retry. */
  it('should retain known fields on failure and retry without replaying the song', async () => {
    let failed = true;
    const { user } = await makeSUT({
      detail: async () =>
        failed
          ? Response.json({}, { status: 503 })
          : Response.json({ schemaVersion: 1, song: { ...songs[0]!, year: 2025 } }),
    });
    await user.click(
      (await screen.findAllByRole('button', { name: 'Play First patient song' }))[0]!,
    );
    await user.click(
      screen.getAllByRole('button', { name: 'View song details: First patient song' })[0]!,
    );
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(within(dialog).getByText('Small hours')).toBeTruthy();
    failed = false;
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }));
    expect(await within(dialog).findByText('2025')).toBeTruthy();
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  /** Late responses, even from a fetcher ignoring abort, cannot replace the newly playing song. */
  it('should follow track changes and discard old results, and abort on close', async () => {
    const pending: { id: string; signal: AbortSignal; resolve: (response: Response) => void }[] =
      [];
    const { user } = await makeSUT({
      detail: (id, signal) => new Promise((resolve) => pending.push({ id, signal, resolve })),
    });
    await user.click(
      (await screen.findAllByRole('button', { name: 'Play First patient song' }))[0]!,
    );
    await user.click(
      screen.getAllByRole('button', { name: 'View song details: First patient song' })[0]!,
    );
    await user.click(screen.getAllByRole('button', { name: 'Next track' })[0]!);
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[0]!.signal.aborted).toBe(true);
    await act(async () =>
      pending[1]!.resolve(
        Response.json({ schemaVersion: 1, song: { ...songs[1]!, album: 'New album' } }),
      ),
    );
    await act(async () =>
      pending[0]!.resolve(
        Response.json({ schemaVersion: 1, song: { ...songs[0]!, album: 'Stale album' } }),
      ),
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('New album')).toBeTruthy();
    expect(within(dialog).queryByText('Stale album')).toBeNull();
    expect(dialog.querySelector('[data-state="missing"]')).not.toBeNull();
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(pending[1]!.signal.aborted).toBe(true);
  });

  /** Sparse and mismatched upstream metadata must not expose invented fields. */
  it('should reject wrong song details and hide zero or blank optional fields', async () => {
    const { user } = await makeSUT({
      folderSongs: [
        { id: 'song-two', title: 'Sparse song', isDir: false, year: 0, track: 0, genre: ' ' },
      ],
      detail: async () => Response.json({ schemaVersion: 1, song: songs[0] }),
    });
    await user.click((await screen.findAllByRole('button', { name: 'Play Sparse song' }))[0]!);
    await user.click(screen.getAllByRole('button', { name: 'View song details: Sparse song' })[0]!);
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(within(dialog).queryByText('Year')).toBeNull();
    expect(within(dialog).queryByText('Track')).toBeNull();
    expect(within(dialog).queryByText('Genre')).toBeNull();
    expect(within(dialog).queryByText('First patient song')).toBeNull();
  });

  /** Cover details, desktop queue and the existing mini title expansion share one presentation owner. */
  it('should dismiss other player surfaces and cancel details when navigating', async () => {
    const { user } = await makeSUT();
    await user.click(
      (await screen.findAllByRole('button', { name: 'Play First patient song' }))[0]!,
    );
    await user.click(screen.getAllByRole('button', { name: 'Show queue' })[0]!);
    await user.click(
      screen.getAllByRole('button', { name: 'View song details: First patient song' })[0]!,
    );
    expect(screen.queryByRole('region', { name: 'Queue' })).toBeNull();
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Close song details' }),
    );
    await user.click(screen.getByRole('button', { name: 'Open player: First patient song' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    await user.click(
      screen.getAllByRole('button', { name: 'View song details: First patient song' })[1]!,
    );
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await user.click(screen.getAllByRole('link', { name: 'All music' })[0]!);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => {
      window.history.pushState(null, '', '/music/folders/fixture');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  /** Authentication expiry follows the existing session flow and clears the protected popup. */
  it('should expire the session after an unauthenticated details response', async () => {
    const { user } = await makeSUT({
      detail: async () => Response.json({ error: { code: 'unauthenticated' } }, { status: 401 }),
    });
    await user.click(
      (await screen.findAllByRole('button', { name: 'Play First patient song' }))[0]!,
    );
    await user.click(
      screen.getAllByRole('button', { name: 'View song details: First patient song' })[0]!,
    );
    await waitFor(() => expect(window.location.pathname).toBe('/login'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

/** Applied metadata versions refresh details and cover URLs; status polling alone does not refetch. */
it('should refresh open details only when the current track metadata generation changes', async () => {
  const metadataModule = await import('../src/metadata/MetadataSyncProvider');
  const { initialMetadataState } = await import('../src/metadata/state');
  const { TrackDetailsDialog } = await import('../src/player/TrackDetailsDialog');
  const { createMusicClient } = await import('../src/music/client');
  let state = { ...initialMetadataState };
  vi.spyOn(metadataModule, 'useMetadataSync').mockImplementation(() => ({
    state,
    coverUrl: (id: string) => id,
    refresh: vi.fn(),
    refreshOrganization: vi.fn(),
  }));
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ schemaVersion: 1, song: { ...songs[0]!, year: state.version ? 2025 : 2024 } }),
  );
  const client = createMusicClient({ fetcher });
  const props = {
    current: songs[0]!,
    client,
    coverUrl: (id: string) => `/covers/${id}?v=${state.version}`,
    locale: 'en' as const,
    onClose: vi.fn(),
    onUnauthenticated: vi.fn(),
  };
  const view = render(<TrackDetailsDialog {...props} />);
  expect(await screen.findByText('2024')).toBeTruthy();
  state = { ...state, statusVersion: 1 };
  view.rerender(<TrackDetailsDialog {...props} />);
  expect(fetcher).toHaveBeenCalledTimes(1);
  state = { ...state, version: 1, trackVersions: new Map([[songs[0]!.id, 1]]) };
  view.rerender(<TrackDetailsDialog {...props} />);
  expect(await screen.findByText('2025')).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('dialog').querySelector('img')?.getAttribute('src')).toContain('?v=1');
  view.unmount();
  expect(document.body.style.overflow).not.toBe('hidden');
});
