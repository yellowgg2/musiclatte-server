// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PlayerProvider } from '../src/player/PlayerProvider';
afterEach(cleanup);

/** Mobile filters keep actions at their normal control height instead of stretching to the label stack. */
it('should keep the listening refresh action compact when mobile controls wrap', () => {
  const css = readFileSync(resolve('apps/web/src/pages/music/Listening.module.css'), 'utf8');
  const mobile = css.slice(css.indexOf('@media (max-width: 48rem)'));

  expect(mobile).not.toMatch(
    /\.filterActions,\s*\.playbackActions\s*\{[^}]*align-items:\s*stretch/,
  );
});

/** Every music destination uses the same page-title scale as Recent downloads. */
it('should keep music feature page titles at one consistent size', () => {
  const paths = [
    'apps/web/src/pages/music/Listening.module.css',
    'apps/web/src/pages/music/Mixes.module.css',
    'apps/web/src/pages/music/CurationPage.module.css',
    'apps/web/src/pages/music/RecentDownloads.module.css',
    'apps/web/src/pages/music/FavoritesPage.module.css',
    'apps/web/src/pages/music/Music.module.css',
  ];
  const sizes = paths.map(
    (path) =>
      readFileSync(resolve(path), 'utf8').match(/\.heading h1\s*\{[^}]*font-size:\s*([^;]+);/)?.[1],
  );

  expect(sizes).toEqual(paths.map(() => '2rem'));
});

/** Repeated songs remain distinct history events and unavailable songs retain their timestamp. */
it('should render repeated events and unavailable songs without autoplay', async () => {
  const path = resolve('apps/web/src/pages/music/ListeningHistoryPage.tsx');
  expect(existsSync(path), 'listening history page is required').toBe(true);
  const { ListeningHistoryPage } = await import(path);
  const song = { id: 'tr-1', title: 'Synthetic song', isDir: false };
  const items = [
    { id: 'first', songId: song.id, qualifiedAt: '2026-09-09T00:00:00Z', song },
    { id: 'second', songId: song.id, qualifiedAt: '2026-09-09T00:01:00Z', song },
    { id: 'missing', songId: 'gone', qualifiedAt: '2026-09-09T00:02:00Z', song: null },
  ];
  const fetcher: typeof fetch = async () =>
    Response.json({
      schemaVersion: 1,
      source: 'web',
      asOf: '2026-09-09T00:03:00Z',
      items,
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
  expect((await screen.findAllByText('Synthetic song')).length).toBe(2);
  expect(screen.getByText('Song unavailable')).toBeTruthy();
  expect(audio.play).not.toHaveBeenCalled();
  const play = screen
    .getAllByRole('button', { name: 'Play now' })
    .find((button) => !button.hasAttribute('disabled'))!;
  fireEvent.click(play);
  const source = audio.src;
  const loads = audio.load.mock.calls.length;
  act(() => {
    audio.currentTime = 37;
    audio.dispatchEvent(new Event('timeupdate'));
  });
  fireEvent.change(screen.getByLabelText('Listening period'), { target: { value: '7' } });
  await screen.findAllByText('Synthetic song');
  expect(audio.play).toHaveBeenCalledTimes(1);
  expect(audio.load).toHaveBeenCalledTimes(loads);
  expect(audio.src).toBe(source);
  expect(audio.currentTime).toBe(37);
});
