import type {
  ScanStatus,
  MusicAlbum,
  MusicArtist,
  MusicDirectory,
  MusicEntry,
  MusicFolder,
  MusicIndexes,
  MusicSearchResult,
  SubsonicPlaylist,
  SubsonicPlaylistSummary,
  SubsonicStarredSongs,
  SubsonicIdentity,
} from '@musiclatte/contracts';
import { standardError, SubsonicError } from './errors.js';

export function encodeParameters(pairs: ReadonlyArray<readonly [string, string]>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of pairs) params.append(key, value);
  return params;
}
function invalid(): never {
  throw new SubsonicError('invalid_response');
}
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  return typeof value === 'string' ? value : invalid();
}
function id(value: unknown): string {
  const result = string(value);
  return result.length > 0 ? result : invalid();
}
function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : invalid();
}
function integer(value: unknown): number {
  const result = number(value);
  return Number.isSafeInteger(result) ? result : invalid();
}
function boolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : invalid();
}
function list<T>(value: unknown, parse: (item: unknown) => T): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value.map(parse) : invalid();
}
function optional<K extends string, T>(
  source: Record<string, unknown>,
  key: K,
  parse: (value: unknown) => T,
): Partial<Record<K, T>> {
  return source[key] === undefined ? {} : ({ [key]: parse(source[key]) } as Record<K, T>);
}
export function decodeEnvelope(value: unknown): Record<string, unknown> {
  const body = record(record(value)['subsonic-response']);
  if (typeof body.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(body.version)) return invalid();
  if (body.status === 'failed') {
    const error = record(body.error);
    if (typeof error.code !== 'number' || !Number.isSafeInteger(error.code) || error.code < 0)
      return invalid();
    string(error.message);
    throw standardError(error.code);
  }
  if (body.status !== 'ok' || body.error !== undefined) return invalid();
  return body;
}
export function decodeIdentity(value: unknown): SubsonicIdentity {
  const source = record(value);
  return { username: id(source.username), adminRole: boolean(source.adminRole) };
}
export function decodeFolders(value: unknown): MusicFolder[] {
  return list(record(value).musicFolder, (item) => {
    const source = record(item);
    const folderId =
      typeof source.id === 'number' && Number.isSafeInteger(source.id) && source.id >= 0
        ? String(source.id)
        : id(source.id);
    return { id: folderId, name: source.name === undefined ? '' : string(source.name) };
  });
}
export function decodeEntry(value: unknown): MusicEntry {
  const source = record(value);
  return {
    id: id(source.id),
    title: string(source.title),
    isDir: boolean(source.isDir),
    ...optional(source, 'parent', id),
    ...optional(source, 'albumId', id),
    ...optional(source, 'artistId', id),
    ...optional(source, 'coverArt', id),
    ...optional(source, 'album', string),
    ...optional(source, 'artist', string),
    ...optional(source, 'genre', string),
    ...optional(source, 'contentType', string),
    ...optional(source, 'suffix', string),
    ...optional(source, 'starred', string),
    ...optional(source, 'duration', number),
    ...optional(source, 'bitRate', number),
    ...optional(source, 'size', number),
    ...optional(source, 'track', number),
    ...optional(source, 'year', number),
  };
}
export function decodeAlbum(value: unknown): MusicAlbum {
  const source = record(value);
  return {
    id: id(source.id),
    name: string(source.name),
    song: list(source.song, decodeEntry),
    ...optional(source, 'artist', string),
    ...optional(source, 'artistId', id),
    ...optional(source, 'coverArt', id),
    ...optional(source, 'songCount', number),
    ...optional(source, 'duration', number),
    ...optional(source, 'year', number),
  };
}
export function decodeArtist(value: unknown): MusicArtist {
  const source = record(value);
  return {
    id: id(source.id),
    name: string(source.name),
    album: list(source.album, decodeAlbum),
    ...optional(source, 'coverArt', id),
    ...optional(source, 'albumCount', number),
  };
}
export function decodeIndexes(value: unknown): MusicIndexes {
  const source = record(value);
  return {
    ...optional(source, 'lastModified', number),
    ...optional(source, 'ignoredArticles', string),
    index: list(source.index, (item) => {
      const index = record(item);
      return { name: string(index.name), artist: list(index.artist, decodeArtist) };
    }),
  };
}
export function decodeDirectory(value: unknown): MusicDirectory {
  const source = record(value);
  return {
    id: id(source.id),
    name: string(source.name),
    child: list(source.child, decodeEntry),
    ...optional(source, 'parent', id),
  };
}
export function decodeSearch(value: unknown): MusicSearchResult {
  const source = record(value);
  return {
    artist: list(source.artist, decodeArtist),
    album: list(source.album, decodeAlbum),
    song: list(source.song, decodeEntry),
  };
}
export function decodeRandom(value: unknown): MusicEntry[] {
  return list(record(value).song, decodeEntry);
}

function timestamp(value: unknown): string {
  const result = string(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(result) ||
    Number.isNaN(Date.parse(result))
  )
    return invalid();
  return result;
}

function playlistSummary(value: unknown): SubsonicPlaylistSummary {
  const source = record(value);
  return {
    id: id(source.id),
    name: string(source.name),
    owner: id(source.owner),
    songCount: integer(source.songCount),
    created: timestamp(source.created),
    changed: timestamp(source.changed),
    duration: integer(source.duration),
    public: source.public === undefined ? false : boolean(source.public),
  };
}

export function decodePlaylists(value: unknown): SubsonicPlaylistSummary[] {
  return list(record(value).playlist, playlistSummary);
}

export function decodePlaylist(value: unknown): SubsonicPlaylist {
  const source = record(value);
  return {
    ...playlistSummary(source),
    entry: list(source.entry, decodeEntry),
  };
}

export function decodeStarred2(value: unknown): SubsonicStarredSongs {
  return list(record(value).song, decodeEntry);
}

/** Worker-only path projection; never exported through public MusicEntry. */
export interface RegistrationTrack {
  id: string;
  isDir: false;
  path: string;
}
export interface RegistrationDirectory {
  id: string;
  child: Array<RegistrationTrack | { id: string; isDir: true; name: string }>;
}
export function decodeScanStatus(value: unknown): ScanStatus {
  const source = record(value);
  // Gonic v0.22.0 omits a zero count via json:"count,omitempty".
  return {
    scanning: boolean(source.scanning),
    count: source.count === undefined ? 0 : integer(source.count),
  };
}
export function decodeSong(value: unknown): MusicEntry {
  const song = decodeEntry(value);
  if (song.isDir) return invalid();
  return song;
}
/** Server-only current-account path evidence; never extend the public MusicEntry contract. */
export function decodeRecentSong(value: unknown): { song: MusicEntry; path: string | null } {
  const source = record(value);
  return { song: decodeSong(value), path: typeof source.path === 'string' ? source.path : null };
}
export function decodeRegistrationDirectory(value: unknown): RegistrationDirectory {
  const source = record(value);
  return {
    id: id(source.id),
    child: list(source.child, (value) => {
      const child = record(value);
      return boolean(child.isDir)
        ? { id: id(child.id), isDir: true as const, name: string(child.title) }
        : { id: id(child.id), isDir: false as const, path: id(child.path) };
    }),
  };
}

/** Server-only discovery projection includes root child and shortcut entries omitted by legacy indexes UI. */
export interface InventoryIndexes {
  lastModified?: number;
  roots: { id: string; isDir: boolean }[];
}
export function decodeInventoryIndexes(value: unknown): InventoryIndexes {
  const source = record(value);
  const indexes = decodeIndexes(value);
  return {
    ...optional(source, 'lastModified', number),
    roots: [
      ...indexes.index.flatMap((group) =>
        group.artist.map((artist) => ({ id: artist.id, isDir: true })),
      ),
      ...list(source.shortcut, (value) => ({ id: id(record(value).id), isDir: true })),
      ...list(source.child, (value) => ({
        id: id(record(value).id),
        isDir: boolean(record(value).isDir),
      })),
    ],
  };
}

export interface Genre {
  value: string;
  songCount: number;
  albumCount: number;
}
export interface ArtistInfo {
  biography?: string;
  musicBrainzId?: string;
  similarArtist: { id: string; name: string }[];
}
export interface StreamMetadata {
  id: string;
  bitRate?: number;
  duration?: number;
  suffix?: string;
}
export function decodeGenres(value: unknown): Genre[] {
  return list(record(value).genre, (item) => {
    const source = record(item);
    return {
      value: string(source.value),
      songCount: integer(source.songCount),
      albumCount: integer(source.albumCount),
    };
  });
}
export function decodeArtistInfo(value: unknown): ArtistInfo {
  const source = record(value);
  return {
    ...optional(source, 'biography', string),
    ...optional(source, 'musicBrainzId', string),
    similarArtist: list(source.similarArtist, (item) => {
      const artist = record(item);
      return { id: id(artist.id), name: string(artist.name) };
    }),
  };
}
export function decodeStreamMetadata(value: unknown): StreamMetadata {
  const source = record(value);
  return {
    id: id(source.id),
    ...optional(source, 'bitRate', number),
    ...optional(source, 'duration', number),
    ...optional(source, 'suffix', string),
  };
}
export function decodeExtensions(value: unknown): { name: string; versions: number[] }[] {
  return list(value, (item) => {
    const source = record(item);
    if (!Array.isArray(source.versions)) return invalid();
    return { name: id(source.name), versions: source.versions.map(integer) };
  });
}
