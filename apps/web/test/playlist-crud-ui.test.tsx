// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicEntry, PlaylistDetail, PlaylistSummary } from '@musiclatte/contracts';
import { Router } from '../src/app/Router';

const revisionA = 'A'.repeat(43);
const revisionB = 'B'.repeat(43);
const song: MusicEntry = {
  id: 'song/A',
  title: 'A song that keeps playing',
  artist: 'Fixture artist',
  duration: 181,
  isDir: false,
};
const editablePlaylist: PlaylistDetail = {
  id: 'playlist/editable',
  name: 'Afternoon & Night',
  owner: 'fixture-listener',
  songCount: 1,
  created: '2026-09-05T00:00:00.000Z',
  changed: '2026-09-05T01:00:00.000Z',
  duration: 181,
  public: false,
  editable: true,
  coverState: 'fallback',
  revision: revisionA,
  entries: [{ position: 0, song }],
};
const lockedPlaylist: PlaylistDetail = {
  ...editablePlaylist,
  id: 'playlist/locked',
  name: 'Shared read-only playlist',
  editable: false,
  revision: revisionB,
};

type RecordedCall = {
  url: URL;
  method: string;
  headers: Headers;
  body?: unknown;
};

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
}

function summaryOf(playlist: PlaylistDetail): PlaylistSummary {
  return {
    id: playlist.id,
    name: playlist.name,
    owner: playlist.owner,
    songCount: playlist.songCount,
    created: playlist.created,
    changed: playlist.changed,
    duration: playlist.duration,
    public: playlist.public,
    editable: playlist.editable,
    coverState: 'fallback',
    revision: playlist.revision,
  };
}

function createTestContext() {
  let signedIn = true;
  let writeCapability: 'available' | 'denied' | 'temporarily_unavailable' = 'available';
  const calls: RecordedCall[] = [];
  const mutationResponses: Response[] = [];
  const details = new Map<string, PlaylistDetail>([
    [editablePlaylist.id, editablePlaylist],
    [lockedPlaylist.id, lockedPlaylist],
  ]);
  let summaries = [summaryOf(editablePlaylist), summaryOf(lockedPlaylist)];

  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ url, method, headers, ...(body === undefined ? {} : { body }) });

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
        revision: 'playlist-crud',
        features: {
          'music.browse': { supported: true, permission: 'allowed', availability: 'available' },
          'music.stream': { supported: true, permission: 'allowed', availability: 'available' },
          'playlists.read': { supported: true, permission: 'allowed', availability: 'available' },
          'playlists.write': {
            supported: true,
            permission: writeCapability === 'denied' ? 'denied' : 'allowed',
            availability:
              writeCapability === 'temporarily_unavailable'
                ? 'temporarily_unavailable'
                : 'available',
          },
        },
      });

    if (url.pathname === '/api/v1/playlists' && method === 'GET')
      return Response.json({ schemaVersion: 1, playlists: summaries });

    if (url.pathname === '/api/v1/playlists' && method === 'POST') {
      const queued = mutationResponses.shift();
      if (queued) return queued;
      const request = body as { name: string };
      const playlist: PlaylistDetail = {
        ...editablePlaylist,
        id: 'created & playlist',
        name: request.name,
        songCount: 0,
        duration: 0,
        revision: 'C'.repeat(43),
        entries: [],
      };
      details.set(playlist.id, playlist);
      summaries = [...summaries, summaryOf(playlist)];
      return Response.json({ schemaVersion: 1, outcome: 'applied', playlist }, { status: 201 });
    }

    if (url.pathname.startsWith('/api/v1/playlists/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/v1/playlists/'.length));
      const current = details.get(id);
      if (method === 'GET')
        return current
          ? Response.json({ schemaVersion: 1, playlist: current })
          : Response.json({ error: { code: 'not_found' } }, { status: 404 });

      const queued = mutationResponses.shift();
      if (queued) return queued;
      if (!current) return Response.json({ error: { code: 'not_found' } }, { status: 404 });

      if (method === 'PATCH') {
        const request = body as { name: string };
        const playlist = {
          ...current,
          name: request.name,
          changed: '2026-09-05T02:00:00.000Z',
          revision: 'D'.repeat(43),
        };
        details.set(id, playlist);
        summaries = summaries.map((item) => (item.id === id ? summaryOf(playlist) : item));
        return Response.json({ schemaVersion: 1, outcome: 'already_applied', playlist });
      }

      if (method === 'DELETE') {
        details.delete(id);
        summaries = summaries.filter((item) => item.id !== id);
        return Response.json({
          schemaVersion: 1,
          outcome: 'applied',
          playlistId: id,
          deleted: true,
        });
      }
    }

    throw new Error(`Unexpected endpoint ${method} ${url.pathname}`);
  };

  return {
    calls,
    fetcher,
    queueMutation(response: Response) {
      mutationResponses.push(response);
    },
    setWriteCapability(value: typeof writeCapability) {
      writeCapability = value;
    },
    signOut() {
      signedIn = false;
    },
  };
}

function makeSUT(path = '/playlists', context = createTestContext()) {
  localStorage.setItem('musiclatte.locale', 'en');
  window.history.replaceState(null, '', path);
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

function mutationCalls(context: ReturnType<typeof createTestContext>, method: string) {
  return context.calls.filter((call) => call.method === method);
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

describe('playlist CRUD UI', () => {
  /** Creation trims Unicode names, rejects empty and overlong values locally, and sends the cookie CSRF proof. */
  it('should create a playlist with the shared field contract and authoritative snapshot', async () => {
    const { context, user } = makeSUT();
    const trigger = await screen.findByRole('button', { name: 'Create playlist' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Create a playlist' });
    const field = within(dialog).getByRole('textbox', { name: 'Playlist name' });

    await user.click(within(dialog).getByRole('button', { name: 'Create playlist' }));
    expect(within(dialog).getByText('Enter a playlist name.')).toBeTruthy();
    expect(mutationCalls(context, 'POST')).toHaveLength(0);

    fireEvent.change(field, { target: { value: '🎵'.repeat(256) } });
    await user.click(within(dialog).getByRole('button', { name: 'Create playlist' }));
    expect(within(dialog).getByText('Use 255 characters or fewer.')).toBeTruthy();
    expect(mutationCalls(context, 'POST')).toHaveLength(0);

    fireEvent.change(field, { target: { value: '  Evening & Night  ' } });
    await user.click(within(dialog).getByRole('button', { name: 'Create playlist' }));
    expect(await screen.findByRole('link', { name: /Evening & Night/ })).toBeTruthy();

    const request = mutationCalls(context, 'POST')[0]!;
    expect(request.body).toMatchObject({ name: 'Evening & Night' });
    expect(request.body).toMatchObject({
      operationId: expect.stringMatching(/^[A-Za-z0-9_-]{22,128}$/),
    });
    expect(request.headers.get('x-csrf-token')).toBe('synthetic-csrf');
    expect(request.headers.get('x-musiclatte-client')).toBe('web');
    expect(document.activeElement).toBe(trigger);
  });

  /** Network retry keeps one operation ID for the same intent, while editing creates a new intent. */
  it('should reuse an operation ID only while the submitted intent stays unchanged', async () => {
    const context = createTestContext();
    context.queueMutation(
      Response.json({ error: { code: 'upstream_unavailable' } }, { status: 503 }),
    );
    context.queueMutation(
      Response.json({ error: { code: 'upstream_unavailable' } }, { status: 503 }),
    );
    const { user } = makeSUT('/playlists', context);
    await user.click(await screen.findByRole('button', { name: 'Create playlist' }));
    const dialog = screen.getByRole('dialog', { name: 'Create a playlist' });
    const field = within(dialog).getByRole('textbox', { name: 'Playlist name' });
    await user.type(field, 'Retry list');

    const submit = within(dialog).getByRole('button', { name: 'Create playlist' });
    await user.click(submit);
    expect(await within(dialog).findByText(/Cannot reach the server/)).toBeTruthy();
    await user.click(submit);
    expect(await within(dialog).findByText(/Cannot reach the server/)).toBeTruthy();

    const first = mutationCalls(context, 'POST')[0]!.body as { operationId: string };
    const second = mutationCalls(context, 'POST')[1]!.body as { operationId: string };
    expect(second.operationId).toBe(first.operationId);

    await user.type(field, ' changed');
    await user.click(submit);
    const third = mutationCalls(context, 'POST')[2]!.body as { operationId: string };
    expect(third.operationId).not.toBe(first.operationId);
  });

  /** Rename preserves the overlay on server validation and adopts a conflict's current snapshot. */
  it('should recover from rename validation and conflict without exposing raw server messages', async () => {
    const context = createTestContext();
    const current = {
      ...editablePlaylist,
      name: 'Changed in Musiclatte',
      revision: 'E'.repeat(43),
    };
    context.queueMutation(
      Response.json(
        { error: { code: 'invalid_request', message: 'raw upstream detail' } },
        { status: 422 },
      ),
    );
    context.queueMutation(
      Response.json(
        {
          schemaVersion: 1,
          error: { code: 'conflict', retryable: false },
          current,
        },
        { status: 409 },
      ),
    );
    const { user } = makeSUT(`/playlists/${encodeURIComponent(editablePlaylist.id)}`, context);
    await user.click(await screen.findByRole('button', { name: 'Rename playlist' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename playlist' });
    const field = within(dialog).getByRole('textbox', { name: 'Playlist name' });
    await user.clear(field);
    await user.type(field, 'New name');
    await user.click(within(dialog).getByRole('button', { name: 'Save name' }));
    expect(await within(dialog).findByText('Check the name and try again.')).toBeTruthy();
    expect(within(dialog).queryByText(/raw upstream detail/)).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Save name' }));
    expect(await screen.findByRole('heading', { level: 1, name: current.name })).toBeTruthy();
    expect(within(dialog).getByText(/changed elsewhere/i)).toBeTruthy();
  });

  /** Delete confirmation names the exact target, cancellation is inert, and applied deletion preserves playback. */
  it('should cancel and then delete with replace navigation while the player stays intact', async () => {
    const { audio, context, user } = makeSUT(
      `/playlists/${encodeURIComponent(editablePlaylist.id)}`,
    );
    await user.click(await screen.findByRole('button', { name: 'Play playlist' }));
    const trigger = screen.getByRole('button', { name: 'Delete playlist' });
    await user.click(trigger);
    let dialog = screen.getByRole('dialog', { name: 'Delete playlist' });
    expect(within(dialog).getByText(editablePlaylist.name)).toBeTruthy();
    expect(within(dialog).getByText(/audio files are kept/i)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(mutationCalls(context, 'DELETE')).toHaveLength(0);
    expect(document.activeElement).toBe(trigger);

    await user.click(trigger);
    dialog = screen.getByRole('dialog', { name: 'Delete playlist' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete playlist' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Playlists' })).toBeTruthy();
    expect(window.location.pathname).toBe('/playlists');
    expect(audio.src).toContain('/songs/song%2FA/stream');
    expect(screen.getAllByText(song.title).length).toBeGreaterThan(0);
  });

  /** Rename and delete require both write capability and an editable resource, and Escape restores focus. */
  it('should gate lifecycle actions and keep keyboard focus with the initiating control', async () => {
    const context = createTestContext();
    const { user } = makeSUT(`/playlists/${encodeURIComponent(editablePlaylist.id)}`, context);
    const rename = await screen.findByRole('button', { name: 'Rename playlist' });
    expect(screen.getByRole('button', { name: 'Delete playlist' })).toBeTruthy();
    await user.click(rename);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(rename);

    act(() => {
      window.history.pushState(null, '', `/playlists/${encodeURIComponent(lockedPlaylist.id)}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(
      await screen.findByRole('heading', { level: 1, name: lockedPlaylist.name }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Rename playlist' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete playlist' })).toBeNull();
  });

  /** A denied write capability removes create and resource actions without hiding readable playlists. */
  it('should keep playlists read-only when the server denies write capability', async () => {
    const context = createTestContext();
    context.setWriteCapability('denied');
    makeSUT('/playlists', context);
    expect(await screen.findByRole('heading', { name: 'Playlists' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Afternoon & Night/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create playlist' })).toBeNull();
  });

  /** Unknown deletion outcomes keep the snapshot and player while offering an explicit refresh. */
  it('should keep recoverable state when deletion outcome is unknown', async () => {
    const context = createTestContext();
    context.queueMutation(
      Response.json(
        {
          schemaVersion: 1,
          error: { code: 'outcome_unknown', retryable: false },
        },
        { status: 409 },
      ),
    );
    const { audio, user } = makeSUT(
      `/playlists/${encodeURIComponent(editablePlaylist.id)}`,
      context,
    );
    await user.click(await screen.findByRole('button', { name: 'Play playlist' }));
    await user.click(screen.getByRole('button', { name: 'Delete playlist' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete playlist' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete playlist' }));

    expect(await within(dialog).findByText(/could not be confirmed/i)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Refresh playlist' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: editablePlaylist.name })).toBeTruthy();
    expect(audio.src).toContain('/songs/song%2FA/stream');
  });

  /** Permission errors stay localized, while an expired mutation returns to the original deep link. */
  it('should handle forbidden and unauthenticated rename failures without losing the intent', async () => {
    const context = createTestContext();
    context.queueMutation(
      Response.json(
        { error: { code: 'forbidden', message: 'raw permission detail' } },
        { status: 403 },
      ),
    );
    context.queueMutation(Response.json({ error: { code: 'unauthenticated' } }, { status: 401 }));
    const path = `/playlists/${encodeURIComponent(editablePlaylist.id)}`;
    const { user } = makeSUT(path, context);
    await user.click(await screen.findByRole('button', { name: 'Rename playlist' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename playlist' });
    const field = within(dialog).getByRole('textbox', { name: 'Playlist name' });
    await user.clear(field);
    await user.type(field, 'Private evening');
    const save = within(dialog).getByRole('button', { name: 'Save name' });
    await user.click(save);
    expect(
      await within(dialog).findByText('You do not have permission for this action.'),
    ).toBeTruthy();
    expect(within(dialog).queryByText(/raw permission detail/)).toBeNull();

    await user.click(save);
    expect(await screen.findByLabelText('Username')).toBeTruthy();
    expect(new URLSearchParams(window.location.search).get('returnTo')).toBe(path);
  });
});
