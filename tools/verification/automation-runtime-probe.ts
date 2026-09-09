import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import {
  decodeCurationClaimResult,
  decodeMetadataJob,
  type MetadataJob,
} from '../../packages/contracts/src/index.js';
import {
  createAutomationHTTPClient,
  readAutomationProbeConfig,
  readPrivateJSON,
  probeCheck as check,
} from './automation-http-client.js';

const execute = promisify(execFile);
let phase = 'config';
try {
  const c = readAutomationProbeConfig(process.argv[process.argv.indexOf('--config') + 1]!);
  check(
    process.platform === 'linux' &&
      c.root &&
      c.project &&
      /^musiclatte-p6-[a-z0-9-]+$/.test(c.project),
    'isolated_linux',
  );
  const root = realpathSync(c.root);
  const project = c.project;
  check(
    root.startsWith('/tmp/musiclatte-p6-') && c.fixtureRelativeKey === 'imports/synthetic.mp3',
    'owned_fixture',
  );
  const owner = JSON.parse(readFileSync(join(root, 'owner.json'), 'utf8'));
  check(owner.project === project && owner.purpose === 'phase-6-autopilot-isolated-probe', 'owner');
  const docker = async (...args: string[]) => {
    const helper =
      args[0] === 'run' && args.includes('--rm') ? `${project}-probe-${randomUUID()}` : null;
    if (helper) args.splice(1, 0, '--name', helper);
    try {
      return (
        await execute('docker', args, {
          cwd: join(root, 'repo'),
          timeout: 180000,
          killSignal: 'SIGKILL',
          maxBuffer: 1048576,
        })
      ).stdout;
    } finally {
      if (helper)
        await execute('docker', ['rm', '-f', helper], {
          timeout: 10000,
          killSignal: 'SIGKILL',
        }).catch(() => {});
    }
  };
  const compose = (...args: string[]) =>
    docker(
      'compose',
      '--env-file',
      join(root, 'private/compose.env'),
      '-f',
      'compose.yaml',
      '-f',
      'deploy/compose.imports.yaml',
      '-f',
      'deploy/compose.metadata.yaml',
      '-f',
      'deploy/compose.automation.yaml',
      '-f',
      'deploy/compose.test.yaml',
      ...args,
    );
  const worker = `${project}-metadata-worker-1`;
  const apiContainer = `${project}-api-1`;
  const healthy = async (name: string) => {
    for (let i = 0; i < 120; i++) {
      if (
        (await docker('inspect', '--format', '{{.State.Health.Status}}', name)).trim() === 'healthy'
      )
        return;
      await delay(1000);
    }
    throw new Error('probe_failed:health');
  };
  const client = await createAutomationHTTPClient(c);
  const original = createHash('sha256')
    .update(readFileSync(join(root, 'music', c.fixtureRelativeKey)))
    .digest('hex');
  phase = 'scan';
  check((await client.upstream('startScan')).ok, 'scan');
  await healthy(worker);
  phase = 'http_workflow';
  const result = await client.workflow();
  const trackPath = '/tracks/' + encodeURIComponent(result.trackId);
  async function completed(id: string): Promise<MetadataJob> {
    for (let i = 0; i < 180; i++) {
      const job = decodeMetadataJob(
        (await client.json('/metadata-jobs/' + id, undefined, 200, { token: false })).job,
      );
      if (job.status === 'succeeded') return job;
      check(!['failed', 'partial'].includes(job.status), 'legacy_job_failed');
      await delay(500);
    }
    throw new Error('probe_failed:legacy_job_timeout');
  }
  phase = 'worker_stop';
  await compose('stop', 'metadata-worker');
  check((await fetch(c.origin + '/health/ready')).ok, 'api_ready');
  const down = await client.json('/capabilities', undefined, 200, { token: false });
  check(down.features['metadata.curation'].availability !== 'available', 'worker_down_capability');
  const range = await client.upstream('stream', { id: result.trackId }, c.origin, {
    range: 'bytes=0-99',
  });
  check(range.status === 206 && (await range.arrayBuffer()).byteLength === 100, 'rest_range');
  const song = await (await client.upstream('getSong', { id: result.trackId }, c.origin)).json();
  check(song['subsonic-response'].status === 'ok', 'rest_read');
  await compose('start', 'metadata-worker');
  await healthy(worker);
  phase = 'original_restore';
  const restored = await client.json(
    '/metadata-jobs/' + result.firstJobId + '/restores',
    {
      operationId: randomUUID(),
      itemId: result.firstItemId,
      currentExpectedRevision: result.revision,
    },
    202,
    { token: false },
  );
  await completed(restored.job.id);
  check(
    createHash('sha256')
      .update(readFileSync(join(root, 'music', c.fixtureRelativeKey)))
      .digest('hex') === original,
    'original_bytes_restored',
  );
  phase = 'legacy_write_crash';
  const current = await client.json(trackPath + '/metadata', undefined, 200, { token: false });
  await docker('update', '--restart=no', worker);
  try {
    const job = await client.json(
      '/metadata-jobs',
      {
        operationId: randomUUID(),
        targets: [{ trackId: result.trackId, expectedRevision: current.fileRevision }],
        patch: { title: { op: 'set', value: 'Interrupted synthetic verification' } },
      },
      202,
      { token: false },
    );
    let killed = false;
    for (let i = 0; i < 300; i++) {
      const state = (
        await client.json('/metadata-jobs/' + job.job.id, undefined, 200, { token: false })
      ).job;
      if (
        state.items.some((item: { stage: string }) =>
          ['preparing', 'backed_up', 'prepared'].includes(item.stage),
        )
      ) {
        await docker('kill', '--signal=KILL', worker);
        killed = true;
        break;
      }
      check(
        state.items.every((item: { stage: string }) => item.stage === 'queued'),
        'crash_boundary',
      );
      await delay(10);
    }
    check(killed, 'crash_observed');
    await delay(31000);
    await compose('start', 'metadata-worker');
    await healthy(worker);
    let terminal: MetadataJob | undefined;
    for (let i = 0; i < 120; i++) {
      const state = decodeMetadataJob(
        (await client.json('/metadata-jobs/' + job.job.id, undefined, 200, { token: false })).job,
      );
      if (state.items.every((item) => ['failed', 'succeeded'].includes(item.stage))) {
        terminal = state;
        break;
      }
      check(
        !state.items.some((item) => ['conflict', 'recovery_required'].includes(item.stage)),
        'crash_ambiguous',
      );
      await delay(500);
    }
    check(terminal, 'crash_recovered');
    if (terminal.status === 'succeeded') {
      const undo = await client.json(
        '/metadata-jobs/' + terminal.id + '/restores',
        {
          operationId: randomUUID(),
          itemId: terminal.items[0]!.itemId,
          currentExpectedRevision: terminal.items[0]!.resultRevision,
        },
        202,
        { token: false },
      );
      await completed(undo.job.id);
    }
  } finally {
    await docker('update', '--restart=unless-stopped', worker);
    await compose('start', 'metadata-worker');
  }
  phase = 'snapshot_prepare';
  // More than one token guarantees a real cursor, independently of library size.
  await client.issue();
  const page = await client.json('/access-tokens?limit=1', undefined, 200, { token: false });
  check(page.nextCursor, 'cursor_created');
  const snapshotTrack = await client.json(trackPath + '/metadata', undefined, 200, {
    token: false,
  });
  const claim = decodeCurationClaimResult(
    await client.json('/curation-claims', {
      operationId: randomUUID(),
      purpose: 'optional_enrichment',
      fields: ['lyrics'],
      targets: [{ trackId: result.trackId, expectedRevision: snapshotTrack.fileRevision }],
    }),
  );
  check(claim.claimId, 'snapshot_claim');
  await compose('stop', 'metadata-worker', 'worker', 'api');
  const specs = JSON.parse(await docker('inspect', apiContainer, worker)) as {
    Config: { Env: string[]; Image: string; Cmd: string[] };
    Mounts: { Type: string; Name?: string; Source: string; Destination: string; RW: boolean }[];
  }[];
  const apiSpec = specs[0]!;
  const workerSpec = specs[1]!;
  const suffix = randomUUID();
  const mounts = ['/management', '/keys', '/metadata-data', '/metadata-uploads'];
  const replacements = new Map(
    mounts.map((mount, i) => [mount, `${project}-restore-${i}-${suffix}`]),
  );
  replacements.set('/media-fence', `${project}-restore-fence-${suffix}`);
  const names = [`${project}-restored-api-${suffix}`, `${project}-restored-worker-${suffix}`];
  const snapshot = join(root, 'private', 'snapshot-' + suffix);
  const environment = (spec: typeof apiSpec) => spec.Config.Env.flatMap((value) => ['-e', value]);
  const volumes = (spec: typeof apiSpec, restoredCopy: boolean) =>
    spec.Mounts.flatMap((m) => [
      '-v',
      `${restoredCopy && replacements.has(m.Destination) ? replacements.get(m.Destination) : m.Type === 'volume' ? m.Name : m.Source}:${m.Destination}${m.RW ? '' : ':ro'}`,
    ]);
  try {
    phase = 'snapshot_create';
    await docker(
      'run',
      '--rm',
      '--network',
      'none',
      ...environment(workerSpec),
      ...volumes(workerSpec, false),
      '-v',
      `${root}/private:/snapshots`,
      workerSpec.Config.Image,
      'node',
      'apps/api/dist/metadata-backup-entry.js',
      'create',
      '/snapshots/snapshot-' + suffix,
    );
    for (const volume of replacements.values()) await docker('volume', 'create', volume);
    const targetMounts = [...replacements].flatMap(([mount, volume]) => [
      '-v',
      `${volume}:${mount}`,
    ]);
    await docker(
      'run',
      '--rm',
      '--network',
      'none',
      '--user',
      '0:0',
      ...targetMounts,
      workerSpec.Config.Image,
      'node',
      '-e',
      `const fs=require('node:fs');for(const p of ${JSON.stringify([...replacements.keys()])}){if(fs.readdirSync(p).length)process.exit(1);fs.chownSync(p,1000,1000);fs.chmodSync(p,448)}`,
    );
    phase = 'snapshot_restore';
    await docker(
      'run',
      '--rm',
      '--network',
      'none',
      ...environment(workerSpec),
      ...targetMounts,
      '-v',
      `${root}/music:/music`,
      '-v',
      `${root}/private/metadata-policy.json:/run/configs/metadata-policy.json:ro`,
      '-v',
      `${root}/private:/snapshots:ro`,
      workerSpec.Config.Image,
      'node',
      'apps/api/dist/metadata-backup-entry.js',
      'restore',
      '/snapshots/snapshot-' + suffix,
    );
    // Compare private copies in-place; only booleans may leave the process.
    const before = readPrivateJSON(c.credentialPath);
    check(before, 'private_proof');
    const verify = `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/management/management.sqlite',{readOnly:true});if(db.prepare('SELECT count(*) AS n FROM access_tokens WHERE revoked_at IS NULL OR encrypted_proof IS NOT NULL').get().n!==0)process.exit(1);if(db.prepare("SELECT count(*) AS n FROM curation_tracks WHERE validation!='stale'").get().n!==0)process.exit(1);if(db.prepare('SELECT count(*) AS n FROM curation_claims c JOIN curation_state s ON c.claim_epoch=s.claim_epoch WHERE c.released_at IS NULL').get().n!==0)process.exit(1);db.close();`;
    await docker(
      'run',
      '--rm',
      '--network',
      'none',
      ...targetMounts,
      apiSpec.Config.Image,
      'node',
      '-e',
      verify,
    );
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    phase = 'restored_api';
    await docker(
      'run',
      '-d',
      '--name',
      names[0]!,
      '--network',
      `${project}_default`,
      '-p',
      `127.0.0.1:${port}:3000`,
      ...environment(apiSpec),
      ...volumes(apiSpec, true),
      '--health-cmd',
      'node apps/api/dist/config/healthcheck.js',
      '--health-interval',
      '2s',
      apiSpec.Config.Image,
      ...apiSpec.Config.Cmd,
    );
    const base = `http://127.0.0.1:${port}/api/v1`;
    for (let i = 0; i < 60; i++) {
      if (
        await fetch(`http://127.0.0.1:${port}/health/ready`)
          .then((r) => r.ok)
          .catch(() => false)
      )
        break;
      await delay(500);
    }
    check(
      (await client.raw('/session', undefined, { base, token: false })).status === 200,
      'session_preserved',
    );
    check(
      (await client.raw('/metadata-policy', undefined, { base })).status === 401,
      'restored_token_rejected',
    );
    check(
      (
        await client.raw(
          '/access-tokens?limit=1&cursor=' + encodeURIComponent(page.nextCursor),
          undefined,
          { base, token: false },
        )
      ).status === 400,
      'restored_cursor_rejected',
    );
    phase = 'restored_inventory';
    await docker(
      'run',
      '-d',
      '--name',
      names[1]!,
      '--network',
      `${project}_default`,
      ...environment(workerSpec),
      ...volumes(workerSpec, true),
      workerSpec.Config.Image,
      ...workerSpec.Config.Cmd,
    );
    let verified = false;
    for (let i = 0; i < 120; i++) {
      const response = await client.raw('/tracks', undefined, { base, token: false });
      if (response.ok) {
        const data = await response.json();
        if (
          data.tracks.some(
            (t: { trackId: string; validation: string }) =>
              t.trackId === result.trackId && t.validation === 'verified',
          )
        ) {
          verified = true;
          break;
        }
      }
      await delay(500);
    }
    check(verified, 'restored_inventory_verified');
  } finally {
    for (const name of names) await docker('rm', '-f', name).catch(() => {});
    for (const volume of replacements.values())
      await docker('volume', 'rm', volume).catch(() => {});
    await compose('start', 'api', 'metadata-worker', 'worker');
  }
  await client.raw('/curation-claims/' + claim.claimId, undefined, { method: 'DELETE' });
  await client.revoke();
  const summary = {
    ...result.summary,
    workerRestart: true,
    interruptedWriteRecovery: true,
    originalRestore: true,
    restRange: true,
    legacyEdit: true,
    offlineSnapshot: true,
    sessionPreserved: true,
    patClaimCursorInvalidated: true,
    inventoryReverified: true,
  };
  writeFileSync(join(root, 'private/automation-runtime-result.json'), JSON.stringify(summary), {
    mode: 0o600,
  });
  process.stdout.write(JSON.stringify(summary) + '\n');
} catch (error) {
  const detail =
    error instanceof Error && /^probe_failed:[a-z0-9_]+$/.test(error.message)
      ? '_' + error.message.slice(13)
      : '';
  process.stderr.write('probe_failed:runtime_' + phase + detail + '\n');
  process.exitCode = 1;
}
