import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MusicEntry } from '@musiclatte/contracts';

interface PlayerState {
  status: string;
  current: MusicEntry | null;
  currentTime: number;
  duration: number;
  volume: number;
  error: string | null;
}

interface StateModule {
  initialPlayerState: PlayerState;
  reducePlayerState(state: PlayerState, action: Record<string, unknown>): PlayerState;
}

async function moduleAt(path: string) {
  const file = resolve(`apps/web/src/${path}`);
  expect(existsSync(file), `${path} implementation`).toBe(true);
  return import(file) as Promise<StateModule>;
}

const song = {
  id: 'song / 한글',
  title: 'A patient song title',
  artist: 'Fixture artist',
  duration: 240,
  isDir: false,
} satisfies MusicEntry;

describe('player state', () => {
  /** Does not claim playback before the media element confirms the playing event. */
  it('should remain loading until audio confirms playback', async () => {
    const player = await moduleAt('player/state.ts');
    const selected = player.reducePlayerState(player.initialPlayerState, {
      type: 'activate',
      songs: [song],
      song,
      source: 'folder:fixture',
    });

    expect(selected.status).toBe('loading');
    expect(selected.current?.id).toBe(song.id);
    expect(player.reducePlayerState(selected, { type: 'playing' }).status).toBe('playing');
  });

  /** Surfaces a current play-promise rejection and leaves controls in a resumable state. */
  it('should expose a play rejection without reporting playing', async () => {
    const player = await moduleAt('player/state.ts');
    const selected = player.reducePlayerState(player.initialPlayerState, {
      type: 'activate',
      songs: [song],
      song,
      source: 'search:fixture',
    });
    const rejected = player.reducePlayerState(selected, {
      type: 'play-rejected',
      error: 'play_not_allowed',
    });

    expect(rejected.status).toBe('paused');
    expect(rejected.error).toBe('play_not_allowed');
    expect(rejected.current?.id).toBe(song.id);
  });

  /** Keeps a concrete media-element failure when the related play Promise rejects later. */
  it('should not replace a media error with a later generic play rejection', async () => {
    const player = await moduleAt('player/state.ts');
    const selected = player.reducePlayerState(player.initialPlayerState, {
      type: 'activate',
      songs: [song],
      song,
      source: 'folder:fixture',
    });
    const failed = player.reducePlayerState(selected, {
      type: 'media-error',
      error: 'media_unavailable',
    });

    expect(
      player.reducePlayerState(failed, {
        type: 'play-rejected',
        error: 'play_not_allowed',
      }),
    ).toEqual(failed);
  });

  /** Tracks seek, duration, and volume with finite clamped media values. */
  it('should clamp media progress and volume updates', async () => {
    const player = await moduleAt('player/state.ts');
    const selected = player.reducePlayerState(player.initialPlayerState, {
      type: 'activate',
      songs: [song],
      song,
      source: 'album:fixture',
    });
    const timed = player.reducePlayerState(selected, {
      type: 'time',
      currentTime: 999,
      duration: 240,
    });
    const volume = player.reducePlayerState(timed, { type: 'volume', volume: 2 });

    expect(timed.currentTime).toBe(240);
    expect(timed.duration).toBe(240);
    expect(volume.volume).toBe(1);
  });

  /** Clears authenticated media identity and queue on account teardown. */
  it('should return to an empty idle state when cleared', async () => {
    const player = await moduleAt('player/state.ts');
    const selected = player.reducePlayerState(player.initialPlayerState, {
      type: 'activate',
      songs: [song],
      song,
      source: 'folder:fixture',
    });

    expect(player.reducePlayerState(selected, { type: 'clear' })).toEqual(
      player.initialPlayerState,
    );
  });
});
