import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../../apps/api/src/app.js';
import { createTestContext as storageContext } from './session-storage-harness.js';
import {
  syntheticAudioFixture,
  syntheticCoverFixture,
  syntheticMediaMetadata,
} from '../../packages/test-support/src/media-fixtures.js';
import {
  subsonicFixture,
  subsonicErrorFixture,
} from '../../packages/test-support/src/subsonic-fixtures.js';
import { collectionFixture } from '../../packages/test-support/src/collection-fixtures.js';

export const origin = 'https://music.example.test';
export const password = {
  kind: 'password',
  username: 'fixture-listener',
  password: 'synthetic-password',
};
export const native = {
  kind: 'subsonic-token',
  username: password.username,
  t: createHash('md5')
    .update(password.password + 'fixture-salt')
    .digest('hex'),
  s: 'fixture-salt',
};
export const browserHeaders = {
  origin,
  'x-musiclatte-client': 'web',
  'content-type': 'application/json',
};
export interface AuthOptions {
  sessions: Awaited<ReturnType<typeof storageContext>>['sessions'];
  instances: Awaited<ReturnType<typeof storageContext>>['instances'];
  playlistOperations: Awaited<ReturnType<typeof storageContext>>['playlistOperations'];
  signingKey: Uint8Array;
  origin: string;
  upstream: string;
  timeoutMs: number;
  secureCookies: boolean;
  allowScan: boolean;
}

function mediaRange(value: string | undefined, length: number) {
  if (!value) return { status: 200, start: 0, end: length - 1 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return { status: 416, start: 0, end: -1 };
  const suffix = !match[1] && match[2] ? Number(match[2]) : undefined;
  const start = suffix === undefined ? Number(match[1]) : Math.max(0, length - suffix);
  const end =
    match[2] && suffix === undefined ? Math.min(Number(match[2]), length - 1) : length - 1;
  return start >= length || start > end
    ? { status: 416, start: 0, end: -1 }
    : { status: 206, start, end };
}

export async function createTestContext(overrides: Partial<AuthOptions> = {}) {
  const storage = await storageContext();
  const state = {
    adminRole: false as unknown,
    username: password.username,
    status: 200,
    error: 0,
    randomStatus: 200,
    randomError: 0,
    redirect: '',
    stall: false,
    scanError: 0,
    libraryError: 0,
    emptyLibrary: false,
    libraryStall: false,
    malformedLibrary: false,
    closedLibraryRequests: 0,
    collectionError: 0,
    emptyCollections: false,
    malformedCollections: false,
    collectionStall: false,
    collectionDelayMs: 0,
    closedCollectionRequests: 0,
    playlistOwner: password.username,
    playlistExists: true,
    playlistId: 'pl-1',
    playlistPublic: false,
    playlistName: 'Synthetic List',
    playlistChanged: '2026-09-05T02:03:04Z',
    playlistEntryIds: ['tr-A', 'tr-B', 'tr-A'],
    playlistCoverArt: 'cover-A',
    mutationError: 0,
    mutationDelayMs: 0,
    mutationResponseLoss: false,
    mutationMismatch: false,
    mediaStatus: 0,
    mediaContentType: '',
    mediaRedirect: '',
    mediaStallHeaders: false,
    mediaStallAfterFirstChunk: false,
    closedMediaRequests: 0,
  };
  const requests: URL[] = [];
  const mediaRequests: {
    url: URL;
    method: string;
    range?: string;
    ifNoneMatch?: string;
    ifModifiedSince?: string;
    ifRange?: string;
  }[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    requests.push(url);
    if (state.stall) return;
    if (state.redirect) {
      res.writeHead(302, { location: state.redirect });
      res.end();
      return;
    }
    const operation = url.pathname.slice('/rest/'.length);
    const isMedia = operation === 'stream' || operation === 'getCoverArt';
    const isRandom = operation === 'getRandomSongs';
    const isCollection = [
      'getPlaylists',
      'getPlaylist',
      'createPlaylist',
      'updatePlaylist',
      'deletePlaylist',
    ].includes(operation);
    const isCollectionRead = operation === 'getPlaylists' || operation === 'getPlaylist';
    const isCollectionWrite = ['createPlaylist', 'updatePlaylist', 'deletePlaylist'].includes(
      operation,
    );
    const isLibrary = [
      'getMusicFolders',
      'getIndexes',
      'getMusicDirectory',
      'search3',
      'getArtist',
      'getAlbum',
      'getRandomSongs',
    ].includes(operation);
    if (isLibrary && state.libraryStall) {
      res.on('close', () => {
        state.closedLibraryRequests += 1;
      });
      return;
    }
    if (isCollectionRead && state.collectionStall) {
      res.on('close', () => {
        state.closedCollectionRequests += 1;
      });
      return;
    }
    const valid =
      url.searchParams.get('t') ===
      createHash('md5')
        .update(password.password + url.searchParams.get('s'))
        .digest('hex');
    if (valid && operation === 'getPlaylist' && !state.playlistExists) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(subsonicErrorFixture(70, 'synthetic-secret-upstream-message')));
      return;
    }
    if (valid && isCollectionWrite && !state.mutationError) {
      const nextIds = url.searchParams.getAll('songId');
      if (!state.mutationMismatch) {
        if (operation === 'createPlaylist') {
          state.playlistExists = true;
          state.playlistId = url.searchParams.get('playlistId') ?? 'pl-created';
          state.playlistName = url.searchParams.get('name') ?? state.playlistName;
          state.playlistEntryIds = nextIds;
        } else if (operation === 'updatePlaylist') {
          state.playlistName = url.searchParams.get('name') ?? state.playlistName;
          state.playlistEntryIds.push(...url.searchParams.getAll('songIdToAdd'));
        } else {
          state.playlistExists = false;
        }
        state.playlistChanged = new Date(Date.parse(state.playlistChanged) + 1000).toISOString();
      }
      if (state.mutationResponseLoss) {
        state.mutationResponseLoss = false;
        req.socket.destroy();
        return;
      }
    }
    if (isMedia) {
      mediaRequests.push({
        url,
        method: req.method ?? '',
        ...(req.headers.range ? { range: req.headers.range } : {}),
        ...(req.headers['if-none-match'] ? { ifNoneMatch: req.headers['if-none-match'] } : {}),
        ...(req.headers['if-modified-since']
          ? { ifModifiedSince: req.headers['if-modified-since'] }
          : {}),
        ...(typeof req.headers['if-range'] === 'string'
          ? { ifRange: req.headers['if-range'] }
          : {}),
      });
      res.on('close', () => {
        if (!res.writableFinished) state.closedMediaRequests += 1;
      });
      if (state.mediaStallHeaders) return;
      if (state.mediaRedirect) {
        res.writeHead(302, { location: state.mediaRedirect });
        res.end('synthetic-secret-media-redirect');
        return;
      }
      if (!valid || state.mediaStatus) {
        const status = valid ? state.mediaStatus : 401;
        res.writeHead(status, {
          'content-type': state.mediaContentType || 'text/html',
          location: 'https://synthetic-secret.example.test/login',
        });
        res.end('<html>synthetic-secret-media-error</html>');
        return;
      }
      const body = operation === 'stream' ? syntheticAudioFixture : syntheticCoverFixture;
      const contentType =
        state.mediaContentType ||
        (operation === 'stream'
          ? syntheticMediaMetadata.audioContentType
          : syntheticMediaMetadata.coverContentType);
      if (req.headers['if-none-match'] === syntheticMediaMetadata.etag) {
        res.writeHead(304, {
          etag: syntheticMediaMetadata.etag,
          'cache-control': 'private, max-age=60',
        });
        res.end();
        return;
      }
      const selected = mediaRange(req.headers.range, body.length);
      if (selected.status === 416) {
        res.writeHead(416, {
          'content-range': `bytes */${body.length}`,
          'accept-ranges': 'bytes',
          etag: syntheticMediaMetadata.etag,
        });
        res.end();
        return;
      }
      const payload = body.subarray(selected.start, selected.end + 1);
      res.writeHead(selected.status, {
        'content-type': contentType,
        'content-length': String(payload.length),
        ...(selected.status === 206
          ? { 'content-range': `bytes ${selected.start}-${selected.end}/${body.length}` }
          : {}),
        'accept-ranges': 'bytes',
        etag: syntheticMediaMetadata.etag,
        'last-modified': syntheticMediaMetadata.lastModified,
        'cache-control': 'private, max-age=60',
        'x-synthetic-secret': 'must-not-pass',
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      if (state.mediaStallAfterFirstChunk) {
        res.write(payload.subarray(0, Math.min(128, payload.length)));
        return;
      }
      res.end(payload);
      return;
    }
    res.writeHead(isRandom ? state.randomStatus : state.status, {
      'content-type': 'application/json',
    });
    const code =
      isCollectionRead && state.collectionError
        ? state.collectionError
        : isCollectionWrite && state.mutationError
          ? state.mutationError
          : isLibrary && state.libraryError
            ? state.libraryError
            : !valid
              ? 40
              : state.error ||
                (isRandom ? state.randomError : operation === 'startScan' ? state.scanError : 0);
    const body = code
      ? subsonicErrorFixture(code, 'synthetic-secret-upstream-message')
      : operation === 'getUser'
        ? {
            'subsonic-response': {
              status: 'ok',
              version: '1.15.0',
              user: { username: state.username, adminRole: state.adminRole, folder: [999] },
            },
          }
        : operation === 'startScan'
          ? {
              'subsonic-response': {
                status: 'ok',
                version: '1.15.0',
                scanStatus: { scanning: true, count: 0 },
              },
            }
          : isCollection
            ? collectionFixture(operation, {
                empty:
                  state.emptyCollections || (operation === 'getPlaylists' && !state.playlistExists),
                id: state.playlistId,
                owner: state.playlistOwner,
                public: state.playlistPublic,
                name: state.playlistName,
                changed: state.playlistChanged,
                entryIds: state.playlistEntryIds,
                coverArt: state.playlistCoverArt,
              })
            : subsonicFixture(operation, state.emptyLibrary);
    const payload = JSON.stringify(
      (isLibrary && state.malformedLibrary) || (isCollection && state.malformedCollections)
        ? { 'subsonic-response': { status: 'ok', version: '1.15.0' } }
        : body,
    );
    const delayMs = isCollectionWrite ? state.mutationDelayMs : state.collectionDelayMs;
    if (isCollection && delayMs > 0) {
      setTimeout(() => res.end(payload), delayMs);
      return;
    }
    res.end(payload);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture bind failed');
  const options: AuthOptions = {
    sessions: storage.sessions,
    instances: storage.instances,
    playlistOperations: storage.playlistOperations,
    signingKey: new Uint8Array(32).fill(7),
    origin,
    upstream: `http://127.0.0.1:${address.port}`,
    timeoutMs: 300,
    secureCookies: true,
    allowScan: false,
    ...overrides,
  };
  const factory: (options?: AuthOptions) => FastifyInstance = createApp;
  const app = factory(options);
  return {
    app,
    options,
    state,
    requests,
    mediaRequests,
    storage,
    login: (headers: Record<string, string> = browserHeaders, payload: object = password) =>
      app.inject({ method: 'POST', url: '/api/v1/session', headers, payload }),
    async cleanup() {
      await app.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      storage.cleanup();
    },
  };
}
export function cookieOf(response: { headers: Record<string, unknown> }): string {
  return String(response.headers['set-cookie'] ?? '').split(';')[0]!;
}
