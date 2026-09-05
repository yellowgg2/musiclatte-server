import type { MusicAlbum, MusicArtist, MusicDirectory, MusicEntry, MusicFolder, MusicIndexes, MusicSearchResult, SubsonicIdentity } from '@musiclatte/contracts';
import { standardError, SubsonicError } from './errors.js';

export function encodeParameters(pairs: ReadonlyArray<readonly [string, string]>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of pairs) params.append(key, value);
  return params;
}
function invalid(): never { throw new SubsonicError('invalid_response'); }
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function string(value: unknown): string { return typeof value === 'string' ? value : invalid(); }
function id(value: unknown): string { const result = string(value); return result.length > 0 ? result : invalid(); }
function number(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : invalid(); }
function boolean(value: unknown): boolean { return typeof value === 'boolean' ? value : invalid(); }
function list<T>(value: unknown, parse: (item: unknown) => T): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value.map(parse) : invalid();
}
function optional<K extends string, T>(source: Record<string, unknown>, key: K, parse: (value: unknown) => T): Partial<Record<K, T>> {
  return source[key] === undefined ? {} : { [key]: parse(source[key]) } as Record<K, T>;
}
export function decodeEnvelope(value: unknown): Record<string, unknown> {
  const body = record(record(value)['subsonic-response']);
  if (typeof body.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(body.version)) return invalid();
  if (body.status === 'failed') {
    const error = record(body.error);
    if (typeof error.code !== 'number' || !Number.isSafeInteger(error.code) || error.code < 0) return invalid();
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
  return list(record(value).musicFolder, item => {
    const source = record(item);
    const folderId = typeof source.id === 'number' && Number.isSafeInteger(source.id) && source.id >= 0 ? String(source.id) : id(source.id);
    return { id: folderId, name: source.name === undefined ? '' : string(source.name) };
  });
}
function entry(value: unknown): MusicEntry {
  const source = record(value);
  return {
    id: id(source.id), title: string(source.title), isDir: boolean(source.isDir),
    ...optional(source, 'parent', id), ...optional(source, 'albumId', id), ...optional(source, 'artistId', id), ...optional(source, 'coverArt', id),
    ...optional(source, 'album', string), ...optional(source, 'artist', string), ...optional(source, 'contentType', string), ...optional(source, 'suffix', string), ...optional(source, 'starred', string),
    ...optional(source, 'duration', number), ...optional(source, 'bitRate', number), ...optional(source, 'size', number), ...optional(source, 'track', number), ...optional(source, 'year', number),
  };
}
export function decodeAlbum(value: unknown): MusicAlbum {
  const source = record(value);
  return {
    id: id(source.id), name: string(source.name), song: list(source.song, entry),
    ...optional(source, 'artist', string), ...optional(source, 'artistId', id), ...optional(source, 'coverArt', id),
    ...optional(source, 'songCount', number), ...optional(source, 'duration', number), ...optional(source, 'year', number),
  };
}
export function decodeArtist(value: unknown): MusicArtist {
  const source = record(value);
  return { id: id(source.id), name: string(source.name), album: list(source.album, decodeAlbum), ...optional(source, 'coverArt', id), ...optional(source, 'albumCount', number) };
}
export function decodeIndexes(value: unknown): MusicIndexes {
  const source = record(value);
  return {
    ...optional(source, 'lastModified', number), ...optional(source, 'ignoredArticles', string),
    index: list(source.index, item => {
      const index = record(item); return { name: string(index.name), artist: list(index.artist, decodeArtist) };
    }),
  };
}
export function decodeDirectory(value: unknown): MusicDirectory {
  const source = record(value);
  return { id: id(source.id), name: string(source.name), child: list(source.child, entry), ...optional(source, 'parent', id) };
}
export function decodeSearch(value: unknown): MusicSearchResult {
  const source = record(value);
  return { artist: list(source.artist, decodeArtist), album: list(source.album, decodeAlbum), song: list(source.song, entry) };
}
export function decodeRandom(value: unknown): MusicEntry[] { return list(record(value).song, entry); }
