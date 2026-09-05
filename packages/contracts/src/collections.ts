import type { MusicEntry, SubsonicId } from './subsonic.js';
import { musicEntrySchema } from './music.js';

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

export type PlaylistCoverState = 'fallback' | 'available';

export interface PlaylistSummary extends SubsonicPlaylistSummary {
  editable: boolean;
  coverState: 'fallback';
  revision: string;
}

export interface PlaylistOccurrence {
  position: number;
  song: MusicEntry;
}

export interface PlaylistDetail extends Omit<PlaylistSummary, 'coverState'> {
  coverState: PlaylistCoverState;
  coverArt?: string;
  entries: PlaylistOccurrence[];
}

export interface PlaylistsResponse {
  schemaVersion: 1;
  playlists: PlaylistSummary[];
}

export interface PlaylistDetailResponse {
  schemaVersion: 1;
  playlist: PlaylistDetail;
}

const text = { type: 'string' } as const;
const id = { type: 'string', minLength: 1, maxLength: 2048 } as const;
const integer = { type: 'integer', minimum: 0 } as const;
const timestamp = { type: 'string', format: 'date-time' } as const;
const revision = { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' } as const;
const object = (required: string[], properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required,
  properties,
});
const summaryProperties = {
  id,
  name: text,
  owner: id,
  songCount: integer,
  created: timestamp,
  changed: timestamp,
  duration: integer,
  public: { type: 'boolean' },
  editable: { type: 'boolean' },
  coverState: { const: 'fallback' },
  revision,
};
const summaryRequired = Object.keys(summaryProperties);
const occurrence = object(['position', 'song'], { position: integer, song: musicEntrySchema });
const detailProperties = {
  ...summaryProperties,
  coverState: { const: 'fallback' },
  entries: { type: 'array', items: occurrence },
};
const detailRequired = [...summaryRequired, 'entries'];

export const playlistQuerySchemas = {
  empty: object([], {}),
};

export const playlistIdSchema = object(['id'], { id });

export const playlistResponseSchemas = {
  list: object(['schemaVersion', 'playlists'], {
    schemaVersion: { const: 1 },
    playlists: { type: 'array', items: object(summaryRequired, summaryProperties) },
  }),
  detail: object(['schemaVersion', 'playlist'], {
    schemaVersion: { const: 1 },
    playlist: {
      oneOf: [
        object(detailRequired, detailProperties),
        object([...detailRequired, 'coverArt'], {
          ...detailProperties,
          coverState: { const: 'available' },
          coverArt: id,
        }),
      ],
    },
  }),
};
