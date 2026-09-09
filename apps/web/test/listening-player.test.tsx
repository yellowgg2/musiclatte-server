// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PlayerProvider, usePlayer } from '../src/player/PlayerProvider';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
class AudioFixture extends EventTarget {
  src = '';
  currentTime = 0;
  duration = 120;
  volume = 1;
  paused = true;
  ended = false;
  error = null;
  playbackRate = 1;
  load = vi.fn();
  play = vi.fn(async () => {});
  pause = vi.fn(() => {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  });
  emit(type: string) {
    if (type === 'playing') this.paused = false;
    this.dispatchEvent(new Event(type));
  }
}
const song = { id: 'tr-1', title: 'Synthetic song', isDir: false, duration: 120 };
function Probe() {
  const p = usePlayer();
  return (
    <>
      <button onClick={() => p.activate({ song, songs: [song], source: 'fixture' })}>Start</button>
      <button onClick={p.cycleRepeat}>Repeat</button>
      <button onClick={() => p.seek(100)}>Seek</button>
    </>
  );
}
/** The real provider creates one event per repeat occurrence and stays passive when disabled. */
it('should record actual playback and repeat-one as distinct instances', async () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(Date, 'now').mockImplementation(() => Date.parse('2026-09-09T00:00:00Z') + now);
  const audio = new AudioFixture();
  const bodies: Record<string, unknown>[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ schemaVersion: 1, delivery: { status: 'submitted' } });
  };
  render(
    <PlayerProvider
      fetcher={fetcher}
      apiOrigin=""
      audioFactory={() => audio}
      onUnauthenticated={() => {}}
      listening={{ enabled: true, scope: 'account-one', csrfToken: 'fixture' }}
    >
      <Probe />
    </PlayerProvider>,
  );
  fireEvent.click(screen.getByText('Start'));
  act(() => audio.emit('playing'));
  await act(async () => {
    now += 60000;
    audio.currentTime = 60;
    audio.emit('timeupdate');
  });
  expect(bodies).toHaveLength(1);
  fireEvent.click(screen.getByText('Repeat'));
  fireEvent.click(screen.getByText('Repeat'));
  act(() => audio.emit('ended'));
  act(() => audio.emit('playing'));
  await act(async () => {
    now += 60000;
    audio.currentTime = 60;
    audio.emit('timeupdate');
  });
  expect(bodies).toHaveLength(2);
  expect(bodies[0]?.eventId).not.toBe(bodies[1]?.eventId);
});
/** Disabled collection emits nothing and a failed request cannot reset audio or its queue. */
it('should keep playback intact when recording is disabled or fails', async () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(Date, 'now').mockImplementation(() => Date.parse('2026-09-09T00:00:00Z') + now);
  const audio = new AudioFixture();
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ error: { code: 'invalid_request' } }, { status: 400 }),
  );
  const props = { fetcher, apiOrigin: '', audioFactory: () => audio, onUnauthenticated: () => {} };
  const rendered = render(
    <PlayerProvider {...props} listening={{ enabled: false, scope: 'one', csrfToken: 'fixture' }}>
      <Probe />
    </PlayerProvider>,
  );
  fireEvent.click(screen.getByText('Start'));
  act(() => audio.emit('playing'));
  await act(async () => {
    now += 60000;
    audio.currentTime = 60;
    audio.emit('timeupdate');
  });
  expect(fetcher).not.toHaveBeenCalled();
  rendered.rerender(
    <PlayerProvider {...props} listening={{ enabled: true, scope: 'one', csrfToken: 'fixture' }}>
      <Probe />
    </PlayerProvider>,
  );
  fireEvent.click(screen.getByText('Start'));
  act(() => audio.emit('playing'));
  const source = audio.src;
  const loads = audio.load.mock.calls.length;
  const pauses = audio.pause.mock.calls.length;
  await act(async () => {
    now += 60000;
    audio.currentTime = 60;
    audio.emit('timeupdate');
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(audio.src).toBe(source);
  expect(audio.currentTime).toBe(60);
  expect(audio.load).toHaveBeenCalledTimes(loads);
  expect(audio.pause).toHaveBeenCalledTimes(pauses);
});
/** An account generation change aborts pending recording and ignores its late response. */
it('should discard pending recording when the account scope changes', async () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(Date, 'now').mockImplementation(() => Date.parse('2026-09-09T00:00:00Z') + now);
  const audio = new AudioFixture();
  let pendingSignal: AbortSignal | undefined;
  let resolve!: (response: Response) => void;
  let calls = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    calls++;
    pendingSignal = init?.signal ?? undefined;
    return new Promise<Response>((done) => {
      resolve = done;
    });
  };
  const onUnauthenticated = () => {};
  const props = { fetcher, apiOrigin: '', audioFactory: () => audio, onUnauthenticated };
  const page = render(
    <PlayerProvider {...props} listening={{ enabled: true, scope: 'one', csrfToken: 'first' }}>
      <Probe />
    </PlayerProvider>,
  );
  fireEvent.click(screen.getByText('Start'));
  act(() => audio.emit('playing'));
  act(() => {
    now += 60000;
    audio.currentTime = 60;
    audio.emit('timeupdate');
  });
  expect(calls).toBe(1);
  page.rerender(
    <PlayerProvider {...props} listening={{ enabled: true, scope: 'two', csrfToken: 'second' }}>
      <Probe />
    </PlayerProvider>,
  );
  expect(pendingSignal?.aborted).toBe(true);
  await act(async () => {
    resolve(Response.json({ schemaVersion: 1, delivery: { status: 'submitted' } }));
    now += 60000;
    audio.currentTime = 120;
    audio.emit('timeupdate');
  });
  expect(calls).toBe(1);
});
