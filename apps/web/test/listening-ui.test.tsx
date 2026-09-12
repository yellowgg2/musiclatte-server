// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PlayerProvider, usePlayer } from '../src/player/PlayerProvider';

vi.mock('../src/metadata/components/MetadataAction', () => ({
  MetadataAction: ({ song }: { song: { title: string } }) => (
    <button type="button">Metadata {song.title}</button>
  ),
}));
vi.mock('../src/favorites/components/FavoriteAction', () => ({
  FavoriteAction: ({ song }: { song: { title: string } }) => (
    <button type="button">Favorite {song.title}</button>
  ),
}));
afterEach(cleanup);

function QueueProbe() {
  const player = usePlayer();
  return (
    <output data-testid="queue-probe">
      {player.state.queue
        ? `${player.state.queue.items.map((song) => song.id).join(',')}@${player.state.queue.position}`
        : 'empty'}
    </output>
  );
}

/** Mobile filters keep actions at their normal control height instead of stretching to the label stack. */
it('should keep the listening refresh action compact when mobile controls wrap', () => {
  const css = readFileSync(resolve('apps/web/src/pages/music/Listening.module.css'), 'utf8');
  const mobile = css.slice(css.indexOf('@media (max-width: 48rem)'));

  expect(mobile).not.toMatch(
    /\.filterActions,\s*\.playbackActions\s*\{[^}]*align-items:\s*stretch/,
  );
});

/** Every music destination uses the same page-title metrics as Recent downloads. */
it('should keep music feature page titles at one consistent height', () => {
  const paths = [
    'apps/web/src/pages/music/Listening.module.css',
    'apps/web/src/pages/music/Mixes.module.css',
    'apps/web/src/pages/music/CurationPage.module.css',
    'apps/web/src/pages/music/RecentDownloads.module.css',
    'apps/web/src/pages/music/FavoritesPage.module.css',
    'apps/web/src/pages/music/Music.module.css',
  ];
  const titleStyles = paths.map((path) => {
    const rule = readFileSync(resolve(path), 'utf8').match(/\.heading h1\s*\{([^}]*)\}/)?.[1];
    return {
      fontSize: rule?.match(/font-size:\s*([^;]+);/)?.[1],
      letterSpacing: rule?.match(/letter-spacing:\s*([^;]+);/)?.[1],
      lineHeight: rule?.match(/line-height:\s*([^;]+);/)?.[1],
    };
  });

  expect(titleStyles).toEqual(
    paths.map(() => ({ fontSize: '2rem', letterSpacing: '-0.04em', lineHeight: '1.2' })),
  );
});

/** Top-level music pages share the same desktop and narrow content inset. */
it('should keep all top-level music pages aligned', () => {
  const paths = [
    'apps/web/src/pages/music/Music.module.css',
    'apps/web/src/pages/music/RecentDownloads.module.css',
    'apps/web/src/pages/music/FavoritesPage.module.css',
    'apps/web/src/pages/music/CurationPage.module.css',
    'apps/web/src/pages/music/Listening.module.css',
    'apps/web/src/pages/music/Mixes.module.css',
  ];
  const paddings = paths.map((path) => {
    const css = readFileSync(resolve(path), 'utf8');
    const base = css.match(/^\.page\s*\{([^}]*)\}/m)?.[1];
    const narrow = css.slice(css.indexOf('@media (max-width: 30rem)'));
    return {
      base: base?.match(/padding:\s*([^;]+);/)?.[1],
      narrow: narrow.match(/\.page\s*\{[^}]*padding:\s*([^;]+);/)?.[1],
    };
  });

  expect(paddings).toEqual(paths.map(() => ({ base: 'var(--space-5)', narrow: 'var(--space-4)' })));
});

/** Loaded history keeps the newest available occurrence per song while top preserves server counts. */
it('should project visible listening rows without rewriting raw event order', async () => {
  const state =
    (await import('../src/listening/state')) as typeof import('../src/listening/state') & {
      visibleListeningRows?: (
        kind: 'history' | 'top',
        rows: import('../src/listening/state').ListeningRow[],
      ) => import('../src/listening/state').ListeningRow[];
    };
  expect(state).toHaveProperty('visibleListeningRows');
  const songA = { id: 'song-a', title: 'Newest A', isDir: false as const };
  const songB = { id: 'song-b', title: 'Song B', isDir: false as const };
  const rows = [
    { key: 'a-new', songId: 'song-a', time: '2026-09-09T00:03:00Z', song: songA },
    { key: 'a-old', songId: 'song-a', time: '2026-09-09T00:02:00Z', song: songA },
    { key: 'missing', songId: 'gone', time: '2026-09-09T00:01:00Z', song: null },
    { key: 'b', songId: 'song-b', time: '2026-09-09T00:00:00Z', song: songB },
  ];

  expect(state.visibleListeningRows?.('history', rows)).toEqual([rows[0], rows[3]]);
  expect(
    state.visibleListeningRows?.('top', [
      { ...rows[3]!, count: 7 },
      { ...rows[0]!, count: 3 },
      { ...rows[2]!, count: 9 },
    ]),
  ).toMatchObject([
    { songId: 'song-b', count: 7 },
    { songId: 'song-a', count: 3 },
  ]);
});

/** History cards, player queue and pagination all consume the same unique visible projection. */
it('should render unique history songs with their latest time and visible queue order', async () => {
  const path = resolve('apps/web/src/pages/music/ListeningHistoryPage.tsx');
  expect(existsSync(path), 'listening history page is required').toBe(true);
  const { ListeningHistoryPage } = await import(path);
  const songA = { id: 'tr-1', title: 'Synthetic song', isDir: false };
  const songB = { id: 'tr-2', title: 'Second visible song', isDir: false };
  const songC = { id: 'tr-3', title: 'Third visible song', isDir: false };
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input), 'http://localhost');
    return Response.json({
      schemaVersion: 1,
      source: 'web',
      asOf: '2026-09-09T00:04:00Z',
      items: url.searchParams.has('cursor')
        ? [
            {
              id: 'oldest-a',
              songId: songA.id,
              qualifiedAt: '2026-09-08T23:59:00Z',
              song: songA,
            },
            {
              id: 'third',
              songId: songC.id,
              qualifiedAt: '2026-09-08T23:58:00Z',
              song: songC,
            },
          ]
        : [
            {
              id: 'latest-a',
              songId: songA.id,
              qualifiedAt: '2026-09-09T00:03:00Z',
              song: songA,
            },
            {
              id: 'older-a',
              songId: songA.id,
              qualifiedAt: '2026-09-09T00:02:00Z',
              song: songA,
            },
            {
              id: 'missing',
              songId: 'gone',
              qualifiedAt: '2026-09-09T00:01:00Z',
              song: null,
            },
            {
              id: 'second',
              songId: songB.id,
              qualifiedAt: '2026-09-09T00:00:00Z',
              song: songB,
            },
          ],
      nextCursor: url.searchParams.has('cursor') ? null : 'next-page',
    });
  };
  const audio = Object.assign(new EventTarget(), {
    src: '',
    currentTime: 0,
    duration: 120,
    volume: 1,
    paused: true,
    ended: false,
    error: null,
    load: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(async () => {}),
  });
  render(
    <PlayerProvider
      fetcher={fetcher}
      apiOrigin=""
      audioFactory={() => audio}
      onUnauthenticated={() => {}}
    >
      <QueueProbe />
      <ListeningHistoryPage
        kind="history"
        locale="en"
        base="/"
        fetcher={fetcher}
        apiOrigin=""
        onUnauthenticated={() => {}}
        canStream
        onLocale={() => {}}
        sections={{ listening: true, mixes: true, curation: true, recent: true, favorites: true }}
      />
    </PlayerProvider>,
  );
  await screen.findByRole('heading', { name: 'Recent listening' });
  const navigation = screen.getByRole('navigation', { name: 'Music' });
  expect(within(navigation).getByRole('link', { name: 'All music' })).toBeTruthy();
  expect(
    within(navigation).getByRole('link', { name: 'Recent listening' }).getAttribute('aria-current'),
  ).toBe('page');
  expect(within(navigation).getByRole('link', { name: 'Frequently played' })).toBeTruthy();
  expect(within(navigation).getByRole('link', { name: 'Saved mixes' })).toBeTruthy();
  expect(within(navigation).getByRole('link', { name: 'Recent downloads' })).toBeTruthy();
  expect(within(navigation).getByRole('link', { name: 'Favorites' })).toBeTruthy();
  const refresh = screen.getByRole('button', { name: 'Refresh history' });
  const primaryPlay = screen
    .getAllByRole('button', { name: 'Play now' })
    .find((button) => !button.hasAttribute('disabled'))!;
  const append = screen.getByRole('button', { name: 'Add to queue' });
  expect(primaryPlay.className).not.toBe(refresh.className);
  expect(append.className).toBe(refresh.className);
  expect(await screen.findAllByText('Synthetic song')).toHaveLength(1);
  expect(screen.getAllByText('Second visible song')).toHaveLength(1);
  expect(screen.queryByText('Song unavailable')).toBeNull();
  expect(document.querySelectorAll('time[datetime="2026-09-09T00:03:00Z"]')).toHaveLength(1);
  expect(document.querySelector('time[datetime="2026-09-09T00:02:00Z"]')).toBeNull();
  expect(screen.getByRole('heading', { name: 'Songs 2' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Metadata Synthetic song' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Favorite Synthetic song' })).toBeTruthy();
  expect(audio.play).not.toHaveBeenCalled();
  fireEvent.click(primaryPlay);
  expect(screen.getByTestId('queue-probe').textContent).toBe('tr-1,tr-2@0');
  fireEvent.click(screen.getByRole('button', { name: 'Play Second visible song' }));
  expect(screen.getByTestId('queue-probe').textContent).toBe('tr-1,tr-2@1');
  fireEvent.click(screen.getByRole('button', { name: 'Load more records' }));
  await screen.findByText('Third visible song');
  expect(screen.getAllByText('Synthetic song')).toHaveLength(1);
  expect(document.querySelectorAll('time[datetime="2026-09-09T00:03:00Z"]')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Play Third visible song' }));
  expect(screen.getByTestId('queue-probe').textContent).toBe('tr-1,tr-2,tr-3@2');
  const source = audio.src;
  const loads = audio.load.mock.calls.length;
  act(() => {
    audio.currentTime = 37;
    audio.dispatchEvent(new Event('timeupdate'));
  });
  fireEvent.change(screen.getByLabelText('Listening period'), { target: { value: '7' } });
  await screen.findByText('Synthetic song');
  expect(audio.play).toHaveBeenCalledTimes(3);
  expect(audio.load).toHaveBeenCalledTimes(loads);
  expect(audio.src).toBe(source);
  expect(audio.currentTime).toBe(37);
});

/** Frequently played keeps authoritative server order, counts and last-listened times. */
it('should render top songs with authoritative context and shared row actions', async () => {
  const { ListeningHistoryPage } = await import('../src/pages/music/ListeningHistoryPage');
  const songB = { id: 'song-b', title: 'Top song B', isDir: false };
  const songA = { id: 'song-a', title: 'Top song A', isDir: false };
  const fetcher: typeof fetch = async () =>
    Response.json({
      schemaVersion: 1,
      source: 'web',
      asOf: '2026-09-09T00:04:00Z',
      items: [
        {
          songId: songB.id,
          count: 7,
          lastQualifiedAt: '2026-09-09T00:03:00Z',
          song: songB,
        },
        {
          songId: songA.id,
          count: 3,
          lastQualifiedAt: '2026-09-09T00:02:00Z',
          song: songA,
        },
        {
          songId: 'missing',
          count: 9,
          lastQualifiedAt: '2026-09-09T00:01:00Z',
          song: null,
        },
      ],
      nextCursor: null,
    });
  const audio = Object.assign(new EventTarget(), {
    src: '',
    currentTime: 0,
    duration: 120,
    volume: 1,
    paused: true,
    ended: false,
    error: null,
    load: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(async () => {}),
  });
  render(
    <PlayerProvider
      fetcher={fetcher}
      apiOrigin=""
      audioFactory={() => audio}
      onUnauthenticated={() => {}}
    >
      <QueueProbe />
      <ListeningHistoryPage
        kind="top"
        locale="en"
        base="/"
        fetcher={fetcher}
        apiOrigin=""
        onUnauthenticated={() => {}}
        canStream
        sections={{ listening: true, mixes: true, curation: true, recent: true, favorites: true }}
      />
    </PlayerProvider>,
  );

  await screen.findByRole('heading', { name: 'Songs 2' });
  const list = screen.getByRole('list', { name: 'Frequently played' });
  const cards = within(list).getAllByRole('listitem');
  expect(cards).toHaveLength(2);
  expect(cards[0]?.textContent).toContain('Top song B');
  expect(cards[0]?.textContent).toContain('7 plays');
  expect(cards[1]?.textContent).toContain('Top song A');
  expect(cards[1]?.textContent).toContain('3 plays');
  expect(document.querySelector('time[datetime="2026-09-09T00:03:00Z"]')).toBeTruthy();
  const contextCss = readFileSync(resolve('apps/web/src/pages/music/Listening.module.css'), 'utf8');
  expect(contextCss).toMatch(
    /\.topDetail\s*\{[^}]*flex-direction:\s*column[^}]*align-items:\s*flex-start/,
  );
  expect(contextCss).toMatch(
    /\.contextChip\s*\{[^}]*padding:\s*var\(--space-1\) var\(--space-2\)[^}]*border:\s*1px solid var\(--color-border\)[^}]*border-radius:\s*var\(--radius-control\)[^}]*background:\s*var\(--color-surface\)/,
  );
  expect(contextCss).toMatch(
    /\.list\[data-view='tiles'\]\s+\.topDetail\s*\{[^}]*min-block-size:\s*calc\(4\.05em \+ var\(--space-5\)\)/,
  );
  expect(
    Array.from(list.querySelectorAll('time')).every((time) => {
      const context = time.parentElement;
      return (
        context?.children.length === 2 &&
        Array.from(context.children).every((child) => child.className.includes('contextChip'))
      );
    }),
  ).toBe(true);
  expect(screen.queryByText('Song unavailable')).toBeNull();
  expect(screen.getByRole('button', { name: 'Metadata Top song B' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Favorite Top song B' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Play Top song B' }));
  expect(screen.getByTestId('queue-probe').textContent).toBe('song-b,song-a@0');
});

/** Missing-only pages use one status while retaining pagination to a later available song. */
it('should replace missing event rows with one visible-empty status and keep load more', async () => {
  const { ListeningHistoryPage } = await import('../src/pages/music/ListeningHistoryPage');
  const available = { id: 'available', title: 'Available later', isDir: false };
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input), 'http://localhost');
    return Response.json({
      schemaVersion: 1,
      source: 'web',
      asOf: '2026-09-09T00:03:00Z',
      items: url.searchParams.has('cursor')
        ? [
            {
              id: 'available-event',
              songId: available.id,
              qualifiedAt: '2026-09-09T00:01:00Z',
              song: available,
            },
          ]
        : [
            {
              id: 'missing-event',
              songId: 'missing',
              qualifiedAt: '2026-09-09T00:02:00Z',
              song: null,
            },
          ],
      nextCursor: url.searchParams.has('cursor') ? null : 'next-page',
    });
  };
  const audio = Object.assign(new EventTarget(), {
    src: '',
    currentTime: 0,
    duration: 120,
    volume: 1,
    paused: true,
    ended: false,
    error: null,
    load: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(async () => {}),
  });
  render(
    <PlayerProvider
      fetcher={fetcher}
      apiOrigin=""
      audioFactory={() => audio}
      onUnauthenticated={() => {}}
    >
      <ListeningHistoryPage
        kind="history"
        locale="en"
        base="/"
        fetcher={fetcher}
        apiOrigin=""
        onUnauthenticated={() => {}}
        canStream
        sections={{ listening: true, mixes: true, curation: true, recent: true, favorites: true }}
      />
    </PlayerProvider>,
  );

  expect(await screen.findByText('No available songs in these loaded records.')).toBeTruthy();
  expect(screen.queryByText('Song unavailable')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Load more records' }));
  expect(await screen.findByText('Available later')).toBeTruthy();
  expect(screen.queryByText('No available songs in these loaded records.')).toBeNull();
});
