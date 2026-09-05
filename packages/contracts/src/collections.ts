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

export interface PlaylistCreateRequest {
  operationId: string;
  name: string;
}

interface PlaylistMutationBase {
  operationId: string;
  expectedRevision: string;
}

export type PlaylistMutationRequest =
  | (PlaylistMutationBase & { action: 'rename'; name: string })
  | (PlaylistMutationBase & { action: 'append'; songIds: string[] })
  | (PlaylistMutationBase & {
      action: 'remove';
      occurrence: { position: number; songId: string };
    })
  | (PlaylistMutationBase & { action: 'reorder'; order: number[] });

export interface PlaylistDeleteRequest extends PlaylistMutationBase {}

export type PlaylistMutationOutcome = 'applied' | 'already_applied';

export interface PlaylistMutationResponse {
  schemaVersion: 1;
  outcome: PlaylistMutationOutcome;
  playlist: PlaylistDetail;
}

export interface PlaylistDeleteResponse {
  schemaVersion: 1;
  outcome: PlaylistMutationOutcome;
  playlistId: string;
  deleted: true;
}

export interface PlaylistMutationConflictResponse {
  schemaVersion: 1;
  error: { code: 'conflict' | 'outcome_unknown'; retryable: false };
  current?: PlaylistDetail;
}

const text = { type: 'string' } as const;
const id = { type: 'string', minLength: 1, maxLength: 2048 } as const;
const integer = { type: 'integer', minimum: 0 } as const;
const timestamp = { type: 'string', format: 'date-time' } as const;
const revision = { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' } as const;
const operationId = { type: 'string', pattern: '^[A-Za-z0-9_-]{22,128}$' } as const;
const playlistName = { type: 'string', minLength: 1, maxLength: 255 } as const;
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
const detailSchema = {
  oneOf: [
    object(detailRequired, detailProperties),
    object([...detailRequired, 'coverArt'], {
      ...detailProperties,
      coverState: { const: 'available' },
      coverArt: id,
    }),
  ],
};

const mutationBase = {
  operationId,
  expectedRevision: revision,
};
const mutationConflictProperties = {
  schemaVersion: { const: 1 },
  error: object(['code', 'retryable'], {
    code: { enum: ['conflict', 'outcome_unknown'] },
    retryable: { const: false },
  }),
};

export const playlistQuerySchemas = {
  empty: object([], {}),
};

export const playlistMutationSchemas = {
  empty: object([], {}),
  create: object(['operationId', 'name'], { operationId, name: playlistName }),
  patch: {
    oneOf: [
      object(['operationId', 'expectedRevision', 'action', 'name'], {
        ...mutationBase,
        action: { const: 'rename' },
        name: playlistName,
      }),
      object(['operationId', 'expectedRevision', 'action', 'songIds'], {
        ...mutationBase,
        action: { const: 'append' },
        songIds: { type: 'array', minItems: 1, items: id },
      }),
      object(['operationId', 'expectedRevision', 'action', 'occurrence'], {
        ...mutationBase,
        action: { const: 'remove' },
        occurrence: object(['position', 'songId'], { position: integer, songId: id }),
      }),
      object(['operationId', 'expectedRevision', 'action', 'order'], {
        ...mutationBase,
        action: { const: 'reorder' },
        order: { type: 'array', uniqueItems: true, items: integer },
      }),
    ],
  },
  delete: object(['operationId', 'expectedRevision'], mutationBase),
};

export const playlistIdSchema = object(['id'], { id });

export const playlistResponseSchemas = {
  list: object(['schemaVersion', 'playlists'], {
    schemaVersion: { const: 1 },
    playlists: { type: 'array', items: object(summaryRequired, summaryProperties) },
  }),
  detail: object(['schemaVersion', 'playlist'], {
    schemaVersion: { const: 1 },
    playlist: detailSchema,
  }),
  mutation: object(['schemaVersion', 'outcome', 'playlist'], {
    schemaVersion: { const: 1 },
    outcome: { enum: ['applied', 'already_applied'] },
    playlist: detailSchema,
  }),
  deleted: object(['schemaVersion', 'outcome', 'playlistId', 'deleted'], {
    schemaVersion: { const: 1 },
    outcome: { enum: ['applied', 'already_applied'] },
    playlistId: id,
    deleted: { const: true },
  }),
  mutationConflict: {
    oneOf: [
      object(['schemaVersion', 'error'], mutationConflictProperties),
      object(['schemaVersion', 'error', 'current'], {
        ...mutationConflictProperties,
        current: detailSchema,
      }),
    ],
  },
};
