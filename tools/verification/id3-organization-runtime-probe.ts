import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import {
  decodeOrganizationCandidates,
  decodeOrganizationJobResponse,
  decodeOrganizationPreview,
} from '@musiclatte/contracts';
import {
  createAutomationHTTPClient,
  probeCheck as check,
  readAutomationProbeConfig,
} from './automation-http-client.js';

const redacted = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 12);
const execute = promisify(execFile);
async function audioHash(path: string) {
  const result = await execute(
    'ffmpeg',
    ['-v', 'error', '-i', path, '-map', '0:a:0', '-f', 'hash', '-hash', 'sha256', '-'],
    { timeout: 30000, maxBuffer: 65536 },
  );
  const match = /^SHA256=([a-f0-9]{64})$/m.exec(result.stdout);
  check(match, 'audio_hash');
  return match[1];
}

export async function runId3OrganizationRuntimeProbe(configPath: string) {
  const config = readAutomationProbeConfig(configPath);
  check(
    process.platform === 'linux' &&
      config.root &&
      config.musicRoot &&
      config.project &&
      /^musiclatte-p9-[a-z0-9-]+$/.test(config.project) &&
      typeof config.fixtureRelativeKey === 'string' &&
      config.fixtureRelativeKey.endsWith('.mp3') &&
      !config.fixtureRelativeKey.startsWith('/') &&
      !config.fixtureRelativeKey.split('/').some((part) => !part || part === '.' || part === '..'),
    'isolated_linux',
  );
  const root = realpathSync(config.root);
  const musicRoot = realpathSync(config.musicRoot);
  check(root.startsWith('/tmp/musiclatte-p9-'), 'owned_root');
  check(musicRoot !== '/', 'music_root');
  const owner = JSON.parse(readFileSync(join(root, 'owner.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  check(
    owner.project === config.project && owner.purpose === 'phase-9-id3-organization-probe',
    'owner',
  );
  const sourcePath = join(musicRoot, config.fixtureRelativeKey);
  const source = lstatSync(sourcePath);
  check(source.isFile() && !source.isSymbolicLink(), 'source');
  const originalAudio = await audioHash(sourcePath);
  const client = await createAutomationHTTPClient(config);
  let playlistId: string | undefined;
  let organizationStarted = false;
  let organizationSettled = false;
  try {
    const currentSong = (await (await client.upstream('getSong', { id: config.trackId! })).json())[
      'subsonic-response'
    ]?.song;
    check(typeof currentSong?.album === 'string' && currentSong.album.trim(), 'indexed_album');
    const initial = await client.json(
      '/tracks/' + encodeURIComponent(config.trackId!) + '/metadata',
      undefined,
      200,
      { token: false },
    );
    if (initial.values.album !== currentSong.album) {
      const projectionJob = await client.json(
        '/metadata-jobs',
        {
          operationId: randomUUID(),
          targets: [{ trackId: config.trackId, expectedRevision: initial.fileRevision }],
          patch: { album: { op: 'set', value: currentSong.album } },
          sourceReference: 'https://example.invalid/synthetic-projection-fixture',
          usageBasis: 'Synthetic verification fixture',
        },
        202,
        { token: false },
      );
      let projectionDone = false;
      for (let attempt = 0; attempt < 720; attempt++) {
        const state = await client.json('/metadata-jobs/' + projectionJob.job.id, undefined, 200, {
          token: false,
        });
        if (state.job.status === 'succeeded') {
          projectionDone = true;
          break;
        }
        check(!['failed', 'partial'].includes(state.job.status), 'album_projection');
        await delay(500);
      }
      check(projectionDone, 'album_projection_timeout');
    }
    const title = 'Reviewed isolated automation fixture ' + redacted(config.trackId!).slice(0, 8);
    const metadata = await client.workflow(title);
    check(config.coverPath, 'cover_fixture');
    const cover = await client.uploadJpeg(config.coverPath, config.libraryId);
    const coverClaim = await client.json('/curation-claims', {
      operationId: randomUUID(),
      purpose: 'optional_enrichment',
      fields: ['cover'],
      targets: [{ trackId: metadata.trackId, expectedRevision: metadata.revision }],
    });
    check(coverClaim.claimId && coverClaim.results[0]?.status === 'granted', 'cover_claim');
    const coverJob = await client.json(
      '/metadata-jobs',
      {
        operationId: randomUUID(),
        targets: [{ trackId: metadata.trackId, expectedRevision: metadata.revision }],
        patch: { cover: { op: 'replaceAll', uploadId: cover.uploadId } },
        automation: {
          claimId: coverClaim.claimId,
          claimGeneration: coverClaim.generation,
          purpose: 'optional_enrichment',
          sourceNotes: 'Synthetic official JPEG fixture',
        },
        dryRun: false,
        sourceReference: 'https://example.invalid/official-synthetic-fixture',
        usageBasis: 'Original synthetic verification artwork',
      },
      202,
    );
    const coverDone = await client.poll(coverJob.job.id);
    metadata.revision = coverDone.job!.items[0]!.resultRevision!;
    check(
      (
        await client.raw('/curation-claims/' + coverClaim.claimId, undefined, {
          method: 'DELETE',
        })
      ).status === 204,
      'cover_claim_release',
    );
    const candidates = decodeOrganizationCandidates(
      await client.json(
        '/metadata-organization/candidates?title=' + encodeURIComponent(title) + '&limit=2',
      ),
    );
    const exact = candidates.candidates.filter(
      (candidate) => candidate.trackId === metadata.trackId && candidate.title === title,
    );
    check(exact.length === 1, 'exact_candidate');
    check(
      typeof exact[0]!.importSourceId === 'string' &&
        /^[A-Za-z0-9_-]{11}$/.test(exact[0]!.importSourceId),
      'import_source',
    );
    const importSourceId = exact[0]!.importSourceId;
    const preview = decodeOrganizationPreview(
      await client.json('/metadata-organization/previews', {
        trackId: metadata.trackId,
        expectedRevision: metadata.revision,
        destinationPolicy: 'id3-managed-v1',
      }),
    );
    check(preview.status === 'ready' && preview.targetKey, 'organization_preview');

    check((await client.upstream('star', { id: metadata.trackId })).ok, 'star');
    const listName = 'musiclatte-p9-' + randomUUID();
    const songs = new URLSearchParams({ name: listName });
    songs.append('songId', metadata.trackId);
    songs.append('songId', metadata.trackId);
    const created = (await (await client.upstream('createPlaylist', songs)).json())[
      'subsonic-response'
    ];
    playlistId = created.playlist.id;
    check(typeof playlistId === 'string', 'playlist');

    const body = {
      operationId: randomUUID(),
      trackId: metadata.trackId,
      expectedRevision: metadata.revision,
      destinationPolicy: 'id3-managed-v1' as const,
      metadataJobId: coverDone.job!.id,
      sourceEvidence: [
        {
          url: 'https://example.invalid/official-synthetic-fixture',
          kind: 'official_artist' as const,
          fields: ['cover' as const],
        },
      ],
    };
    const submitted = decodeOrganizationJobResponse(
      await client.json('/metadata-organization-jobs', body, 202),
    );
    organizationStarted = true;
    check(
      decodeOrganizationJobResponse(await client.json('/metadata-organization-jobs', body, 202)).job
        .id === submitted.job.id,
      'organization_replay',
    );
    let job = submitted.job;
    const retriedOwners = new Set<string>();
    for (let attempt = 0; attempt < 1200; attempt++) {
      job = decodeOrganizationJobResponse(
        await client.json('/metadata-organization-jobs/' + job.id),
      ).job;
      if (job.stage === 'succeeded') break;
      check(!['failed', 'conflict'].includes(job.stage), 'organization_job');
      if (job.stage === 'recovery_required') {
        check(job.nextOwner, 'organization_recovery');
        if (!retriedOwners.has(job.nextOwner)) {
          await client.json(
            '/metadata-organization-jobs/' + job.id + '/retries',
            { operationId: randomUUID() },
            202,
          );
          retriedOwners.add(job.nextOwner);
        }
      }
      await delay(500);
    }
    check(job.stage === 'succeeded' && job.newTrackId, 'organization_timeout');
    organizationSettled = true;
    const targetPath = join(musicRoot, preview.targetKey);
    const target = lstatSync(targetPath);
    check(target.isFile() && !target.isSymbolicLink(), 'target');
    try {
      lstatSync(sourcePath);
      check(false, 'old_path_present');
    } catch (error) {
      check((error as NodeJS.ErrnoException).code === 'ENOENT', 'old_path_present');
    }

    const song = await (await client.upstream('getSong', { id: job.newTrackId })).json();
    const indexed = song['subsonic-response']?.song;
    check(
      indexed?.id === job.newTrackId &&
        indexed?.title === title &&
        indexed?.path === preview.targetKey,
      'new_binding',
    );
    const playlist = await (await client.upstream('getPlaylist', { id: playlistId })).json();
    const entries = playlist['subsonic-response']?.playlist?.entry ?? [];
    check(
      entries.length === 2 && entries.every((entry: { id: string }) => entry.id === job.newTrackId),
      'playlist_migration',
    );
    const starred = await (await client.upstream('getStarred2')).json();
    const starredSongs = starred['subsonic-response']?.starred2?.song ?? [];
    check(
      starredSongs.some((entry: { id: string }) => entry.id === job.newTrackId) &&
        !starredSongs.some((entry: { id: string }) => entry.id === metadata.trackId),
      'star_migration',
    );

    const inspect = await client.json(
      '/tracks/' + encodeURIComponent(job.newTrackId) + '/metadata',
    );
    check(
      inspect.format === 'mp3' &&
        inspect.values.title === title &&
        inspect.coverFrames.length === 1 &&
        inspect.coverFrames[0].mimeType === 'image/jpeg' &&
        readFileSync(targetPath)
          .subarray(0, 4)
          .equals(Buffer.from([0x49, 0x44, 0x33, 0x03])),
      'id3',
    );
    check((await audioHash(targetPath)) === originalAudio, 'audio_preserved');
    const afterScan = await client.upstream('startScan');
    check(afterScan.ok, 'rescan');
    const reimport = await client.json(
      '/imports',
      {
        operationId: randomUUID(),
        libraryId: config.libraryId,
        urls: ['https://www.youtube.com/watch?v=' + importSourceId],
      },
      202,
      { token: false },
    );
    let reimportItem = reimport.job.items[0];
    const importPollAttempts = 720;
    for (let attempt = 0; attempt < importPollAttempts; attempt++) {
      const detail = await client.json('/imports/' + reimport.job.id, undefined, 200, {
        token: false,
      });
      reimportItem = detail.job.items[0];
      if (['duplicate', 'ready', 'failed'].includes(reimportItem.stage)) break;
      await delay(500);
    }
    check(reimportItem.stage === 'duplicate', 'managed_reimport');
    await delay(2000);
    const after = decodeOrganizationCandidates(
      await client.json(
        '/metadata-organization/candidates?title=' + encodeURIComponent(title) + '&limit=2',
      ),
    );
    check(
      after.candidates.filter((candidate) => candidate.title === title).length === 1,
      'no_duplicate',
    );
    return {
      schemaVersion: 1,
      status: 'succeeded',
      checks: {
        singleJpeg: true,
        oldPathAbsent: true,
        managedPath: true,
        playlistOccurrences: 2,
        starMigrated: true,
        duplicateCount: 1,
      },
      ids: { old: redacted(metadata.trackId), next: redacted(job.newTrackId) },
    };
  } finally {
    if (playlistId && (!organizationStarted || organizationSettled))
      await client.upstream('deletePlaylist', { id: playlistId }).catch(() => {});
    await client.revoke().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = process.argv[process.argv.indexOf('--config') + 1];
    check(config, 'private_config');
    process.stdout.write(JSON.stringify(await runId3OrganizationRuntimeProbe(config)) + '\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    process.stderr.write(
      /^probe_failed:[a-z0-9_]+$/.test(message) ? message + '\n' : 'probe_failed:runtime\n',
    );
    process.exitCode = 1;
  }
}
