import { createHash, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { decodeOrganizationSelection } from '@musiclatte/contracts';
import {
  createAutomationHTTPClient,
  probeCheck as check,
  readAutomationProbeConfig,
} from './automation-http-client.js';

const redacted = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 12);

export async function runId3CollectionRuntimeProbe(configPath: string) {
  const config = readAutomationProbeConfig(configPath);
  check(
    process.platform === 'linux' &&
      config.root &&
      config.project &&
      /^musiclatte-p10-[a-z0-9-]+$/.test(config.project),
    'isolated_linux',
  );
  const root = realpathSync(config.root);
  check(root.startsWith('/tmp/musiclatte-p10-'), 'owned_root');
  const client = await createAutomationHTTPClient(config);
  let playlistId: string | undefined;
  let addedStar: string | undefined;
  try {
    await client.issue(['metadata:read', 'collections:read']);
    const starred = await (await client.upstream('getStarred2')).json();
    const existingStars = new Set<string>(
      (starred['subsonic-response']?.starred2?.song ?? []).map((song: { id: string }) => song.id),
    );
    await client.upstream('startScan');
    let songs: Array<{ id: string }> = [];
    for (let attempt = 0; attempt < 300 && songs.length < 2; attempt++) {
      const random = await (await client.upstream('getRandomSongs', { size: '50' })).json();
      songs = random['subsonic-response']?.randomSongs?.song ?? [];
      if (songs.length < 2) await delay(1000);
    }
    const first = songs.find((song) => !existingStars.has(song.id));
    const second = songs.find((song) => song.id !== first?.id);
    check(first && second, 'selection_fixture');
    check((await client.upstream('star', { id: first.id })).ok, 'star');
    addedStar = first.id;

    const list = new URLSearchParams({ name: 'musiclatte-p10-' + randomUUID() });
    list.append('songId', first.id);
    list.append('songId', second.id);
    list.append('songId', first.id);
    const created = await (await client.upstream('createPlaylist', list)).json();
    playlistId = created['subsonic-response']?.playlist?.id;
    check(playlistId, 'playlist');

    const playlist = decodeOrganizationSelection(
      await client.json('/metadata-organization/selections', {
        source: { kind: 'playlist', playlistId },
      }),
    );
    check(
      playlist.occurrenceCount === 3 &&
        playlist.uniqueTrackCount === 2 &&
        playlist.items[0]?.trackId === first.id &&
        playlist.items[0]?.occurrenceIndexes.join(',') === '0,2' &&
        playlist.items[1]?.trackId === second.id,
      'playlist_selection',
    );
    const favorites = decodeOrganizationSelection(
      await client.json('/metadata-organization/selections', {
        source: { kind: 'favorites' },
      }),
    );
    check(
      favorites.items.some((item) => item.trackId === first.id) &&
        favorites.items.every((item) => item.occurrenceIndexes.length === 1),
      'favorites_selection',
    );

    return {
      schemaVersion: 1,
      status: 'succeeded',
      checks: {
        favoritesFrozen: true,
        ownedPlaylistFrozen: true,
        occurrenceCount: playlist.occurrenceCount,
        uniqueTrackCount: playlist.uniqueTrackCount,
        duplicateOccurrenceCount: playlist.occurrenceCount - playlist.uniqueTrackCount,
      },
      ids: { first: redacted(first.id), second: redacted(second.id) },
    };
  } finally {
    if (playlistId) await client.upstream('deletePlaylist', { id: playlistId }).catch(() => {});
    if (addedStar) await client.upstream('unstar', { id: addedStar }).catch(() => {});
    await client.revoke().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = process.argv[2];
  if (!config) throw new Error('probe_failed:config');
  runId3CollectionRuntimeProbe(config)
    .then((result) => process.stdout.write(JSON.stringify(result) + '\n'))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : '';
      process.stderr.write(
        /^probe_failed:[a-z0-9_]+$/.test(message) ? message + '\n' : 'probe_failed:runtime\n',
      );
      process.exitCode = 1;
    });
}
