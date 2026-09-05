import type { MusicEntry } from '@musiclatte/contracts';

export type RepeatMode = 'off' | 'all' | 'one';

export interface PlayerQueue {
  items: readonly MusicEntry[];
  order: readonly number[];
  position: number;
  source: string;
  repeat: RepeatMode;
  shuffled: boolean;
}

export function createQueue(
  items: readonly MusicEntry[],
  currentId: string,
  source: string,
  position?: number,
): PlayerQueue {
  const playable = items.filter((item) => !item.isDir);
  const selected = position ?? playable.findIndex((item) => item.id === currentId);
  if (
    selected < 0 ||
    !Number.isInteger(selected) ||
    selected >= playable.length ||
    playable[selected]?.id !== currentId
  )
    throw new RangeError('Selected song position is not in the queue');
  return {
    items: playable,
    order: playable.map((_, index) => index),
    position: selected,
    source,
    repeat: 'off',
    shuffled: false,
  };
}

export function currentSong(queue: PlayerQueue | null): MusicEntry | null {
  if (!queue) return null;
  const itemIndex = queue.order[queue.position];
  return itemIndex === undefined ? null : (queue.items[itemIndex] ?? null);
}

export function advanceQueue(
  queue: PlayerQueue,
  direction: 'next' | 'previous',
  ended = false,
): PlayerQueue | null {
  if (ended && queue.repeat === 'one') return queue;
  const delta = direction === 'next' ? 1 : -1;
  const next = queue.position + delta;
  if (next >= 0 && next < queue.order.length) return { ...queue, position: next };
  if (queue.repeat === 'all' && queue.order.length > 0)
    return { ...queue, position: direction === 'next' ? 0 : queue.order.length - 1 };
  return null;
}

export function setRepeat(queue: PlayerQueue, repeat: RepeatMode): PlayerQueue {
  return { ...queue, repeat };
}

export function setShuffle(
  queue: PlayerQueue,
  enabled: boolean,
  random: () => number = Math.random,
): PlayerQueue {
  if (enabled === queue.shuffled) return queue;
  const currentIndex = queue.order[queue.position];
  if (currentIndex === undefined) return queue;
  if (!enabled)
    return {
      ...queue,
      order: queue.items.map((_, index) => index),
      position: currentIndex,
      shuffled: false,
    };
  const remaining = queue.items.map((_, index) => index).filter((index) => index !== currentIndex);
  for (let index = remaining.length - 1; index > 0; index--) {
    const target = Math.min(index, Math.max(0, Math.floor(random() * (index + 1))));
    [remaining[index], remaining[target]] = [remaining[target]!, remaining[index]!];
  }
  return { ...queue, order: [currentIndex, ...remaining], position: 0, shuffled: true };
}

export function replaceWithRandom(queue: PlayerQueue, songs: readonly MusicEntry[]): PlayerQueue;
export function replaceWithRandom(
  queue: PlayerQueue | null,
  songs: readonly MusicEntry[],
): PlayerQueue | null;
export function replaceWithRandom(
  queue: PlayerQueue | null,
  songs: readonly MusicEntry[],
): PlayerQueue | null {
  const playable = songs.filter((song) => !song.isDir);
  return playable.length === 0 ? queue : createQueue(playable, playable[0]!.id, 'random');
}
