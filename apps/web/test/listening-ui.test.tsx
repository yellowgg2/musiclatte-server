// @vitest-environment jsdom
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PlayerProvider } from '../src/player/PlayerProvider';
afterEach(cleanup);
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
      />
    </PlayerProvider>,
  );
  await screen.findByRole('heading', { name: 'Recent listening' });
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
