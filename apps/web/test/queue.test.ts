import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MusicEntry } from '@musiclatte/contracts';

const songs = ['one', 'two', 'three'].map(
  (id, index) =>
    ({
      id,
      title: `Song ${index + 1}`,
      artist: 'Fixture artist',
      duration: 120 + index,
      isDir: false,
    }) satisfies MusicEntry,
);

interface QueueState {
  items: readonly MusicEntry[];
  order: readonly number[];
  position: number;
  source: string;
  repeat: 'off' | 'all' | 'one';
  shuffled: boolean;
}

interface QueueModule {
  createQueue(items: readonly MusicEntry[], currentId: string, source: string): QueueState;
  currentSong(queue: QueueState): MusicEntry | null;
  advanceQueue(
    queue: QueueState,
    direction: 'next' | 'previous',
    ended?: boolean,
  ): QueueState | null;
  setRepeat(queue: QueueState, repeat: QueueState['repeat']): QueueState;
  setShuffle(queue: QueueState, enabled: boolean, random?: () => number): QueueState;
  replaceWithRandom(queue: QueueState, songs: readonly MusicEntry[]): QueueState;
}

async function moduleAt(path: string) {
  const file = resolve(`apps/web/src/${path}`);
  expect(existsSync(file), `${path} implementation`).toBe(true);
  return import(file) as Promise<QueueModule>;
}

describe('player queue', () => {
  /** Starts at the selected song while preserving the source list order. */
  it('should activate the selected song and move through its source queue', async () => {
    const queue = await moduleAt('player/queue.ts');
    const initial = queue.createQueue(songs, 'two', 'folder:fixture');

    expect(queue.currentSong(initial)?.id).toBe('two');
    expect(queue.currentSong(queue.advanceQueue(initial, 'next')!)?.id).toBe('three');
    expect(queue.currentSong(queue.advanceQueue(initial, 'previous')!)?.id).toBe('one');
  });

  /** Stops at the queue edge unless repeat-all explicitly wraps it. */
  it('should stop at the edge and wrap only in repeat-all mode', async () => {
    const queue = await moduleAt('player/queue.ts');
    const last = queue.createQueue(songs, 'three', 'search:fixture');

    expect(queue.advanceQueue(last, 'next')).toBeNull();
    const repeatAll = queue.setRepeat(last, 'all');
    expect(queue.currentSong(queue.advanceQueue(repeatAll, 'next')!)?.id).toBe('one');
  });

  /** Repeats the current item on ended without trapping explicit next actions. */
  it('should apply repeat-one only to automatic ended advancement', async () => {
    const queue = await moduleAt('player/queue.ts');
    const repeatOne = queue.setRepeat(queue.createQueue(songs, 'two', 'album:fixture'), 'one');

    expect(queue.currentSong(queue.advanceQueue(repeatOne, 'next', true)!)?.id).toBe('two');
    expect(queue.currentSong(queue.advanceQueue(repeatOne, 'next', false)!)?.id).toBe('three');
  });

  /** Keeps the current song while producing a deterministic non-repeating shuffle order. */
  it('should preserve the current song when shuffle is enabled', async () => {
    const queue = await moduleAt('player/queue.ts');
    const initial = queue.createQueue(songs, 'two', 'folder:fixture');
    const shuffled = queue.setShuffle(initial, true, () => 0);

    expect(queue.currentSong(shuffled)?.id).toBe('two');
    expect(new Set(shuffled.order)).toEqual(new Set([0, 1, 2]));
    expect(queue.currentSong(queue.advanceQueue(shuffled, 'next')!)?.id).not.toBe('two');
    expect(queue.currentSong(queue.setShuffle(shuffled, false))?.id).toBe('two');
  });

  /** Preserves an existing queue for empty random results and replaces it atomically on success. */
  it('should keep the queue for empty random results and replace it after success', async () => {
    const queue = await moduleAt('player/queue.ts');
    const initial = queue.createQueue(songs, 'two', 'folder:fixture');

    expect(queue.replaceWithRandom(initial, [])).toBe(initial);
    const replacement = queue.replaceWithRandom(initial, [songs[2]!, songs[0]!]);
    expect(queue.currentSong(replacement)?.id).toBe('three');
    expect(replacement.source).toBe('random');
  });
});
