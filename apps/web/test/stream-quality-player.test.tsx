// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PlayerProvider, usePlayer } from '../src/player/PlayerProvider';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
class AudioFixture extends EventTarget {
  src = '';
  currentTime = 0;
  duration = 180;
  volume = 1;
  paused = true;
  ended = false;
  error = null;
  playbackRate = 1;
  load = vi.fn();
  play = vi.fn(async () => {});
  pause = vi.fn(() => {
    this.paused = true;
    this.emit('pause');
  });
  emit(type: string) {
    if (type === 'playing') this.paused = false;
    this.dispatchEvent(new Event(type));
  }
}
const songs = [
  { id: 'one', title: 'One', isDir: false, duration: 180 },
  { id: 'two', title: 'Two', isDir: false, duration: 180 },
];
function Probe() {
  const p = usePlayer();
  return (
    <>
      <button onClick={() => p.activate({ song: songs[0]!, songs, source: 'fixture' })}>
        Start
      </button>
      <button onClick={p.next}>Next</button>
      <button onClick={() => p.seek(90.8)}>Seek</button>
      <button onClick={p.resume}>Resume</button>
      <button onClick={p.retryOriginal}>Original</button>
      <output>
        {JSON.stringify({
          time: p.state.currentTime,
          duration: p.state.duration,
          current: p.state.current?.id,
          quality: p.quality,
          status: p.state.status,
        })}
      </output>
    </>
  );
}
const plan = (id = 'one', quality = 'economy') => ({
  schemaVersion: 1,
  requestedQuality: quality,
  effectiveQuality: quality,
  seekMode: quality === 'economy' ? 'offset' : 'native',
  durationSeconds: 180,
  streamPath: `/api/v1/media/songs/${id}/stream?quality=${quality}`,
});
it('maps offset90 plus media15 to absolute105 and retains one listening instance across seek', async () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(Date, 'now').mockImplementation(() => Date.parse('2026-09-09T00:00:00Z') + now);
  const audio = new AudioFixture();
  const bodies: unknown[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input).includes('/playback')) return Response.json(plan());
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ schemaVersion: 1, delivery: { status: 'submitted' } });
  };
  render(
    <PlayerProvider
      fetcher={fetcher}
      apiOrigin=""
      audioFactory={() => audio}
      onUnauthenticated={() => {}}
      quality={{ enabled: true, value: 'economy', scope: 'one' }}
      listening={{ enabled: true, scope: 'one', csrfToken: 'fixture' }}
    >
      <Probe />
    </PlayerProvider>,
  );
  fireEvent.click(screen.getByText('Start'));
  await waitFor(() => expect(audio.src).toContain('quality=economy'));
  act(() => audio.emit('playing'));
  act(() => {
    now += 75000;
    audio.currentTime = 75;
    audio.emit('timeupdate');
  });
  fireEvent.click(screen.getByText('Seek'));
  expect(audio.src).toContain('offset=90');
  expect(audio.currentTime).toBe(0);
  act(() => {
    audio.duration = 90;
    audio.emit('playing');
  });
  await act(async () => {
    now += 15000;
    audio.currentTime = 15;
    audio.emit('timeupdate');
  });
  const value = JSON.parse(screen.getByRole('status').textContent!);
  expect(value.time).toBe(105);
  expect(value.duration).toBe(180);
  expect(bodies).toHaveLength(1);
  fireEvent.click(screen.getByText('Seek'));
  act(() => audio.emit('playing'));
  await act(async () => {
    now += 15000;
    audio.currentTime = 15;
    audio.emit('timeupdate');
  });
  expect(bodies).toHaveLength(1);
});
it('keeps previous audio and queue during plan read and discards late responses', async () => {
  const audio = new AudioFixture();
  let resolve!: (r: Response) => void;
  const fetcher: typeof fetch = async (input) =>
    String(input).includes('/one/')
      ? Response.json(plan())
      : new Promise((done) => {
          resolve = done;
        });
  const props = { fetcher, apiOrigin: '', audioFactory: () => audio, onUnauthenticated: () => {} };
  const view = render(
    <PlayerProvider {...props} quality={{ enabled: true, value: 'economy', scope: 'one' }}>
      <Probe />
    </PlayerProvider>,
  );
  fireEvent.click(screen.getByText('Start'));
  await waitFor(() => expect(audio.src).toContain('/one/'));
  act(() => {
    audio.emit('playing');
    audio.currentTime = 37;
    audio.emit('timeupdate');
  });
  fireEvent.click(screen.getByText('Next'));
  expect(audio.src).toContain('/one/');
  expect(JSON.parse(screen.getByRole('status').textContent!).current).toBe('one');
  expect(audio.currentTime).toBe(37);
  view.unmount();
  await act(async () => resolve(Response.json(plan('two'))));
  expect(audio.src).toBe('');
});

it('applies a new preference only to the next occurrence, including rapid offset seeks', async () => {
  const audio = new AudioFixture();
  const fetcher: typeof fetch = async (input) => {
    const u = new URL(String(input), 'http://fixture');
    return Response.json(
      plan(u.pathname.includes('/two/') ? 'two' : 'one', u.searchParams.get('quality')!),
    );
  };
  const props = { fetcher, apiOrigin: '', audioFactory: () => audio, onUnauthenticated: () => {} };
  const view = render(
    <PlayerProvider {...props} quality={{ enabled: true, value: 'economy', scope: 'one' }}>
      <Probe />
    </PlayerProvider>,
  );
  fireEvent.click(screen.getByText('Start'));
  await waitFor(() => expect(audio.src).toContain('economy'));
  act(() => audio.emit('playing'));
  const calls = audio.load.mock.calls.length;
  view.rerender(
    <PlayerProvider {...props} quality={{ enabled: true, value: 'original', scope: 'one' }}>
      <Probe />
    </PlayerProvider>,
  );
  expect(audio.load).toHaveBeenCalledTimes(calls);
  fireEvent.click(screen.getByText('Seek'));
  fireEvent.click(screen.getByText('Seek'));
  expect(audio.src).toContain('economy&offset=90');
  expect(audio.play).toHaveBeenCalledTimes(3);
  fireEvent.click(screen.getByText('Next'));
  await waitFor(() => expect(audio.src).toContain('/two/stream?quality=original'));
});
it('preserves error position and requires explicit original recovery on the same occurrence', async () => {
  const audio = new AudioFixture();
  const fetcher: typeof fetch = async (input) =>
    Response.json(plan('one', String(input).includes('quality=original') ? 'original' : 'economy'));
  render(
    <PlayerProvider
      fetcher={fetcher}
      apiOrigin=""
      audioFactory={() => audio}
      onUnauthenticated={() => {}}
      quality={{ enabled: true, value: 'economy', scope: 'one' }}
    >
      <Probe />
    </PlayerProvider>,
  );
  fireEvent.click(screen.getByText('Start'));
  await waitFor(() => expect(audio.src).toContain('economy'));
  act(() => {
    audio.emit('playing');
    audio.currentTime = 37;
    audio.emit('timeupdate');
    audio.emit('error');
  });
  expect(JSON.parse(screen.getByRole('status').textContent!).time).toBe(37);
  expect(audio.src).toContain('economy');
  fireEvent.click(screen.getByText('Original'));
  await waitFor(() => expect(audio.src).toContain('original'));
  expect(audio.currentTime).toBe(37);
  expect(JSON.parse(screen.getByRole('status').textContent!).current).toBe('one');
});
it('keeps unsupported economy explicit and handles a401 after a stream error', async () => {
  const audio = new AudioFixture();
  const expired = vi.fn();
  let mode = 'unsupported';
  const fetcher: typeof fetch = async () =>
    mode === 'unauthorized'
      ? Response.json({}, { status: 401 })
      : Response.json(
          mode === 'unsupported'
            ? {
                ...plan(),
                effectiveQuality: 'original',
                seekMode: 'native',
                reason: 'metadata_unknown',
                streamPath: '/api/v1/media/songs/one/stream?quality=original',
              }
            : plan(),
        );
  render(
    <PlayerProvider
      fetcher={fetcher}
      apiOrigin=""
      audioFactory={() => audio}
      onUnauthenticated={expired}
      quality={{ enabled: true, value: 'economy', scope: 'one' }}
    >
      <Probe />
    </PlayerProvider>,
  );
  fireEvent.click(screen.getByText('Start'));
  await waitFor(() =>
    expect(JSON.parse(screen.getByRole('status').textContent!).quality.reason).toBe(
      'metadata_unknown',
    ),
  );
  expect(audio.src).toBe('');
  mode = 'normal';
  fireEvent.click(screen.getByText('Start'));
  await waitFor(() => expect(audio.src).toContain('economy'));
  mode = 'unauthorized';
  act(() => audio.emit('error'));
  await waitFor(() => expect(expired).toHaveBeenCalledOnce());
});

it('publishes absolute MediaSession time and treats premature ended as a failed stream', async () => {
  const audio = new AudioFixture();
  const position = vi.fn();
  const handlers = new Map<string, ((arg: { seekTime: number }) => void) | null>();
  vi.stubGlobal('navigator', {
    mediaSession: {
      setPositionState: position,
      setActionHandler: (name: string, handler: ((arg: { seekTime: number }) => void) | null) =>
        handlers.set(name, handler),
      metadata: null,
    },
  });
  const fetcher: typeof fetch = async () => Response.json(plan());
  const view = render(
    <PlayerProvider
      fetcher={fetcher}
      apiOrigin=""
      audioFactory={() => audio}
      onUnauthenticated={() => {}}
      quality={{ enabled: true, value: 'economy', scope: 'one' }}
    >
      <Probe />
    </PlayerProvider>,
  );
  fireEvent.click(screen.getByText('Start'));
  await waitFor(() => expect(audio.src).toContain('economy'));
  act(() => audio.emit('playing'));
  act(() => handlers.get('seekto')?.({ seekTime: 90.8 }));
  expect(audio.src).toContain('offset=90');
  act(() => {
    audio.emit('playing');
    audio.currentTime = 15;
    audio.emit('timeupdate');
  });
  expect(position).toHaveBeenLastCalledWith({ duration: 180, position: 105, playbackRate: 1 });
  await act(async () => audio.emit('ended'));
  expect(JSON.parse(screen.getByRole('status').textContent!).status).toBe('error');
  expect(audio.src).toContain('/one/');
  view.unmount();
  vi.unstubAllGlobals();
});
