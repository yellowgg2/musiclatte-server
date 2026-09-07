import type { SubsonicEnvelope } from '@musiclatte/contracts';
/** Entirely synthetic values shaped from gonic v0.22.0 handlers/spec, not captured user data. */
export function subsonicFixture(operation: string, empty = false): SubsonicEnvelope {
  const song = {
    id: 'tr-1',
    parent: 'al-1',
    title: '가을 & Café + 100%',
    isDir: false,
    artist: 'Synthetic Artist',
    album: 'Mixed Tags',
    duration: 120,
    contentType: 'audio/mpeg',
  };
  const album = {
    id: 'al-1',
    name: 'Synthetic Album',
    artist: 'Synthetic Artist',
    artistId: 'ar-1',
    songCount: 1,
    song: empty ? undefined : [song],
  };
  const artist = {
    id: 'ar-1',
    name: 'Synthetic Artist',
    albumCount: 1,
    album: empty ? undefined : [album],
  };
  const payloads: Record<string, Record<string, unknown>> = {
    ping: {},
    getScanStatus: { scanStatus: { scanning: false, count: 1 } },
    getSong: { song },
    getUser: { user: { username: 'fixture-listener', adminRole: false, folder: [1] } },
    getMusicFolders: {
      musicFolders: { musicFolder: empty ? null : [{ id: 0, name: 'Synthetic Music' }] },
    },
    getIndexes: {
      indexes: {
        lastModified: 0,
        ignoredArticles: '',
        index: empty ? null : [{ name: 'S', artist: [artist] }],
      },
    },
    getMusicDirectory: {
      directory: {
        id: 'al-1',
        name: 'Synthetic Directory',
        ...(empty ? {} : { child: [{ id: 'al-2', title: 'Nested', isDir: true }, song] }),
      },
    },
    search3: { searchResult3: empty ? {} : { artist: [artist], album: [album], song: [song] } },
    getArtist: { artist },
    getAlbum: { album },
    getRandomSongs: { randomSongs: { song: empty ? [] : [song] } },
  };
  return {
    'subsonic-response': {
      status: 'ok',
      version: '1.15.0',
      type: 'gonic',
      serverVersion: '0.22.0',
      ...payloads[operation],
    },
  };
}
export function subsonicErrorFixture(
  code: number,
  message = 'synthetic upstream error',
): SubsonicEnvelope {
  return { 'subsonic-response': { status: 'failed', version: '1.15.0', error: { code, message } } };
}

export interface RegistrationFixture {
  statuses: Array<{ scanning: boolean; count: number }>;
  directories: Record<string, Array<Record<string, unknown>>>;
  roots: Array<{ id: string; name: string }>;
  scanError?: number;
  directoryReads?: Record<string, number>;
  visibleAfter?: number;
}
/** Stateful source-shaped scan and narrow folder traversal, using synthetic data only. */
export function registrationFixture(operation: string, url: URL, state: RegistrationFixture) {
  let payload: Record<string, unknown>;
  if (operation === 'startScan' && state.scanError) return subsonicErrorFixture(state.scanError);
  if (operation === 'getScanStatus' || operation === 'startScan') {
    const status = state.statuses[0] ?? { scanning: false, count: 0 };
    if (operation === 'getScanStatus' && state.statuses.length > 1) state.statuses.shift();
    payload = { scanStatus: status };
  } else if (operation === 'getIndexes') {
    payload = { indexes: { lastModified: 0, index: [{ name: '#', artist: state.roots }] } };
  } else if (operation === 'getMusicDirectory') {
    const id = url.searchParams.get('id') ?? '';
    const reads = (state.directoryReads ??= {});
    reads[id] = (reads[id] ?? 0) + 1;
    payload = {
      directory: {
        id,
        name: id,
        child: (state.directories[id] ?? []).filter(
          (child) => child.isDir || reads[id]! > (state.visibleAfter ?? 0),
        ),
      },
    };
  } else if (operation === 'getSong') {
    const song = Object.values(state.directories)
      .flat()
      .find((child) => child.id === url.searchParams.get('id') && !child.isDir);
    if (!song) return subsonicErrorFixture(70);
    payload = { song };
  } else return subsonicFixture(operation);
  return { 'subsonic-response': { status: 'ok', version: '1.15.0', ...payload } };
}
