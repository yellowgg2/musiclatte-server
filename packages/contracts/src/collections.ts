import type { MusicEntry, SubsonicId } from './subsonic.js';

export interface SubsonicPlaylistSummary {
  id: SubsonicId;
  name: string;
  owner: string;
  songCount: number;
  created: string;
  changed: string;
  duration: number;
  public: boolean;
}

export interface SubsonicPlaylist extends SubsonicPlaylistSummary {
  entry: MusicEntry[];
}

export type SubsonicStarredSongs = MusicEntry[];
