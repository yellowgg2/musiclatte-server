import type { MusicAlbum, MusicArtist, MusicDirectory, MusicEntry, MusicFolder, MusicIndexes, MusicSearchResult, SubsonicIdentity, SubsonicPing, SubsonicTokenProof } from '@musiclatte/contracts';
import { SubsonicError } from './errors.js';
import { decodeAlbum, decodeArtist, decodeDirectory, decodeEnvelope, decodeFolders, decodeIdentity, decodeIndexes, decodeRandom, decodeSearch, encodeParameters } from './protocol.js';

export interface RequestOptions { signal?: AbortSignal }
export interface SearchOptions extends RequestOptions {
  artistCount?: number; artistOffset?: number; albumCount?: number; albumOffset?: number; songCount?: number; songOffset?: number; musicFolderId?: string;
}
export interface RandomOptions extends RequestOptions { size?: number; musicFolderId?: string; genre?: string; fromYear?: number; toYear?: number }
export interface MediaOptions extends RequestOptions { size?: number; method?: 'GET' | 'HEAD'; range?: string }
export interface SubsonicClient {
  /** Explicit authenticated admin action only; never used for discovery. */
  startScan(options?: RequestOptions): Promise<void>;
  ping(options?: RequestOptions): Promise<SubsonicPing>;
  currentUser(options?: RequestOptions): Promise<SubsonicIdentity>;
  folders(options?: RequestOptions): Promise<MusicFolder[]>;
  indexes(folderId?: string, options?: RequestOptions): Promise<MusicIndexes>;
  directory(id: string, options?: RequestOptions): Promise<MusicDirectory>;
  search(query: string, options?: SearchOptions): Promise<MusicSearchResult>;
  artist(id: string, options?: RequestOptions): Promise<MusicArtist>;
  album(id: string, options?: RequestOptions): Promise<MusicAlbum>;
  random(options?: RandomOptions): Promise<MusicEntry[]>;
  /** Credential-bearing request, for server-side transport only; S09 owns fetching/stream cleanup. */
  mediaRequest(kind: 'stream' | 'getCoverArt', id: string, options?: MediaOptions): Request;
}
export interface SubsonicClientOptions {
  upstream: string; proof: SubsonicTokenProof; timeoutMs: number;
  logger?: (event: Readonly<Record<string, unknown>>) => void;
}
type Operation = 'startScan' | 'ping' | 'getUser' | 'getMusicFolders' | 'getIndexes' | 'getMusicDirectory' | 'search3' | 'getArtist' | 'getAlbum' | 'getRandomSongs' | 'stream' | 'getCoverArt';
type Pair = readonly [string, string];
function required(value: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new SubsonicError('invalid_request');
  return value;
}
function numeric(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new SubsonicError('invalid_request');
  return String(value);
}
function folderPair(value?: string): Pair[] { return value === undefined ? [] : [['musicFolderId', required(value)]]; }

export function createSubsonicClient(options: SubsonicClientOptions): SubsonicClient {
  let origin: string;
  try {
    const url = new URL(options.upstream);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 2_147_483_647) throw new Error();
    if (typeof options.proof.username !== 'string' || !options.proof.username || typeof options.proof.s !== 'string' || !options.proof.s || !/^[a-f0-9]{32}$/.test(options.proof.t)) throw new Error();
    origin = url.origin;
  } catch { throw new SubsonicError('invalid_configuration'); }
  const proof = { ...options.proof };
  const timeoutMs = options.timeoutMs;
  const logger = options.logger;
  function buildURL(operation: Operation, pairs: Pair[]): URL {
    const url = new URL(`/rest/${operation}`, origin);
    url.search = encodeParameters([
      ['u', proof.username], ['t', proof.t], ['s', proof.s], ['v', '1.15.0'], ['c', 'musiclatte-web'], ['f', 'json'], ...pairs,
    ]).toString();
    return url;
  }
  async function request(operation: Operation, pairs: Pair[], requestOptions: RequestOptions = {}): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const external = requestOptions.signal;
    const cancel = () => controller.abort();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    external?.addEventListener('abort', cancel, { once: true });
    try {
      if (external?.aborted) throw new SubsonicError('cancelled');
      const response = await fetch(buildURL(operation, pairs), { method: 'GET', redirect: 'manual', signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) {
        await response.body?.cancel();
        throw new SubsonicError('http_error', undefined, response.status);
      }
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
        await response.body?.cancel();
        throw new SubsonicError('invalid_response');
      }
      const text = await response.text();
      let body: unknown;
      try { body = JSON.parse(text); } catch { throw new SubsonicError('invalid_response'); }
      return decodeEnvelope(body);
    } catch (cause) {
      const error = external?.aborted ? new SubsonicError('cancelled') : timedOut ? new SubsonicError('timeout') : cause instanceof SubsonicError ? cause : new SubsonicError('network');
      // A diagnostic sink cannot change protocol behavior or receive uncontrolled upstream text.
      try { logger?.(Object.freeze({ operation, outcome: 'error', kind: error.kind, code: error.code, httpStatus: error.httpStatus })); } catch { /* diagnostic failure only */ }
      throw error;
    } finally {
      clearTimeout(timer);
      external?.removeEventListener('abort', cancel);
    }
  }
  return {
    async startScan(opts) { await request('startScan', [], opts); },
    async ping(opts) { const body = await request('ping', [], opts); return { status: 'ok', version: String(body.version) }; },
    async currentUser(opts) { return decodeIdentity((await request('getUser', [['username', proof.username]], opts)).user); },
    async folders(opts) { return decodeFolders((await request('getMusicFolders', [], opts)).musicFolders); },
    async indexes(folderId, opts) { return decodeIndexes((await request('getIndexes', folderPair(folderId), opts)).indexes); },
    async directory(id, opts) { return decodeDirectory((await request('getMusicDirectory', [['id', required(id)]], opts)).directory); },
    async search(query, opts = {}) {
      const pairs: Pair[] = [['query', required(query)], ...folderPair(opts.musicFolderId)];
      for (const key of ['artistCount', 'artistOffset', 'albumCount', 'albumOffset', 'songCount', 'songOffset'] as const) {
        if (opts[key] !== undefined) pairs.push([key, numeric(opts[key])]);
      }
      return decodeSearch((await request('search3', pairs, opts)).searchResult3);
    },
    async artist(id, opts) { return decodeArtist((await request('getArtist', [['id', required(id)]], opts)).artist); },
    async album(id, opts) { return decodeAlbum((await request('getAlbum', [['id', required(id)]], opts)).album); },
    async random(opts = {}) {
      const pairs = folderPair(opts.musicFolderId);
      for (const key of ['size', 'fromYear', 'toYear'] as const) if (opts[key] !== undefined) pairs.push([key, numeric(opts[key])]);
      if (opts.genre !== undefined) pairs.push(['genre', required(opts.genre)]);
      return decodeRandom((await request('getRandomSongs', pairs, opts)).randomSongs);
    },
    mediaRequest(kind, id, opts = {}) {
      if (!['stream', 'getCoverArt'].includes(kind) || !['GET', 'HEAD'].includes(opts.method ?? 'GET')) throw new SubsonicError('invalid_request');
      const pairs: Pair[] = [['id', required(id)]];
      if (opts.size !== undefined) pairs.push(['size', numeric(opts.size)]);
      if (opts.range !== undefined && !/^bytes=\d*-\d*(?:,\s*\d*-\d*)*$/.test(opts.range)) throw new SubsonicError('invalid_request');
      return new Request(buildURL(kind, pairs), {
        method: opts.method ?? 'GET', redirect: 'manual',
        ...(opts.signal ? { signal: opts.signal } : {}),
        headers: opts.range === undefined ? {} : { Range: opts.range },
      });
    },
  };
}
