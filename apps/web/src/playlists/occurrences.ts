import type { PlaylistOccurrence } from '@musiclatte/contracts';

export type OccurrenceIdentity = { position: number; songId: string };

export function moveOccurrenceOrder(
  entries: readonly PlaylistOccurrence[],
  occurrence: OccurrenceIdentity,
  direction: 'up' | 'down',
): number[] | undefined {
  const index = entries.findIndex(
    (entry) => entry.position === occurrence.position && entry.song.id === occurrence.songId,
  );
  const destination = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || destination < 0 || destination >= entries.length) return undefined;
  const order = entries.map((entry) => entry.position);
  [order[index], order[destination]] = [order[destination]!, order[index]!];
  return order;
}
