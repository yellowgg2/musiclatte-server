// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PlaybackQualityPanel } from '../src/pages/settings/PlaybackQualityPanel';
import { PlayerProvider, usePlayer } from '../src/player/PlayerProvider';
import { usePlaybackQuality } from '../src/player/use-playback-quality';
import { QualityFeedback } from '../src/player/QualityFeedback';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('preserves current source while selecting a native radio and applies economy to next play', async () => {
  const audio = {
    src: '',
    currentTime: 0,
    duration: 180,
    paused: true,
    ended: false,
    error: null,
    volume: 1,
    load: vi.fn(),
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  const song = { id: 'one', title: 'One', isDir: false, duration: 180 };
  function Start() {
    const p = usePlayer();
    return (
      <button onClick={() => p.activate({ song, songs: [song], source: 'fixture' })}>Start</button>
    );
  }
  const fetcher: typeof fetch = async () =>
    Response.json({
      schemaVersion: 1,
      requestedQuality: 'economy',
      effectiveQuality: 'economy',
      seekMode: 'offset',
      durationSeconds: 180,
      streamPath: '/api/v1/media/songs/one/stream?quality=economy',
    });
  function App() {
    const pref = usePlaybackQuality('', 'instance', 'account');
    return (
      <PlayerProvider
        apiOrigin=""
        fetcher={fetcher}
        onUnauthenticated={() => {}}
        audioFactory={() => audio}
        {...(pref.value
          ? { quality: { enabled: true, value: pref.value, scope: pref.scope } }
          : {})}
      >
        <PlaybackQualityPanel locale="en" enabled preference={pref} />
        <QualityFeedback locale="en" />
        <Start />
      </PlayerProvider>
    );
  }
  render(<App />);
  fireEvent.click(screen.getByText('Start'));
  audio.currentTime = 37;
  const src = audio.src;
  const loads = audio.load.mock.calls.length;
  fireEvent.click(screen.getByRole('radio', { name: 'Economy (MP3 up to 128 kbps)' }));
  expect(
    (screen.getByRole('radio', { name: 'Economy (MP3 up to 128 kbps)' }) as HTMLInputElement)
      .checked,
  ).toBe(true);
  expect(audio.src).toBe(src);
  expect(audio.currentTime).toBe(37);
  expect(audio.load).toHaveBeenCalledTimes(loads);
  fireEvent.click(screen.getByText('Start'));
  await waitFor(() => expect(audio.src).toContain('quality=economy'));
});

it('isolates account preferences and preserves selection when browser storage is blocked', async () => {
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  function Preference({ account }: { account: string }) {
    const p = usePlaybackQuality('', 'isolated-instance', account);
    return (
      <>
        <button onClick={() => p.set('economy')}>Choose</button>
        <output>{p.value ?? 'unset'}</output>
      </>
    );
  }
  const view = render(<Preference account="first" />);
  fireEvent.click(screen.getByText('Choose'));
  expect(screen.getByRole('status').textContent).toBe('economy');
  view.rerender(<Preference account="second" />);
  expect(screen.getByRole('status').textContent).toBe('unset');
  view.rerender(<Preference account="first" />);
  expect(screen.getByRole('status').textContent).toBe('economy');
  await act(async () => {});
  get.mockRestore();
});

it('ignores delayed storage reads after a choice or account change', async () => {
  const quality = await import('../src/player/quality');
  const resolvers: ((key: string) => void)[] = [];
  vi.spyOn(quality, 'qualityStorageKey').mockImplementation(
    () => new Promise((resolve) => resolvers.push(resolve)),
  );
  vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('original');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
  function Preference({ account }: { account: string }) {
    const p = usePlaybackQuality('', 'late-instance', account);
    return (
      <>
        <button onClick={() => p.set('economy')}>Choose</button>
        <output>{p.value ?? 'unset'}</output>
      </>
    );
  }
  const view = render(<Preference account="late-first" />);
  fireEvent.click(screen.getByText('Choose'));
  await act(async () => resolvers[0]!('old-key'));
  expect(screen.getByRole('status').textContent).toBe('economy');
  view.rerender(<Preference account="late-second" />);
  await act(async () => resolvers[1]!('old-write-key'));
  expect(screen.getByRole('status').textContent).toBe('unset');
  await act(async () => resolvers[2]!('new-key'));
  expect(screen.getByRole('status').textContent).toBe('original');
});
