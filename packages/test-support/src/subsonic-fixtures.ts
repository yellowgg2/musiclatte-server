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
