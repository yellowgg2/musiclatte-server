import type {
  PlaylistDetail,
  PlaylistSummary,
  SubsonicPlaylist,
  SubsonicPlaylistSummary,
} from '@musiclatte/contracts';
import type { SessionService } from '../auth/session-service.js';

interface PlaylistIdentity {
  instanceId: string;
  username: string;
}

function revision(
  service: SessionService,
  identity: PlaylistIdentity,
  playlist: SubsonicPlaylistSummary,
  entryIds: string[] | null,
) {
  return service.sign(
    'playlist-revision',
    JSON.stringify([
      identity.instanceId,
      identity.username,
      playlist.id,
      playlist.name,
      playlist.changed,
      entryIds,
    ]),
  );
}

/** Project a list item without fetching its detail; this revision is informational only. */
export function playlistSummary(
  service: SessionService,
  identity: PlaylistIdentity,
  playlist: SubsonicPlaylistSummary,
): PlaylistSummary {
  return {
    id: playlist.id,
    name: playlist.name,
    owner: playlist.owner,
    songCount: playlist.songCount,
    created: playlist.created,
    changed: playlist.changed,
    duration: playlist.duration,
    public: playlist.public,
    editable: playlist.owner === identity.username,
    coverState: 'fallback',
    revision: revision(service, identity, playlist, null),
  };
}

/** Project the exact ordered mutation snapshot while preserving duplicate song occurrences. */
export function playlistDetail(
  service: SessionService,
  identity: PlaylistIdentity,
  playlist: SubsonicPlaylist,
): PlaylistDetail {
  const firstPlayable = playlist.entry.find((song) => !song.isDir);
  const coverArt = firstPlayable?.coverArt;
  return {
    ...playlistSummary(service, identity, playlist),
    coverState: coverArt ? 'available' : 'fallback',
    ...(coverArt ? { coverArt } : {}),
    revision: revision(
      service,
      identity,
      playlist,
      playlist.entry.map((song) => song.id),
    ),
    entries: playlist.entry.map((song, position) => ({ position, song })),
  };
}
