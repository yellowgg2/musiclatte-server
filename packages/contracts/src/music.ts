import type {
  MusicAlbum,
  MusicArtist,
  MusicDirectory,
  MusicEntry,
  MusicFolder,
  MusicIndexes,
  MusicSearchResult,
} from './subsonic.js';

export type MusicFoldersResponse =
  { schemaVersion: 1; folders: MusicFolder[] } | { schemaVersion: 1; indexes: MusicIndexes };
export interface MusicDirectoryResponse {
  schemaVersion: 1;
  directory: MusicDirectory;
}
export interface MusicSearchResponse {
  schemaVersion: 1;
  result: MusicSearchResult;
}
export interface MusicArtistResponse {
  schemaVersion: 1;
  artist: MusicArtist;
}
export interface MusicAlbumResponse {
  schemaVersion: 1;
  album: MusicAlbum;
}
export interface MusicRandomResponse {
  schemaVersion: 1;
  songs: MusicEntry[];
}
export interface MusicSearchQuery {
  q: string;
  musicFolderId?: string;
  artistCount?: string;
  artistOffset?: string;
  albumCount?: string;
  albumOffset?: string;
  songCount?: string;
  songOffset?: string;
}
export interface MusicRandomQuery {
  size?: string;
  musicFolderId?: string;
  genre?: string;
  fromYear?: string;
  toYear?: string;
}
const text = { type: 'string' } as const;
const number = { type: 'number' } as const;
const id = { type: 'string', minLength: 1, maxLength: 2048 } as const;
const array = (items: object) => ({ type: 'array', items });
const object = (required: string[], properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required,
  properties,
});
const entry = object(['id', 'title', 'isDir'], {
  id: text,
  title: text,
  isDir: { type: 'boolean' },
  parent: text,
  albumId: text,
  artistId: text,
  coverArt: text,
  album: text,
  artist: text,
  contentType: text,
  suffix: text,
  starred: text,
  duration: number,
  bitRate: number,
  size: number,
  track: number,
  year: number,
});
const album = object(['id', 'name', 'song'], {
  id: text,
  name: text,
  artist: text,
  artistId: text,
  coverArt: text,
  songCount: number,
  duration: number,
  year: number,
  song: array(entry),
});
const artist = object(['id', 'name', 'album'], {
  id: text,
  name: text,
  coverArt: text,
  albumCount: number,
  album: array(album),
});
const indexes = object(['index'], {
  lastModified: number,
  ignoredArticles: text,
  index: array(object(['name', 'artist'], { name: text, artist: array(artist) })),
});
const response = (key: string, value: object) =>
  object(['schemaVersion', key], { schemaVersion: { const: 1 }, [key]: value });
export const musicResponseSchemas = {
  folders: {
    anyOf: [
      response('folders', array(object(['id', 'name'], { id: text, name: text }))),
      response('indexes', indexes),
    ],
  },
  directory: response(
    'directory',
    object(['id', 'name', 'child'], { id: text, name: text, parent: text, child: array(entry) }),
  ),
  search: response(
    'result',
    object(['artist', 'album', 'song'], {
      artist: array(artist),
      album: array(album),
      song: array(entry),
    }),
  ),
  artist: response('artist', artist),
  album: response('album', album),
  random: response('songs', array(entry)),
};
const integer = { type: 'string', pattern: '^(0|[1-9][0-9]*)$', maxLength: 16 };
export const musicQuerySchemas = {
  empty: object([], {}),
  folders: object([], { musicFolderId: id }),
  search: object(['q'], {
    q: { ...id, pattern: '\\S' },
    musicFolderId: id,
    artistCount: integer,
    artistOffset: integer,
    albumCount: integer,
    albumOffset: integer,
    songCount: integer,
    songOffset: integer,
  }),
  random: object([], {
    size: integer,
    musicFolderId: id,
    genre: id,
    fromYear: integer,
    toYear: integer,
  }),
};
export const musicIdSchema = object(['id'], { id });
