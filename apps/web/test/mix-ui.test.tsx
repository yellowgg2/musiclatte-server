// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { PlayerProvider } from '../src/player/PlayerProvider';
import { createQueue, setShuffle } from '../src/player/queue';
const song = { id: 'tr-1', title: 'Synthetic song', isDir: false };
const sections = { listening: true, mixes: true, curation: true, recent: true, favorites: true };
afterEach(() => {
  cleanup();
  localStorage.clear();
});
/** Appending preserves current occurrence, shuffle order and repeat while adding new occurrences. */
it('should append without replacing the active queue', async () => {
  const module = await import('../src/player/queue');
  const append = Reflect.get(module, 'appendQueue');
  expect(append).toBeTypeOf('function');
  const queue = setShuffle(createQueue([song], song.id, 'mix'), true);
  const next = append(queue, [song]);
  if (!next) throw new Error('Expected appended queue');
  expect(next.position).toBe(queue.position);
  expect(next.shuffled).toBe(true);
  expect(next.order).toEqual([0, 1]);
  expect(next.items).toEqual([song, song]);
  expect(append(queue, [])).toBe(queue);
});
/** Saving a mix does not start playback and restored data retains its conditions. */
it('should show the mix editor and save without playing', async () => {
  const { MixesPage: Page } = await import('../src/pages/music/MixesPage');
  const audio = Object.assign(new EventTarget(), {
    src: '',
    currentTime: 0,
    duration: 180,
    volume: 1,
    paused: true,
    ended: false,
    error: null,
    load: vi.fn(),
    play: vi.fn(async () => {}),
    pause: vi.fn(),
  });
  const fetcher: typeof fetch = async (input, init) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      return Response.json({
        schemaVersion: 1,
        mix: {
          id: '738cf965-b8e3-41a0-876c-87c1804f2e69',
          ...body,
          revision: 1,
          createdAt: '2026-09-09T00:00:00Z',
          updatedAt: '2026-09-09T00:00:00Z',
        },
      });
    }
    const url = String(input);
    if (url.endsWith('/genres')) return Response.json({ schemaVersion: 1, genres: [] });
    if (url.endsWith('/folders'))
      return Response.json({ schemaVersion: 1, folders: [{ id: '0', name: 'Music' }] });
    return Response.json({ schemaVersion: 1, mixes: [], nextCursor: null });
  };
  render(
    <PlayerProvider
      fetcher={fetcher}
      apiOrigin=""
      audioFactory={() => audio}
      onUnauthenticated={() => {}}
    >
      <Page
        base="/"
        locale="en"
        fetcher={fetcher}
        apiOrigin=""
        csrfToken="fixture"
        onUnauthenticated={() => {}}
        canStream
        sections={sections}
      />
    </PlayerProvider>,
  );
  await screen.findByRole('heading', { name: 'Saved mixes' });
  await userEvent.type(screen.getByLabelText('Mix name'), 'Evening');
  await userEvent.click(screen.getByRole('button', { name: 'Save conditions' }));
  await screen.findByRole('heading', { name: 'Evening' });
  expect(audio.play).not.toHaveBeenCalled();
});

/** Mix navigation stays in the page topline and destructive/playback actions have distinct weight. */
it('should expose mix navigation and a clear action hierarchy', async () => {
  const { MixesPage: Page } = await import('../src/pages/music/MixesPage');
  const savedMix = {
    id: '738cf965-b8e3-41a0-876c-87c1804f2e69',
    name: 'Evening',
    conditions: { size: 50 },
    revision: 1,
    createdAt: '2026-09-09T00:00:00Z',
    updatedAt: '2026-09-09T00:00:00Z',
  };
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/genres')) return Response.json({ schemaVersion: 1, genres: [] });
    if (url.endsWith('/folders'))
      return Response.json({ schemaVersion: 1, folders: [{ id: '0', name: 'Music' }] });
    return Response.json({ schemaVersion: 1, mix: savedMix });
  };
  render(
    <PlayerProvider fetcher={fetcher} apiOrigin="" onUnauthenticated={() => {}}>
      <Page
        id={savedMix.id}
        base="/"
        locale="en"
        fetcher={fetcher}
        apiOrigin=""
        csrfToken="fixture"
        onUnauthenticated={() => {}}
        canStream
        onLocale={() => {}}
        sections={sections}
      />
    </PlayerProvider>,
  );
  await screen.findByRole('heading', { name: 'Evening' });
  const navigation = screen.getByRole('navigation', { name: 'Current location' });
  expect(within(navigation).getByRole('link', { name: 'All music' })).toBeTruthy();
  expect(within(navigation).getByRole('link', { name: 'Saved mixes' })).toBeTruthy();
  expect(within(navigation).getByText('Evening').parentElement?.getAttribute('aria-current')).toBe(
    'page',
  );
  expect(navigation.textContent).not.toContain('/');
  expect(screen.getByRole('navigation', { name: 'Music' })).toBeTruthy();
  expect(screen.getByRole('form', { name: 'Mix conditions' })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Mix results' })).toBeTruthy();
  const save = screen.getByRole('button', { name: 'Save conditions' });
  const remove = screen.getByRole('button', { name: 'Delete mix' });
  const draw = screen.getByRole('button', { name: 'Find songs' });
  const play = screen.getByRole('button', { name: 'Play now' });
  const append = screen.getByRole('button', { name: 'Add to queue' });
  expect(remove.className).not.toBe(save.className);
  expect(draw.className).not.toBe(play.className);
  expect(append.className).toBe(draw.className);
});
/** Appending in the actual provider preserves media source/time, including duplicate tracks. */
it('should preserve active media and start an initially empty appended queue explicitly', async () => {
  const { usePlayer } = await import('../src/player/PlayerProvider');
  const { act } = await import('@testing-library/react');
  const audio = Object.assign(new EventTarget(), {
    src: '',
    currentTime: 0,
    duration: 180,
    volume: 1,
    paused: true,
    ended: false,
    error: null,
    load: vi.fn(),
    play: vi.fn(async () => {}),
    pause: vi.fn(),
  });
  function Probe() {
    const player = usePlayer();
    return (
      <>
        <button onClick={() => player.appendSongs([song])}>Append fixture</button>
        <button onClick={player.resume}>Resume fixture</button>
        <output>
          {player.state.currentTime}:{player.state.queue?.items.length ?? 0}
        </output>
      </>
    );
  }
  render(
    <PlayerProvider
      fetcher={fetch}
      apiOrigin=""
      audioFactory={() => audio}
      onUnauthenticated={() => {}}
    >
      <Probe />
    </PlayerProvider>,
  );
  await userEvent.click(screen.getByText('Append fixture'));
  expect(audio.src).toBe('');
  expect(audio.play).not.toHaveBeenCalled();
  await userEvent.click(screen.getByText('Resume fixture'));
  expect(audio.src).toContain('/api/v1/media/songs/tr-1/stream');
  expect(audio.play).toHaveBeenCalledTimes(1);
  act(() => {
    audio.dispatchEvent(new Event('loadedmetadata'));
    audio.currentTime = 37;
    audio.dispatchEvent(new Event('timeupdate'));
  });
  const source = audio.src;
  const loads = audio.load.mock.calls.length;
  await userEvent.click(screen.getByText('Append fixture'));
  expect(audio.currentTime).toBe(37);
  expect(audio.src).toBe(source);
  expect(audio.load).toHaveBeenCalledTimes(loads);
  expect(screen.getByText('37:2')).toBeTruthy();
});
