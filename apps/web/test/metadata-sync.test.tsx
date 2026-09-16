// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerProvider, usePlayer } from '../src/player/PlayerProvider';
import { useEffect, useState } from 'react';
import {
  MetadataSyncProvider,
  useMetadataSync,
  useOrganizationState,
} from '../src/metadata/MetadataSyncProvider';
import type {
  MetadataChangesPage,
  MusicEntry,
  OrganizationStatusResponse,
} from '@musiclatte/contracts';
import { SelectionProvider, useSelection } from '../src/selection/SelectionProvider';
import { MusicPage } from '../src/pages/music/MusicPage';
import { Router } from '../src/app/Router';
import { createOrganizationStateStore } from '../src/metadata/organization-state-store';
import { ApiError } from '../src/auth/client';

const song: MusicEntry = {
  id: 'one',
  title: 'Before',
  artist: 'Artist',
  coverArt: 'cover',
  duration: 180,
  isDir: false,
};
const page: MetadataChangesPage = {
  schemaVersion: 1,
  changes: [
    {
      sequence: 1,
      libraryId: 'music',
      oldTrackId: 'one',
      newTrackId: 'one',
      identityResolution: 'unchanged',
      oldRevision: 'revision-0',
      newRevision: 'revision-1',
      coverGeneration: 'revision-1',
      relatedIds: { trackIds: ['one'], albumIds: [], artistIds: [], coverIds: ['cover'] },
      changedFields: ['title', 'cover'],
      fileSavedAt: 1,
      reflectedAt: 2,
      reflection: 'verified',
    },
  ],
  hasMore: false,
  nextCursor: 'cursor-1',
};
class AudioFixture extends EventTarget {
  src = '';
  currentTime = 0;
  duration = 180;
  volume = 1;
  paused = false;
  ended = false;
  error = null;
  load = vi.fn();
  play = vi.fn(async () => {});
  pause = vi.fn();
}
function PlayerProbe() {
  const player = usePlayer();
  return (
    <>
      <button
        onClick={() => {
          player.activate({
            song,
            songs: [song, { id: 'two', title: 'Other', isDir: false }, song],
            source: 'playlist:one@revision',
            position: 2,
          });
          player.setVolume(0.4);
          player.toggleShuffle();
          player.cycleRepeat();
        }}
      >
        Activate
      </button>
      <output data-testid="title">{player.state.current?.title}</output>
      <output data-testid="cover">{player.coverUrl('cover')}</output>
      <output data-testid="order">{JSON.stringify(player.state.queue?.order)}</output>
    </>
  );
}
function SelectionCountProbe() {
  return <output data-testid="selection-count">{useSelection().state.items.length}</output>;
}
function OrganizationProbe({ trackId }: { trackId: string }) {
  const state = useOrganizationState(trackId);
  const metadata = useMetadataSync();
  return (
    <>
      <output data-testid="organization-state">
        {state.phase === 'ready' ? `${state.value.state}:${state.value.reason}` : state.phase}
      </output>
      <output data-testid="metadata-status-version">{metadata.state.statusVersion}</output>
    </>
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
describe('organization state batch store', () => {
  /** StrictMode-style transient mounts do not issue an empty request or duplicate a shared target. */
  it('should discard an unsubscribed pending target and fetch one remounted shared entry', async () => {
    const load = vi.fn(async (targets: Array<{ kind: 'track'; trackId: string }>) => ({
      schemaVersion: 1 as const,
      capturedAt: 1000,
      items: targets.map((target) => ({
        target,
        state: 'unknown' as const,
        reason: 'identity_unavailable' as const,
        stage: null,
        changedAt: null,
      })),
    }));
    const store = createOrganizationStateStore({ load, onUnauthenticated: vi.fn() });
    store.subscribe('song', vi.fn())();
    await tick();
    expect(load).not.toHaveBeenCalled();
    const first = store.subscribe('song', vi.fn());
    const second = store.subscribe('song', vi.fn());
    await tick();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]![0]).toEqual([{ kind: 'track', trackId: 'song' }]);
    first();
    second();
    const remounted = store.subscribe('song', vi.fn());
    await tick();
    expect(load).toHaveBeenCalledTimes(1);
    remounted();
    store.dispose();
  });

  /** Visible consumers are deduplicated and split into bounded requests keyed by returned target. */
  it('should batch 302 unique tracks into four requests and share duplicate subscribers', async () => {
    const requests: string[][] = [];
    const store = createOrganizationStateStore({
      load: async (targets) => {
        requests.push(targets.map((target) => target.trackId));
        return {
          schemaVersion: 1,
          capturedAt: 1000,
          items: [...targets].reverse().map((target) => ({
            target,
            state: 'organized' as const,
            reason: 'verified' as const,
            stage: 'succeeded' as const,
            changedAt: 900,
          })),
        };
      },
      onUnauthenticated: vi.fn(),
      now: () => 1000,
    });
    const listeners = Array.from({ length: 302 }, (_, index) =>
      store.subscribe(`track-${index}`, vi.fn()),
    );
    listeners.push(store.subscribe('track-0', vi.fn()));
    await tick();

    expect(requests.map((request) => request.length)).toEqual([100, 100, 100, 2]);
    expect(new Set(requests.flat()).size).toBe(302);
    expect(store.getSnapshot('track-0')).toMatchObject({
      phase: 'ready',
      value: { target: { kind: 'track', trackId: 'track-0' } },
    });
    expect(store.getSnapshot('track-301')).toMatchObject({
      phase: 'ready',
      value: { target: { kind: 'track', trackId: 'track-301' } },
    });
    listeners.forEach((unsubscribe) => unsubscribe());
    store.dispose();
  });

  /** Background freshness checks preserve the last verified button state until a replacement arrives. */
  it('should keep a ready organization state visible during a stale refresh', async () => {
    let now = 1000;
    let calls = 0;
    let resolveRefresh!: (response: OrganizationStatusResponse) => void;
    const store = createOrganizationStateStore({
      load: async (targets) => {
        calls++;
        if (calls === 2)
          return new Promise((resolve) => {
            resolveRefresh = resolve;
          });
        return {
          schemaVersion: 1,
          capturedAt: now,
          items: targets.map((target) => ({
            target,
            state: 'needs_organization' as const,
            reason: 'path_metadata_changed' as const,
            stage: 'succeeded' as const,
            changedAt: now,
          })),
        };
      },
      onUnauthenticated: vi.fn(),
      now: () => now,
      staleMs: 100,
    });
    const unsubscribe = store.subscribe('song', vi.fn());
    await tick();
    expect(store.getSnapshot('song')).toMatchObject({
      phase: 'ready',
      value: { state: 'needs_organization' },
    });

    now += 100;
    store.refresh('song');
    await tick();
    expect(calls).toBe(2);
    expect(store.getSnapshot('song')).toMatchObject({
      phase: 'ready',
      value: { state: 'needs_organization' },
    });

    resolveRefresh({
      schemaVersion: 1,
      capturedAt: now,
      items: [
        {
          target: { kind: 'track', trackId: 'song' },
          state: 'organized',
          reason: 'verified',
          stage: 'succeeded',
          changedAt: now,
        },
      ],
    });
    await tick();
    expect(store.getSnapshot('song')).toMatchObject({
      phase: 'ready',
      value: { state: 'organized' },
    });
    unsubscribe();
    store.dispose();
  });

  /** Retry, visibility regain, and stale expiry converge through server reads without local guesses. */
  it('should distinguish errors and refresh visible state on retry visibility and stale expiry', async () => {
    let now = 1000;
    let calls = 0;
    const store = createOrganizationStateStore({
      load: async (targets) => {
        calls++;
        if (calls === 1) throw new Error('private transport failure');
        return {
          schemaVersion: 1,
          capturedAt: now,
          items: targets.map((target) => ({
            target,
            state: calls === 2 ? ('needs_organization' as const) : ('organized' as const),
            reason: calls === 2 ? ('path_metadata_changed' as const) : ('verified' as const),
            stage: 'succeeded' as const,
            changedAt: now,
          })),
        };
      },
      onUnauthenticated: vi.fn(),
      now: () => now,
      staleMs: 100,
    });
    const unsubscribe = store.subscribe('song', vi.fn());
    await tick();
    expect(store.getSnapshot('song')).toMatchObject({ phase: 'error' });
    const failed = store.getSnapshot('song');
    if (failed.phase !== 'error') throw new Error('Expected error state');
    failed.retry();
    await tick();
    expect(store.getSnapshot('song')).toMatchObject({
      phase: 'ready',
      value: { state: 'needs_organization' },
    });
    store.setVisible(false);
    now += 100;
    await tick(100);
    expect(calls).toBe(2);
    store.setVisible(true);
    await tick();
    expect(store.getSnapshot('song')).toMatchObject({
      phase: 'ready',
      value: { state: 'organized' },
    });
    unsubscribe();
    store.dispose();
  });

  /** Only an authentication failure expires the session; other transport errors remain local. */
  it('should forward unauthenticated status failures without escalating forbidden errors', async () => {
    const onUnauthenticated = vi.fn();
    let error: ApiError = new ApiError('forbidden');
    const store = createOrganizationStateStore({
      load: async () => Promise.reject(error),
      onUnauthenticated,
    });
    const unsubscribe = store.subscribe('song', vi.fn());
    await tick();
    expect(store.getSnapshot('song').phase).toBe('error');
    expect(onUnauthenticated).not.toHaveBeenCalled();
    error = new ApiError('unauthenticated');
    store.refresh('song');
    await tick();
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.dispose();
  });

  /** A replaced provider aborts the old scope and ignores a transport that still resolves late. */
  it('should keep an old account response out of the current organization cache', async () => {
    let resolveOld!: (response: Response) => void;
    let statusCalls = 0;
    const fetcher: typeof fetch = async (input) => {
      if (!String(input).endsWith('/metadata-organization/statuses'))
        throw new Error('Unexpected fixture route');
      statusCalls++;
      if (statusCalls === 1)
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      return Response.json({
        schemaVersion: 1,
        capturedAt: 2000,
        items: [
          {
            target: { kind: 'track', trackId: 'song' },
            state: 'organized',
            reason: 'verified',
            stage: 'succeeded',
            changedAt: 1900,
          },
        ],
      });
    };
    const tree = (scope: string, csrfToken: string) => (
      <MetadataSyncProvider
        scope={scope}
        enabled={false}
        fetcher={fetcher}
        apiOrigin=""
        csrfToken={csrfToken}
        onUnauthenticated={vi.fn()}
      >
        <OrganizationProbe trackId="song" />
      </MetadataSyncProvider>
    );
    const view = render(tree('instance:account-a:1', 'csrf-a'));
    await tick();
    view.rerender(tree('instance:account-b:2', 'csrf-b'));
    await tick();
    expect(screen.getByTestId('organization-state').textContent).toBe('organized:verified');

    resolveOld(
      Response.json({
        schemaVersion: 1,
        capturedAt: 1000,
        items: [
          {
            target: { kind: 'track', trackId: 'song' },
            state: 'needs_organization',
            reason: 'path_metadata_changed',
            stage: 'succeeded',
            changedAt: 900,
          },
        ],
      }),
    );
    await tick();
    expect(screen.getByTestId('organization-state').textContent).toBe('organized:verified');
  });

  /** Metadata completion invalidates status and trusts the subsequent server freshness projection. */
  it('should re-read organization state after metadata completion without assuming organized', async () => {
    let published = false;
    let statusCalls = 0;
    let changesCalls = 0;
    const fetcher: typeof fetch = async (input) => {
      const path = String(input);
      if (path.includes('/metadata-changes')) {
        changesCalls++;
        return Response.json({ ...page, changes: published ? page.changes : [] });
      }
      if (path.endsWith('/metadata-organization/statuses')) {
        statusCalls++;
        return Response.json({
          schemaVersion: 1,
          capturedAt: statusCalls,
          items: [
            {
              target: { kind: 'track', trackId: 'one' },
              state: statusCalls === 1 ? 'organized' : 'needs_organization',
              reason: statusCalls === 1 ? 'verified' : 'path_metadata_changed',
              stage: 'succeeded',
              changedAt: statusCalls,
            },
          ],
        });
      }
      throw new Error('Unexpected fixture route');
    };
    render(
      <MetadataSyncProvider
        scope="instance:account:policy"
        enabled
        fetcher={fetcher}
        apiOrigin=""
        csrfToken="synthetic-csrf"
        onUnauthenticated={vi.fn()}
      >
        <OrganizationProbe trackId="one" />
      </MetadataSyncProvider>,
    );
    await tick();
    expect(screen.getByTestId('organization-state').textContent).toBe('organized:verified');
    published = true;
    await tick(3000);
    await tick();
    await tick(1);
    expect(changesCalls).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId('metadata-status-version').textContent).toBe('1');
    expect(statusCalls).toBe(2);
    expect(screen.getByTestId('organization-state').textContent).toBe(
      'needs_organization:path_metadata_changed',
    );
  });
});
describe('metadata player integration', () => {
  /** A policy scope change discards old display responses without remounting the active player. */
  it('should fence a late song response and clear old cover generations while audio continues', async () => {
    const audio = new AudioFixture();
    let published = true;
    let finish!: (response: Response) => void;
    const fetcher: typeof fetch = (input) =>
      String(input).includes('/metadata-changes')
        ? Promise.resolve(Response.json({ ...page, changes: published ? page.changes : [] }))
        : new Promise((resolve) => {
            finish = resolve;
          });
    const expire = vi.fn();
    const tree = (scope: string) => (
      <MetadataSyncProvider
        scope={scope}
        enabled
        fetcher={fetcher}
        apiOrigin=""
        csrfToken="synthetic-csrf"
        onUnauthenticated={expire}
      >
        <PlayerProvider
          fetcher={fetcher}
          apiOrigin=""
          audioFactory={() => audio}
          onUnauthenticated={expire}
        >
          <PlayerProbe />
        </PlayerProvider>
      </MetadataSyncProvider>
    );
    const view = render(tree('instance:user:policy-1'));
    await tick();
    fireEvent.click(screen.getByText('Activate'));
    audio.currentTime = 73;
    const source = audio.src;
    published = false;
    view.rerender(tree('instance:user:policy-2'));
    await tick();
    finish(Response.json({ schemaVersion: 1, song: { ...song, title: 'Obsolete' } }));
    await tick();
    expect(screen.getByTestId('title').textContent).toBe('Before');
    expect(screen.getByTestId('cover').textContent).toBe('/api/v1/media/cover/cover');
    expect(audio.currentTime).toBe(73);
    expect(audio.src).toBe(source);
    expect(audio.load).toHaveBeenCalledTimes(1);
    expect(expire).not.toHaveBeenCalled();
  });
  /** The normal signed-in router connects verified invalidation to each existing list consumer. */
  it.each(['favorites', 'playlist', 'recent'] as const)(
    'should refresh %s rows through the scoped router provider',
    async (kind) => {
      vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
      localStorage.setItem('musiclatte.locale', 'en');
      window.history.replaceState(
        null,
        '',
        kind === 'playlist' ? '/playlists/list' : `/music/${kind}`,
      );
      let published = false;
      const fetcher: typeof fetch = async (input) => {
        const path = new URL(String(input), 'http://localhost').pathname;
        if (path.endsWith('/session'))
          return Response.json({
            schemaVersion: 1,
            authScheme: 'cookie',
            username: 'listener',
            expiresAt: Date.now() + 3600000,
            csrfToken: 'synthetic-csrf',
          });
        if (path.endsWith('/capabilities'))
          return Response.json({
            schemaVersion: 1,
            instanceId: 'instance',
            revision: 'policy',
            features: Object.fromEntries(
              [
                'music.browse',
                'music.stream',
                'favorites.songs',
                'playlists.read',
                'library.recentDownloads',
                'metadata.write',
              ].map((key) => [
                key,
                { supported: true, permission: 'allowed', availability: 'available' },
              ]),
            ),
          });
        if (path.endsWith('/metadata-changes'))
          return Response.json({ ...page, changes: published ? page.changes : [] });
        const current = { ...song, title: published ? 'After' : 'Before' };
        if (path.endsWith('/favorites/songs'))
          return Response.json({ schemaVersion: 1, songs: [current] });
        if (path.endsWith('/playlists/list'))
          return Response.json({
            schemaVersion: 1,
            playlist: {
              id: 'list',
              name: 'Fixture list',
              owner: 'listener',
              songCount: 2,
              created: '2026-09-07T12:00:00Z',
              changed: '2026-09-07T12:00:00Z',
              duration: 360,
              public: false,
              editable: false,
              coverState: 'fallback',
              revision: 'playlist-revision',
              entries: [
                { position: 0, song: current },
                { position: 1, song: current },
              ],
            },
          });
        if (path.endsWith('/recent-downloads'))
          return Response.json({
            schemaVersion: 1,
            filter: { from: '2026-09-01T00:00:00.000Z', to: '2026-09-07T12:00:00.000Z' },
            asOf: '2026-09-07T12:00:00.000Z',
            items: [
              {
                eventId: 'event',
                downloadCompletedAt: '2026-09-07T10:00:00.000Z',
                registeredAt: '2026-09-07T10:01:00.000Z',
                state: 'ready',
                song: current,
              },
            ],
            nextCursor: null,
          });
        if (path.endsWith('/music/folders'))
          return Response.json({ schemaVersion: 1, folders: [] });
        throw new Error('Unexpected fixture route');
      };
      render(<Router fetcher={fetcher} audioFactory={() => new AudioFixture()} />);
      await tick();
      await tick();
      expect(screen.getAllByText('Before').length).toBe(kind === 'playlist' ? 2 : 1);
      published = true;
      await tick(3000);
      await tick();
      expect(screen.getAllByText('After').length).toBe(kind === 'playlist' ? 2 : 1);
      expect(screen.queryByText('Before')).toBeNull();
    },
  );
  /** Refresh rebases only this loaded scope and announces a disappearing selected row via the existing count. */
  it('should refetch browse metadata while preserving selection until its loaded row disappears', async () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    let revision = 0;
    const fetcher: typeof fetch = async (input) => {
      if (String(input).includes('/metadata-changes'))
        return Response.json({
          ...page,
          changes: revision
            ? [
                {
                  ...page.changes[0],
                  sequence: revision,
                  newRevision: `revision-${revision}`,
                  coverGeneration: `revision-${revision}`,
                },
              ]
            : [],
        });
      return Response.json({
        schemaVersion: 1,
        directory: {
          id: 'folder',
          name: 'Fixture folder',
          child: revision === 2 ? [] : [{ ...song, title: revision ? 'After' : 'Before' }],
        },
      });
    };
    const expired = () => {};
    render(
      <MetadataSyncProvider
        scope="browse-scope"
        enabled
        fetcher={fetcher}
        apiOrigin=""
        csrfToken="synthetic-csrf"
        onUnauthenticated={expired}
      >
        <PlayerProvider
          fetcher={fetcher}
          apiOrigin=""
          audioFactory={() => new AudioFixture()}
          onUnauthenticated={expired}
        >
          <SelectionProvider>
            <SelectionCountProbe />
            <MusicPage
              location="/music/folders/folder"
              base="/"
              locale="en"
              onLocale={() => {}}
              fetcher={fetcher}
              apiOrigin=""
              onUnauthenticated={expired}
              canStream={false}
              canRandom={false}
              canWritePlaylists={false}
              canFavorites={false}
              sections={{
                listening: false,
                mixes: false,
                curation: false,
                recent: false,
                favorites: false,
              }}
              csrfToken="synthetic"
            />
          </SelectionProvider>
        </PlayerProvider>
      </MetadataSyncProvider>,
    );
    await tick();
    fireEvent.click(screen.getByRole('button', { name: 'Select songs' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Before' }));
    expect(screen.getByText('1 song selected')).toBeTruthy();
    revision = 1;
    await tick(3000);
    await tick();
    expect(screen.getByRole('checkbox', { name: 'Deselect After' })).toHaveProperty(
      'checked',
      true,
    );
    expect(screen.getByText('1 song selected')).toBeTruthy();
    revision = 2;
    await tick(3000);
    await tick();
    expect(screen.getByTestId('selection-count').textContent).toBe('0');
  });
  /** A verified event refreshes actual gonic DTOs while the active HTML audio resource is untouched. */
  it('should update title and cover without calling audio load play or resetting playback', async () => {
    let published = false;
    const audio = new AudioFixture();
    const fetcher: typeof fetch = async (input) =>
      String(input).includes('/metadata-changes')
        ? Response.json({ ...page, changes: published ? page.changes : [] })
        : Response.json({ schemaVersion: 1, song: { ...song, title: 'After' } });
    render(
      <MetadataSyncProvider
        scope="instance:user:policy"
        enabled
        fetcher={fetcher}
        apiOrigin=""
        csrfToken="synthetic-csrf"
        onUnauthenticated={() => {}}
      >
        <PlayerProvider
          fetcher={fetcher}
          apiOrigin=""
          audioFactory={() => audio}
          onUnauthenticated={() => {}}
        >
          <PlayerProbe />
        </PlayerProvider>
      </MetadataSyncProvider>,
    );
    await tick();
    fireEvent.click(screen.getByText('Activate'));
    audio.currentTime = 73;
    const order = screen.getByTestId('order').textContent;
    const source = audio.src;
    published = true;
    await tick(3000);
    expect(screen.getByTestId('title').textContent).toBe('After');
    expect(screen.getByTestId('cover').textContent).toBe(
      '/api/v1/media/cover/cover/revisions/revision-1',
    );
    expect(screen.getByTestId('order').textContent).toBe(order);
    expect(audio.src).toBe(source);
    expect(audio.currentTime).toBe(73);
    expect(audio.volume).toBe(0.4);
    expect(audio.load).toHaveBeenCalledTimes(1);
    expect(audio.play).toHaveBeenCalledTimes(1);
  });
});

/** New scoped consumers can read during their effect before the parent passive effect resumes. */
it('should read history after capability discovery replaces the metadata scope', async () => {
  function HistoryProbe() {
    const { client } = useMetadataSync();
    const [status, setStatus] = useState('loading');
    useEffect(() => {
      const controller = new AbortController();
      void client!.list(controller.signal).then(
        () => {
          if (!controller.signal.aborted) setStatus('ready');
        },
        () => {
          if (!controller.signal.aborted) setStatus('failed');
        },
      );
      return () => controller.abort();
    }, [client]);
    return <output data-testid="history-state">{status}</output>;
  }
  const fetcher: typeof fetch = async () =>
    Response.json({ schemaVersion: 1, jobs: [], nextCursor: null });
  const expire = vi.fn();
  const tree = (scope: string) => (
    <MetadataSyncProvider
      scope={scope}
      enabled={false}
      fetcher={fetcher}
      apiOrigin=""
      csrfToken="synthetic-csrf"
      onUnauthenticated={expire}
    >
      <HistoryProbe />
    </MetadataSyncProvider>
  );
  const view = render(tree('unknown:user'));
  await tick();
  expect(screen.getByTestId('history-state').textContent).toBe('ready');
  view.rerender(tree('known-instance:user:policy'));
  await tick();
  expect(screen.getByTestId('history-state').textContent).toBe('ready');
});
