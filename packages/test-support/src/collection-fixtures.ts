import type { SubsonicEnvelope } from '@musiclatte/contracts';

export interface CollectionFixtureOptions {
  empty?: boolean;
  id?: string;
  owner?: string;
  public?: boolean;
  name?: string;
  changed?: string;
  entryIds?: string[];
  coverArt?: string;
}

/** Synthetic gonic v0.22.0 playlist and song-star payloads with no user data. */
export function collectionFixture(
  operation: string,
  input: boolean | CollectionFixtureOptions = false,
): SubsonicEnvelope {
  const options = typeof input === 'boolean' ? { empty: input } : input;
  const empty = options.empty ?? false;
  const entryIds = empty ? [] : (options.entryIds ?? ['tr-A', 'tr-B', 'tr-A']);
  const songs = entryIds.map((id, position) => ({
    id,
    title: `Synthetic ${id.slice(-1)}`,
    isDir: false,
    starred: '2026-09-05T02:03:04Z',
    ...(position === 0 && options.coverArt ? { coverArt: options.coverArt } : {}),
  }));
  const playlist = {
    id: options.id ?? 'pl-1',
    name: options.name ?? 'Synthetic List',
    owner: options.owner ?? 'fixture-listener',
    songCount: entryIds.length,
    created: '2026-09-05T01:02:03Z',
    changed: options.changed ?? '2026-09-05T02:03:04Z',
    duration: entryIds.length * 120,
    public: options.public ?? false,
    ...(operation === 'getPlaylists' ? {} : { entry: empty ? undefined : songs }),
  };
  const payloads: Record<string, Record<string, unknown>> = {
    getPlaylists: { playlists: { playlist: empty ? undefined : [playlist] } },
    getPlaylist: { playlist },
    createPlaylist: { playlist },
    updatePlaylist: {},
    deletePlaylist: {},
    getStarred2: { starred2: { song: empty ? undefined : songs.slice(0, 1) } },
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
