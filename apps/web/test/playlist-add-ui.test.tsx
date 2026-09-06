// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicEntry, PlaylistDetail, PlaylistSummary } from '@musiclatte/contracts';
import { Router } from '../src/app/Router';

const revision = 'R'.repeat(43);
const songs: MusicEntry[] = [
  { id: 'song-a', title: 'First song', artist: 'Fixture artist', isDir: false },
  { id: 'song-b', title: 'Second song', artist: 'Fixture artist', isDir: false },
];
const target: PlaylistDetail = {
  id: 'editable-target',
  name: 'Road trip',
  owner: 'listener',
  songCount: 0,
  created: '2026-09-06T00:00:00.000Z',
  changed: '2026-09-06T00:00:00.000Z',
  duration: 0,
  public: false,
  editable: true,
  coverState: 'fallback',
  revision,
  entries: [],
};
const locked: PlaylistSummary = {
  id: 'locked-target',
  name: 'Shared only',
  owner: 'other',
  songCount: 0,
  created: target.created,
  changed: target.changed,
  duration: 0,
  public: true,
  coverState: 'fallback',
  revision,
  editable: false,
};

function createTestContext() {
  const calls: Array<{ url: URL; method: string; body?: any }> = [];
  let sourceSongs = songs;
  let appendFailureAt = -1;
  let appendCount = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    if (url.pathname.endsWith('/session'))
      return Response.json({
        schemaVersion: 1,
        authScheme: 'cookie',
        username: 'listener',
        role: 'user',
        expiresAt: Date.now() + 3600000,
        csrfToken: 'csrf',
      });
    if (url.pathname.endsWith('/capabilities'))
      return Response.json({
        schemaVersion: 1,
        instanceId: 'fixture',
        revision: 'one',
        features: {
          'music.browse': { supported: true, permission: 'allowed', availability: 'available' },
          'music.stream': { supported: true, permission: 'allowed', availability: 'available' },
          'playlists.read': { supported: true, permission: 'allowed', availability: 'available' },
          'playlists.write': { supported: true, permission: 'allowed', availability: 'available' },
        },
      });
    if (url.pathname.endsWith('/music/search'))
      return Response.json({
        schemaVersion: 1,
        result: { song: sourceSongs, artist: [], album: [] },
      });
    if (url.pathname === '/api/v1/playlists' && method === 'GET')
      return Response.json({ schemaVersion: 1, playlists: [target, locked] });
    if (url.pathname === '/api/v1/playlists' && method === 'POST') {
      const created = {
        ...target,
        id: 'created-target',
        name: body.name,
        revision: 'C'.repeat(43),
      };
      return Response.json(
        { schemaVersion: 1, outcome: 'applied', playlist: created },
        { status: 201 },
      );
    }
    if (url.pathname.endsWith('/editable-target') && method === 'GET')
      return Response.json({ schemaVersion: 1, playlist: target });
    if (
      (url.pathname.endsWith('/editable-target') || url.pathname.endsWith('/created-target')) &&
      method === 'PATCH'
    ) {
      appendCount += 1;
      if (appendCount === appendFailureAt)
        return Response.json({ error: { code: 'upstream_unavailable' } }, { status: 503 });
      const next = {
        ...target,
        id: url.pathname.endsWith('/created-target') ? 'created-target' : target.id,
        name: url.pathname.endsWith('/created-target') ? 'New mix' : target.name,
        songCount: body.songIds.length,
        revision: 'S'.repeat(43),
        entries: body.songIds.map((id: string, position: number) => ({
          position,
          song: sourceSongs.find((song) => song.id === id)!,
        })),
      };
      return Response.json({ schemaVersion: 1, outcome: 'applied', playlist: next });
    }
    throw new Error(`Unexpected ${method} ${url.pathname}`);
  };
  return {
    calls,
    fetcher,
    useSongs(value: MusicEntry[]) {
      sourceSongs = value;
    },
    failAppendAt(value: number) {
      appendFailureAt = value;
    },
  };
}

function makeSUT(context = createTestContext()) {
  localStorage.setItem('musiclatte.locale', 'en');
  window.history.replaceState(null, '', '/music/search?q=fixture');
  const audio = {
    src: '',
    currentTime: 0,
    duration: 0,
    volume: 1,
    paused: true,
    ended: false,
    error: null,
    load: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(async () => {}),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  render(
    <Router
      fetcher={context.fetcher}
      apiOrigin="https://api.example.test"
      audioFactory={() => audio as any}
    />,
  );
  return { context, user: userEvent.setup(), audio };
}

beforeEach(() => vi.spyOn(window, 'scrollTo').mockImplementation(() => {}));
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('playlist add UI', () => {
  /** Checkbox selection is independently named and never activates playback. */
  it('should select songs without playing and expose only editable playlist targets', async () => {
    const { user, audio } = makeSUT();
    await user.click(await screen.findByRole('button', { name: 'Select songs' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select First song' }));
    expect(audio.play).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('1 song selected');
    await user.click(screen.getByRole('button', { name: 'Add to playlist' }));
    expect(await screen.findByRole('dialog', { name: 'Add to playlist' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Road trip/ })).toBeTruthy();
    expect(screen.queryByText('Shared only')).toBeNull();
  });

  /** Successful append clears applied selection and leaves the persistent player mounted. */
  it('should append selected songs in source order and finish selection', async () => {
    const { user, context } = makeSUT();
    await user.click(await screen.findByRole('button', { name: 'Select songs' }));
    await user.click(screen.getByRole('button', { name: 'Select this page' }));
    await user.click(screen.getByRole('button', { name: 'Add to playlist' }));
    await user.click(await screen.findByRole('button', { name: /Road trip/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const append = context.calls.find((call) => call.method === 'PATCH')!;
    expect(append.body).toMatchObject({
      action: 'append',
      expectedRevision: revision,
      songIds: ['song-a', 'song-b'],
    });
    expect(screen.queryByRole('status', { name: /selected/i })).toBeNull();
  });

  /** Creating a target first reuses the playlist form and appends only after empty creation succeeds. */
  it('should create a new playlist before appending the selected songs', async () => {
    const { user, context } = makeSUT();
    await user.click(await screen.findByRole('button', { name: 'Select songs' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select First song' }));
    await user.click(screen.getByRole('button', { name: 'Add to playlist' }));
    await user.click(await screen.findByRole('button', { name: 'Create a new playlist' }));
    await user.type(screen.getByLabelText('Playlist name'), 'New mix');
    await user.click(screen.getByRole('button', { name: 'Create playlist' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const writes = context.calls.filter(
      (call) => call.method === 'POST' || call.method === 'PATCH',
    );
    expect(writes.map((call) => [call.method, call.url.pathname])).toEqual([
      ['POST', '/api/v1/playlists'],
      ['PATCH', '/api/v1/playlists/created-target'],
    ]);
    expect(writes[1]?.body.songIds).toEqual(['song-a']);
  });

  /** Partial failure removes the successful batch and keeps only failed or unattempted songs retryable. */
  it('should retain only unapplied selection after a later batch fails', async () => {
    const context = createTestContext();
    context.useSongs(
      Array.from({ length: 20 }, (_, index) => ({
        ...songs[index % songs.length]!,
        id: `${String(index).padStart(2, '0')}${'x'.repeat(498)}`,
      })),
    );
    context.failAppendAt(2);
    const { user } = makeSUT(context);
    await user.click(await screen.findByRole('button', { name: 'Select songs' }));
    await user.click(screen.getByRole('button', { name: 'Select this page' }));
    await user.click(screen.getByRole('button', { name: 'Add to playlist' }));
    await user.click(await screen.findByRole('button', { name: /Road trip/ }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Added: 15. Failed: 5. Not attempted: 0.',
    );
    expect(screen.getByRole('status').textContent).toContain('5 songs selected');
    expect(context.calls.filter((call) => call.method === 'PATCH')).toHaveLength(2);
  });
});
