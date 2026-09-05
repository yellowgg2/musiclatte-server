import type { MusicEntry } from '@musiclatte/contracts';
/** S10 supplies a capability-checked consumer; browsing never starts audio implicitly. */
export type SongActivation = (selection: {
  song: MusicEntry;
  songs: readonly MusicEntry[];
  source: string;
  position?: number;
}) => void;
