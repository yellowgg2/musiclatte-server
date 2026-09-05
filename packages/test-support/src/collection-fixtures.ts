import type { SubsonicEnvelope } from '@musiclatte/contracts';

/** Synthetic gonic v0.22.0 playlist and song-star payloads with no user data. */
export function collectionFixture(operation: string, empty = false): SubsonicEnvelope {
  const song = {
    id: 'tr-A',
    title: 'Synthetic A',
    isDir: false,
    starred: '2026-09-05T02:03:04Z',
  };
  const playlist = {
    id: 'pl-1',
    name: 'Synthetic List',
    owner: 'fixture-listener',
    songCount: empty ? 0 : 3,
    created: '2026-09-05T01:02:03Z',
    changed: '2026-09-05T02:03:04Z',
    duration: empty ? 0 : 360,
    public: false,
    ...(operation === 'getPlaylists'
      ? {}
      : { entry: empty ? undefined : [song, { ...song, id: 'tr-B' }, song] }),
  };
  const payloads: Record<string, Record<string, unknown>> = {
    getPlaylists: { playlists: { playlist: empty ? undefined : [playlist] } },
    getPlaylist: { playlist },
    createPlaylist: { playlist },
    updatePlaylist: {},
    deletePlaylist: {},
    getStarred2: { starred2: { song: empty ? undefined : [song] } },
    star: {},
    unstar: {},
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
