// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicEntry, PlaylistDetail } from '@musiclatte/contracts';
import { Router } from '../src/app/Router';

const revisionA = 'A'.repeat(43);
const revisionB = 'B'.repeat(43);
const songA: MusicEntry = {
  id: 'song-a',
  title: 'First song',
  artist: 'Fixture artist',
  duration: 181,
  isDir: false,
};
const songB: MusicEntry = {
  id: 'song-b',
  title: 'Second song',
  artist: 'Fixture artist',
  duration: 203,
  isDir: false,
};
const initialPlaylist: PlaylistDetail = {
  id: 'playlist/editable',
  name: 'Duplicate afternoon',
  owner: 'fixture-listener',
  songCount: 3,
  created: '2026-09-06T00:00:00.000Z',
  changed: '2026-09-06T01:00:00.000Z',
  duration: 565,
  public: false,
  editable: true,
  coverState: 'fallback',
  revision: revisionA,
  entries: [
    { position: 0, song: songA },
    { position: 1, song: songB },
    { position: 2, song: { ...songA } },
  ],
};

type RecordedCall = { method: string; body?: Record<string, unknown> };

class FakeAudio extends EventTarget {
  src = '';
  currentTime = 0;
  duration = 181;
  volume = 1;
  paused = true;
  ended = false;
  error: MediaError | null = null;
  load = vi.fn();
  pause = vi.fn();
  play = vi.fn<() => Promise<void>>(async () => {});
}

function createTestContext() {
  let playlist = structuredClone(initialPlaylist);
  let writeCapability = true;
  let delayed: (() => void) | undefined;
  const calls: RecordedCall[] = [];
  const responses: Response[] = [];

  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const body =
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined;
    if (method !== 'GET') calls.push({ method, ...(body ? { body } : {}) });

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
        revision: 'playlist-edit',
        features: {
          'music.browse': { supported: true, permission: 'allowed', availability: 'available' },
          'music.stream': { supported: true, permission: 'allowed', availability: 'available' },
          'playlists.read': { supported: true, permission: 'allowed', availability: 'available' },
          'playlists.write': {
            supported: true,
            permission: writeCapability ? 'allowed' : 'denied',
            availability: 'available',
          },
        },
      });
    if (url.pathname === `/api/v1/playlists/${encodeURIComponent(playlist.id)}` && method === 'GET')
      return Response.json({ schemaVersion: 1, playlist });
    if (
      url.pathname === `/api/v1/playlists/${encodeURIComponent(playlist.id)}` &&
      method === 'PATCH'
    ) {
      if (delayed) await new Promise<void>((resolve) => (delayed = resolve));
      const queued = responses.shift();
      if (queued) return queued;
      if (body?.action === 'remove') {
        const occurrence = body.occurrence as { position: number; songId: string };
        playlist = {
          ...playlist,
          revision: revisionB,
          songCount: playlist.songCount - 1,
          entries: playlist.entries
            .filter(
              (entry) =>
                entry.position !== occurrence.position || entry.song.id !== occurrence.songId,
            )
            .map((entry, position) => ({ ...entry, position })),
        };
      } else if (body?.action === 'reorder') {
        const order = body.order as number[];
        playlist = {
          ...playlist,
          revision: revisionB,
          entries: order.map((oldPosition, position) => ({
            ...playlist.entries[oldPosition]!,
            position,
          })),
        };
      }
      return Response.json({ schemaVersion: 1, outcome: 'applied', playlist });
    }
    throw new Error(`Unexpected endpoint ${method} ${url.pathname}`);
  };

  return {
    calls,
    fetcher,
    current: () => playlist,
    queue(response: Response) {
      responses.push(response);
    },
    delayMutation() {
      delayed = () => {};
    },
    finishMutation() {
      const finish = delayed;
      delayed = undefined;
      finish?.();
    },
    denyWrites() {
      writeCapability = false;
    },
  };
}

function makeSUT(context = createTestContext()) {
  localStorage.setItem('musiclatte.locale', 'en');
  window.history.replaceState(null, '', `/playlists/${encodeURIComponent(initialPlaylist.id)}`);
  const audio = new FakeAudio();
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

describe('playlist occurrence editing', () => {
  /** Removal confirms the exact duplicate occurrence and keeps the established player queue snapshot. */
  it('should remove only the second duplicate while current playback keeps its original queue', async () => {
    const { audio, context, user } = makeSUT();
    await user.click(await screen.findByRole('button', { name: 'Play playlist' }));
    await user.click(screen.getByRole('button', { name: 'Remove First song at position 3' }));
    const confirmation = screen.getByRole('group', { name: 'Remove First song at position 3?' });
    expect(within(confirmation).getByText(/position 3/)).toBeTruthy();
    await user.click(within(confirmation).getByRole('button', { name: 'Remove song' }));

    const songList = screen.getByRole('heading', { name: /Songs/ }).nextElementSibling!;
    await waitFor(() =>
      expect(within(songList as HTMLElement).getAllByText('First song')).toHaveLength(1),
    );
    expect(context.calls[0]?.body).toMatchObject({
      expectedRevision: revisionA,
      action: 'remove',
      occurrence: { position: 2, songId: 'song-a' },
    });
    expect(document.activeElement?.getAttribute('aria-label')).toContain(
      'Second song at position 2',
    );
    expect(audio.src).toContain('/songs/song-a/stream');
    await user.click(screen.getAllByRole('button', { name: 'Next track' })[0]!);
    expect(audio.src).toContain('/songs/song-b/stream');
  });

  /** Move buttons serialize intents, adopt each returned revision, and expose clear boundary states. */
  it('should move by exact positions and prevent a rapid duplicate submit', async () => {
    const context = createTestContext();
    context.delayMutation();
    const { user } = makeSUT(context);
    const firstDown = await screen.findByRole('button', {
      name: 'Move First song at position 1 down',
    });
    expect(screen.getByRole('button', { name: /already first/ }).hasAttribute('disabled')).toBe(
      true,
    );
    await user.dblClick(firstDown);
    expect(context.calls).toHaveLength(1);
    expect(context.calls[0]?.body).toMatchObject({
      expectedRevision: revisionA,
      action: 'reorder',
      order: [1, 0, 2],
    });
    context.finishMutation();
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('aria-label')).toContain(
        'First song at position 2',
      ),
    );

    await user.click(screen.getByRole('button', { name: 'Move First song at position 2 down' }));
    await waitFor(() => expect(context.calls).toHaveLength(2));
    expect(context.calls[1]?.body).toMatchObject({
      expectedRevision: revisionB,
      action: 'reorder',
      order: [0, 2, 1],
    });
  });

  /** Conflict snapshots replace stale rows, never replay the intent, and recover focus to the nearest match. */
  it('should show the authoritative conflict snapshot with an explicit refresh action', async () => {
    const context = createTestContext();
    const current: PlaylistDetail = {
      ...initialPlaylist,
      editable: false,
      revision: revisionB,
      songCount: 2,
      entries: [
        { position: 0, song: songB },
        { position: 1, song: songA },
      ],
    };
    context.queue(
      Response.json(
        {
          schemaVersion: 1,
          error: { code: 'conflict', retryable: false },
          current,
        },
        { status: 409 },
      ),
    );
    const { user } = makeSUT(context);
    await user.click(
      await screen.findByRole('button', { name: 'Move First song at position 3 up' }),
    );

    expect(await screen.findByText(/changed elsewhere/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh playlist' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Move First song/ })).toBeNull();
    expect(context.calls).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
  });

  /** Outcome loss keeps the current snapshot and requires a fresh user intent after refresh. */
  it('should not replay an outcome-unknown removal', async () => {
    const context = createTestContext();
    context.queue(
      Response.json(
        {
          schemaVersion: 1,
          error: { code: 'outcome_unknown', retryable: false },
          current: initialPlaylist,
        },
        { status: 409 },
      ),
    );
    const { user } = makeSUT(context);
    await user.click(
      await screen.findByRole('button', { name: 'Remove Second song at position 2' }),
    );
    await user.click(screen.getByRole('button', { name: 'Remove song' }));

    expect(await screen.findByText(/could not be confirmed/i)).toBeTruthy();
    expect(context.calls).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Remove song' })).toBeNull();
    expect(
      (
        screen.getByRole('button', {
          name: 'Remove Second song at position 2',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
