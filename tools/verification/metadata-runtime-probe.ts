import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { MetadataJob } from '../../packages/contracts/src/metadata.js';

const configPath = process.argv[process.argv.indexOf('--config') + 1];
if (!configPath || !isAbsolute(configPath)) throw new Error('private_config_required');
const c = JSON.parse(readFileSync(configPath, 'utf8')) as {
  root: string;
  api: string;
  upstream: string;
  origin: string;
  project: string;
  username: string;
  password: string;
  combined?: boolean;
};
if (
  process.platform !== 'linux' ||
  !isAbsolute(c.root) ||
  !c.root.includes('musiclatte-p4-') ||
  !/^musiclatte-p4-[a-z0-9-]+$/.test(c.project)
)
  throw new Error('isolated_linux_probe_required');
const check = (condition: unknown, stage: string) => {
  if (!condition) throw new Error(`probe_failed:${stage}`);
};
const docker = (...args: string[]) =>
  execFileSync('docker', args, {
    cwd: join(c.root, 'repo'),
    timeout: 180000,
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString();
const compose = (...args: string[]) =>
  docker(
    'compose',
    '--env-file',
    join(c.root, 'private/compose.env'),
    '-f',
    'compose.yaml',
    '-f',
    'deploy/compose.metadata.yaml',
    '-f',
    join(c.root, 'private/runtime.yaml'),
    ...args,
  );
const worker = `${c.project}-metadata-worker-1`;
let phase = 'startup';
const headers: Record<string, string> = {
  origin: c.origin,
  'x-musiclatte-client': 'web',
  'content-type': 'application/json',
};
async function api(path: string, body?: unknown, expected = 200) {
  const response = await fetch(c.api + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
  check(response.status === expected, `http_${expected}_${response.status}`);
  return response;
}
async function json(path: string, body?: unknown, expected = 200) {
  return (await api(path, body, expected)).json();
}
const salt = randomUUID();
async function upstream(method: string, params: Record<string, string> = {}) {
  const url = new URL(`/rest/${method}.view`, c.upstream);
  url.search = new URLSearchParams({
    u: c.username,
    t: createHash('md5')
      .update(c.password + salt)
      .digest('hex'),
    s: salt,
    c: 'musiclatte-private-probe',
    v: '1.16.1',
    f: 'json',
    ...params,
  }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const body = (await response.json())['subsonic-response'];
  check(response.ok && body.status === 'ok', 'upstream_request');
  return body;
}
async function healthy(container = worker) {
  for (let i = 0; i < 120; i++) {
    if (docker('inspect', '--format', '{{.State.Health.Status}}', container).trim() === 'healthy')
      return;
    await delay(1000);
  }
  throw new Error('probe_failed:worker_health');
}
async function matchingSnapshot() {
  phase = 'snapshot_stop';
  compose('stop', 'metadata-worker');
  const suffix = randomUUID();
  const volumes = ['management', 'keys', 'data', 'uploads'].map(
    (kind) => `${c.project}-restore-${kind}-${suffix}`,
  );
  const mountPoints = ['/management', '/keys', '/metadata-data', '/metadata-uploads'];
  const restoreWorker = `${c.project}-restore-${suffix}`;
  const image = 'musiclatte-p4-s07-worker:20260908';
  const config = [
    '-e',
    'METADATA_ENABLED=true',
    '-e',
    'MANAGEMENT_DIRECTORY=/management',
    '-e',
    'CREDENTIAL_KEY_PATH=/keys/credential.key',
    '-e',
    'METADATA_MUSIC_ROOT=/music',
    '-e',
    'METADATA_DATA_ROOT=/metadata-data',
    '-e',
    'METADATA_UPLOAD_ROOT=/metadata-uploads',
    '-e',
    'METADATA_POLICY_PATH=/policy.json',
    '-e',
    'METADATA_PYTHON=/opt/metadata-python/bin/python',
    '-e',
    'METADATA_HELPER_PATH=/app/apps/api/helpers/metadata.py',
    '-v',
    `${c.root}/music:/music`,
    '-v',
    `${c.root}/private/metadata-policy.json:/policy.json:ro`,
  ];
  const live = ['management-data', 'management-keys', 'metadata-data', 'metadata-uploads'].flatMap(
    (name, i) => ['-v', `${c.project}_${name}:${mountPoints[i]}`],
  );
  const snapshotName = `snapshot-${suffix}`;
  try {
    phase = 'snapshot_create';
    docker(
      'run',
      '--rm',
      '--network',
      'none',
      ...config,
      ...live,
      '-v',
      `${c.root}/private:/snapshots`,
      image,
      'node',
      'apps/api/dist/metadata-backup-entry.js',
      'create',
      `/snapshots/${snapshotName}`,
    );
    phase = 'snapshot_volumes';
    for (const volume of volumes) docker('volume', 'create', volume);
    const targets = volumes.flatMap((name, i) => ['-v', `${name}:${mountPoints[i]}`]);
    phase = 'snapshot_initialize';
    docker(
      'run',
      '--rm',
      '--network',
      'none',
      '--user',
      '0:0',
      ...targets,
      image,
      'node',
      '-e',
      `const fs=require('node:fs');for(const p of ${JSON.stringify(mountPoints)}){if(fs.readdirSync(p).length)process.exit(1);fs.chownSync(p,1000,1000);fs.chmodSync(p,448);}`,
    );
    phase = 'snapshot_restore';
    docker(
      'run',
      '--rm',
      '--network',
      'none',
      ...config,
      ...targets,
      '-v',
      `${c.root}/private:/snapshots:ro`,
      image,
      'node',
      'apps/api/dist/metadata-backup-entry.js',
      'restore',
      `/snapshots/${snapshotName}`,
    );
    phase = 'snapshot_worker';
    docker(
      'run',
      '-d',
      '--name',
      restoreWorker,
      '--network',
      `${c.project}_default`,
      ...config,
      ...targets,
      '-v',
      `${c.root}/private/metadata-worker.json:/credential.json:ro`,
      '-e',
      'GONIC_UPSTREAM=http://gonic:80',
      '-e',
      'METADATA_CREDENTIAL_PATH=/credential.json',
      '-e',
      'METADATA_FFMPEG=/usr/bin/ffmpeg',
      '-e',
      'METADATA_FFPROBE=/usr/bin/ffprobe',
      '-e',
      'METADATA_COVER_PROJECTOR=/opt/metadata/cover-projection',
      '-e',
      'METADATA_WRITE_PROFILE=posix-exclusive-mp3-id3v23-v24-v1',
      '--health-cmd',
      'node apps/api/dist/metadata-worker-entry.js --healthcheck',
      '--health-interval',
      '2s',
      image,
    );
    await healthy(restoreWorker);
    docker('stop', '--time', '75', restoreWorker);
  } finally {
    try {
      docker('rm', '-f', restoreWorker);
    } catch {
      /* May fail before creation. */
    }
    for (const volume of volumes) {
      try {
        docker('volume', 'rm', volume);
      } catch {
        /* Only owned names. */
      }
    }
    compose('start', 'metadata-worker');
  }
  await healthy();
}
async function completed(id: string) {
  for (let i = 0; i < 180; i++) {
    const job: MetadataJob = (await json(`/api/v1/metadata-jobs/${id}`)).job;
    if (job.items.every((item) => item.stage === 'succeeded')) return job;
    check(
      !job.items.some((item) => ['failed', 'conflict', 'recovery_required'].includes(item.stage)),
      'job_terminal_failure',
    );
    await delay(1000);
  }
  throw new Error('probe_failed:reflection_timeout');
}
async function crashRecovery(trackId: string) {
  phase = 'crash_recovery';
  const snapshot = await json(`/api/v1/tracks/${encodeURIComponent(trackId)}/metadata`);
  docker('update', '--restart=no', worker);
  try {
    const submitted = await json(
      '/api/v1/metadata-jobs',
      {
        operationId: randomUUID(),
        targets: [{ trackId, expectedRevision: snapshot.fileRevision }],
        patch: { title: { op: 'set', value: `Crash recovery ${randomUUID()}` } },
      },
      202,
    );
    let interrupted = false;
    for (let i = 0; i < 200; i++) {
      const job: MetadataJob = (await json(`/api/v1/metadata-jobs/${submitted.job.id}`)).job;
      if (job.items.some((item) => ['preparing', 'backed_up', 'prepared'].includes(item.stage))) {
        docker('kill', '--signal=KILL', worker);
        interrupted = true;
        break;
      }
      check(
        job.items.every((item) => item.stage === 'queued'),
        'crash_boundary_missed',
      );
      await delay(20);
    }
    check(interrupted, 'crash_boundary_observed');
    await delay(31000);
    compose('start', 'metadata-worker');
    await healthy();
    let recovered: MetadataJob | undefined;
    for (let i = 0; i < 120; i++) {
      const job: MetadataJob = (await json(`/api/v1/metadata-jobs/${submitted.job.id}`)).job;
      if (job.items.every((item) => ['failed', 'succeeded'].includes(item.stage))) {
        recovered = job;
        break;
      }
      check(
        !job.items.some((item) => ['conflict', 'recovery_required'].includes(item.stage)),
        'crash_ambiguous',
      );
      await delay(1000);
    }
    check(recovered, 'crash_recovered');
    if (recovered!.items[0]!.stage === 'failed') {
      const current = await json(`/api/v1/tracks/${encodeURIComponent(trackId)}/metadata`);
      const retried = await json(
        `/api/v1/metadata-jobs/${recovered!.id}/retries`,
        {
          operationId: randomUUID(),
          items: [{ itemId: recovered!.items[0]!.itemId, expectedRevision: current.fileRevision }],
        },
        202,
      );
      await completed(retried.job.id);
    }
  } finally {
    docker('update', '--restart=unless-stopped', worker);
    compose('start', 'metadata-worker');
  }
}
async function combinedCoordinator(trackId: string) {
  phase = 'combined_coordinator';
  await healthy(`${c.project}-worker-1`);
  const coordinator = (release: boolean) =>
    docker(
      'exec',
      `${c.project}-api-1`,
      'node',
      '--input-type=module',
      '-e',
      `
    import {openDatabase} from './apps/api/dist/storage/database.js';
    import {createScanCoordinator} from './apps/api/dist/subsonic/scan-coordinator.js';
    const database=openDatabase('/management');
    try { const scan=createScanCoordinator({database,clock:Date.now,timeoutMs:60000,retryMs:0});
      ${release ? "scan.release('musiclatte-import-probe',false);" : "if(!scan.acquire('musiclatte-import-probe'))process.exitCode=1;"}
    } finally { database.close(); }
  `,
    );
  const snapshot = await json(`/api/v1/tracks/${encodeURIComponent(trackId)}/metadata`);
  const before = (await upstream('getSong', { id: trackId })).song.title;
  let job: MetadataJob;
  coordinator(false);
  try {
    job = (
      await json(
        '/api/v1/metadata-jobs',
        {
          operationId: randomUUID(),
          targets: [{ trackId, expectedRevision: snapshot.fileRevision }],
          patch: { title: { op: 'set', value: `Combined ${randomUUID()}` } },
        },
        202,
      )
    ).job;
    let deferred = false;
    for (let i = 0; i < 100; i++) {
      const current: MetadataJob = (await json(`/api/v1/metadata-jobs/${job.id}`)).job;
      if (current.items[0]!.stage === 'reflecting') {
        deferred = true;
        break;
      }
      check(
        !current.items.some((item) =>
          ['succeeded', 'failed', 'conflict', 'recovery_required'].includes(item.stage),
        ),
        'combined_scan_fence',
      );
      await delay(100);
    }
    check(deferred, 'combined_reflection_deferred');
    check(
      (await upstream('getSong', { id: trackId })).song.title === before,
      'combined_no_competing_scan',
    );
  } finally {
    coordinator(true);
  }
  await completed(job!.id);
  const current = await json(`/api/v1/tracks/${encodeURIComponent(trackId)}/metadata`);
  const restore = (
    await json(
      `/api/v1/metadata-jobs/${job!.id}/restores`,
      {
        operationId: randomUUID(),
        itemId: job!.items[0]!.itemId,
        currentExpectedRevision: current.fileRevision,
      },
      202,
    )
  ).job;
  await completed(restore.id);
  check((await upstream('getSong', { id: trackId })).song.title === before, 'combined_restore');
  const evidence = {
    schemaVersion: 1,
    importsWorkerHealthy: true,
    metadataWorkerHealthy: true,
    sharedScanLease: true,
    deferredThenVerified: true,
    combinedRestore: true,
  };
  writeFileSync(join(c.root, 'private/combined-result.json'), JSON.stringify(evidence), {
    mode: 0o600,
  });
  process.stdout.write(JSON.stringify(evidence) + '\n');
}
try {
  compose('start', 'metadata-worker');
  await healthy();
  const login = await api(
    '/api/v1/session',
    {
      kind: 'password',
      username: c.username,
      password: c.password,
    },
    201,
  );
  headers.cookie = login.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ');
  headers['x-csrf-token'] = (await login.json()).csrfToken;
  await upstream('startScan');
  for (let i = 0; i < 100; i++) {
    if (!(await upstream('getScanStatus')).scanStatus.scanning) break;
    await delay(100);
  }
  const songs =
    (await upstream('search3', { query: '', songCount: '100' })).searchResult3.song ?? [];
  check(songs.length === 1, 'fixture_exact_song');
  const trackId = String(songs[0].id);
  const originalTitle = String(songs[0].title);
  const editedTitle = `Runtime verified ${randomUUID()}`;
  const snapshot = await json(`/api/v1/tracks/${encodeURIComponent(trackId)}/metadata`);
  const capability = await json('/api/v1/capabilities');
  check(capability.features['metadata.write'].availability === 'available', 'write_available');
  if (c.combined) {
    await combinedCoordinator(trackId);
    process.exit(0);
  }
  const submitted = await json(
    '/api/v1/metadata-jobs',
    {
      operationId: randomUUID(),
      targets: [{ trackId, expectedRevision: snapshot.fileRevision }],
      patch: { title: { op: 'set', value: editedTitle } },
    },
    202,
  );
  const edited = await completed(submitted.job.id);
  check((await upstream('getSong', { id: trackId })).song.title === editedTitle, 'indexed_title');
  const changed = await json(`/api/v1/tracks/${encodeURIComponent(trackId)}/metadata`);
  check(changed.fileRevision !== snapshot.fileRevision, 'file_revision_changed');
  compose('stop', 'metadata-worker');
  check((await fetch(c.api + '/health/ready')).ok, 'api_ready_worker_down');
  const down = await json('/api/v1/capabilities');
  check(down.features['metadata.write'].availability !== 'available', 'down_unavailable');
  const media = await fetch(`${c.api}/api/v1/media/songs/${encodeURIComponent(trackId)}/stream`, {
    headers: { cookie: headers.cookie!, range: 'bytes=0-99' },
    signal: AbortSignal.timeout(10000),
  });
  check(
    media.status === 206 && (await media.arrayBuffer()).byteLength === 100,
    'range_worker_down',
  );
  compose('start', 'metadata-worker');
  await healthy();
  const restored = await json(
    `/api/v1/metadata-jobs/${edited.id}/restores`,
    {
      operationId: randomUUID(),
      itemId: edited.items[0]!.itemId,
      currentExpectedRevision: changed.fileRevision,
    },
    202,
  );
  await completed(restored.job.id);
  check(
    (await upstream('getSong', { id: trackId })).song.title === originalTitle,
    'restore_indexed',
  );
  await crashRecovery(trackId);
  await matchingSnapshot();
  const result = {
    schemaVersion: 1,
    helperSelfTest: true,
    apiWorkerGonic: true,
    workerRestart: true,
    workerDownReadiness: true,
    workerDownRange: true,
    restoreJob: true,
    matchingSnapshotNewVolumes: true,
    interruptedWriteRecovery: true,
  };
  writeFileSync(join(c.root, 'private/runtime-result.json'), JSON.stringify(result), {
    mode: 0o600,
  });
  process.stdout.write(JSON.stringify(result) + '\n');
} catch (error) {
  process.stderr.write(
    error instanceof Error && /^probe_failed:[a-z0-9_]+$/.test(error.message)
      ? error.message + '\n'
      : `probe_failed:${phase}\n`,
  );
  process.exitCode = 1;
}
