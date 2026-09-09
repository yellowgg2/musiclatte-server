import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  decodeCurationList,
  decodeCurationClaimResult,
  decodeAutomationDryRun,
  decodeAutomationJobResponse,
  decodeCurationCompletion,
  decodeMetadataAttemptResponse,
  type MetadataPatch,
} from '../../packages/contracts/src/index.js';
export interface AutomationProbeConfig {
  api: string;
  origin: string;
  upstream: string;
  credentialPath: string;
  libraryId: string;
  fixtureTitle: string;
  trackId?: string;
  root?: string;
  project?: string;
  fixtureRelativeKey?: string;
}
export function readPrivateJSON(path: string): unknown {
  if (!isAbsolute(path) || realpathSync(path) !== path)
    throw new Error('probe_failed:private_config');
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > 65536 ||
    (stat.mode & 0o077) !== 0 ||
    stat.uid !== process.getuid?.()
  )
    throw new Error('probe_failed:private_config');
  return JSON.parse(readFileSync(path, 'utf8'));
}
export function readAutomationProbeConfig(path: string): AutomationProbeConfig {
  const value = readPrivateJSON(path) as AutomationProbeConfig;
  if (
    !value ||
    typeof value !== 'object' ||
    !['api', 'origin', 'upstream', 'credentialPath', 'libraryId', 'fixtureTitle'].every(
      (k) => typeof value[k as keyof AutomationProbeConfig] === 'string',
    ) ||
    Object.keys(value).some(
      (k) =>
        ![
          'api',
          'origin',
          'upstream',
          'credentialPath',
          'libraryId',
          'fixtureTitle',
          'trackId',
          'root',
          'project',
          'fixtureRelativeKey',
        ].includes(k),
    )
  )
    throw new Error('probe_failed:private_config');
  for (const key of ['api', 'origin', 'upstream'] as const) {
    const u = new URL(value[key]);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash)
      throw new Error('probe_failed:private_config');
  }
  return value;
}
export function probeCheck(condition: unknown, stage: string): asserts condition {
  if (!condition) throw new Error('probe_failed:' + stage);
}
export async function createAutomationHTTPClient(config: AutomationProbeConfig) {
  const credential = readPrivateJSON(config.credentialPath) as {
    username: string;
    password: string;
  };
  probeCheck(
    credential &&
      Object.keys(credential).sort().join(',') === 'password,username' &&
      typeof credential.username === 'string' &&
      typeof credential.password === 'string',
    'credential_shape',
  );
  const browser: Record<string, string> = {
    origin: config.origin,
    'x-musiclatte-client': 'web',
    'content-type': 'application/json',
  };
  const login = await fetch(config.api + '/session', {
    method: 'POST',
    headers: browser,
    body: JSON.stringify({ kind: 'password', ...credential }),
    signal: AbortSignal.timeout(10000),
  });
  probeCheck(login.status === 201, 'session');
  browser.cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  browser['x-csrf-token'] = (await login.json()).csrfToken;
  let tokenHeaders: Record<string, string> = {};
  let tokenId = '';
  const ownedClaims = new Set<string>();
  async function raw(
    path: string,
    body: unknown = undefined,
    options: { method?: string; token?: boolean; base?: string } = {},
  ) {
    const headers = { ...(options.token === false ? browser : tokenHeaders) };
    const method = options.method ?? (body === undefined ? 'GET' : 'POST');
    if (method === 'DELETE' && body === undefined) {
      if (options.token === false) body = {};
      else delete headers['content-type'];
    }
    return fetch((options.base ?? config.api) + path, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
  }
  async function json(
    path: string,
    body: unknown = undefined,
    status = 200,
    options: Parameters<typeof raw>[2] = {},
    retries = 20,
  ): Promise<any> {
    const r = await raw(path, body, options);
    if (r.status !== status) {
      const error = await r.json().catch(() => ({}));
      if (
        r.status === 422 &&
        status === 202 &&
        error.job === null &&
        Array.isArray(error.admissionResults) &&
        error.admissionResults.some((item: { reason?: string }) => item.reason === 'file_busy') &&
        retries > 0 &&
        body &&
        typeof body === 'object' &&
        'operationId' in body
      ) {
        // A fully rejected admission is a durable result. Retry the now-idle file as a new operation.
        body.operationId = randomUUID();
        await delay(500);
        return json(path, body, status, options, retries - 1);
      }
      const reason = error?.error?.reason ?? error?.error?.code ?? 'unknown';
      if (r.status === 409 && reason === 'pending_job' && retries > 0) {
        await delay(250);
        return json(path, body, status, options, retries - 1);
      }
      const safe = typeof reason === 'string' && /^[a-z_]+$/.test(reason) ? reason : 'unknown';
      const route = path
        .split('?')[0]!
        .split('/')
        .filter(Boolean)
        .filter((v) => /^[a-z-]+$/.test(v))
        .join('_')
        .replaceAll('-', '_');
      throw new Error(`probe_failed:${route}_http_${status}_${r.status}_${safe}`);
    }
    const value = await r.json();
    if (
      retries > 0 &&
      Array.isArray(value.results) &&
      value.results.some(
        (item: { reason?: string; status?: string }) =>
          item.reason === 'file_busy' || item.status === 'file_busy',
      ) &&
      (value.dryRun === true || value.claimId === null) &&
      body &&
      typeof body === 'object' &&
      'operationId' in body
    ) {
      if (value.claimId === null) body.operationId = randomUUID();
      await delay(500);
      return json(path, body, status, options, retries - 1);
    }
    if (typeof value.claimId === 'string') ownedClaims.add(value.claimId);
    return value;
  }
  async function issue() {
    const r = await json(
      '/access-tokens',
      {
        name: 'Isolated automation verification',
        scopes: ['metadata:read', 'metadata:write', 'lyrics:write', 'curation:write'],
        libraryIds: [config.libraryId],
        expiresAt: Date.now() + 3600000,
      },
      201,
      { token: false },
    );
    tokenHeaders = { authorization: 'Bearer ' + r.token, 'content-type': 'application/json' };
    tokenId = r.accessToken.id;
  }
  async function revoke() {
    for (const id of ownedClaims)
      await raw('/curation-claims/' + id, undefined, { method: 'DELETE' }).catch(() => {});
    ownedClaims.clear();
    probeCheck(
      (await raw('/access-tokens/' + tokenId, undefined, { method: 'DELETE', token: false }))
        .status === 204,
      'revoke',
    );
    probeCheck((await raw('/metadata-policy')).status === 401, 'revoked_rejected');
  }
  async function upstream(
    method: string,
    params: Record<string, string> = {},
    base = config.upstream,
    headers: Record<string, string> = {},
  ) {
    const salt = randomUUID();
    const url = new URL('/rest/' + method + '.view', base);
    url.search = new URLSearchParams({
      u: credential.username,
      t: createHash('md5')
        .update(credential.password + salt)
        .digest('hex'),
      s: salt,
      c: 'musiclatte-isolated-automation',
      v: '1.16.1',
      f: 'json',
      ...params,
    }).toString();
    return fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  }
  async function poll(jobId: string) {
    for (let n = 0; n < 180; n++) {
      const r = decodeAutomationJobResponse(await json('/metadata-jobs/' + jobId));
      if (r.job?.status === 'succeeded') {
        // Let the worker consume its publication event before the next verification mutation.
        await delay(1000);
        return r;
      }
      if (['failed', 'partial'].includes(r.job?.status ?? ''))
        throw new Error('probe_failed:job_terminal');
      await delay(500);
    }
    throw new Error('probe_failed:job_timeout');
  }
  return {
    raw,
    json,
    issue,
    revoke,
    upstream,
    poll,
    async workflow() {
      let ready = false;
      for (let i = 0; i < 120; i++) {
        const cap = await json('/capabilities', undefined, 200, { token: false });
        if (cap.features['metadata.curation']?.availability === 'available') {
          ready = true;
          break;
        }
        await delay(500);
      }
      probeCheck(ready, 'worker_ready');
      await issue();
      const policy = (await json('/metadata-policy')).policy;
      probeCheck(policy.policyVersion === 'required-v1', 'policy');
      let track;
      for (let n = 0; n < 180; n++) {
        const page = decodeCurationList(
          await json('/tracks?libraryId=' + encodeURIComponent(config.libraryId)),
        );
        const candidates = page.tracks.filter((t) =>
          config.trackId ? t.trackId === config.trackId : t.title === config.fixtureTitle,
        );
        if (candidates.length === 1 && candidates[0]!.validation === 'verified') {
          track = candidates[0]!;
          break;
        }
        await delay(500);
      }
      probeCheck(track, 'inventory');
      const trackId = track.trackId;
      let revision = track.fileRevision!;
      const targets = () => [{ trackId, expectedRevision: revision }];
      const claim = decodeCurationClaimResult(
        await json('/curation-claims', {
          operationId: randomUUID(),
          purpose: 'required_review',
          fields: ['title', 'artist'],
          targets: targets(),
        }),
      );
      probeCheck(claim.claimId, 'claim');
      const request = {
        operationId: randomUUID(),
        targets: [
          ...targets(),
          { trackId: 'synthetic-missing-' + randomUUID(), expectedRevision: 'unknown' },
        ],
        patch: { title: { op: 'set' as const, value: 'Reviewed isolated automation fixture' } },
        automation: {
          claimId: claim.claimId,
          claimGeneration: claim.generation!,
          purpose: 'required_review',
          sourceNotes: 'Synthetic fixture review',
        },
        dryRun: true,
      };
      probeCheck(
        decodeAutomationDryRun(await json('/metadata-jobs', request)).results[0]!.status ===
          'changed',
        'dry_run',
      );
      request.dryRun = false;
      const accepted = decodeAutomationJobResponse(await json('/metadata-jobs', request, 202));
      probeCheck(
        accepted.job && accepted.admissionResults[1]!.status === 'rejected',
        'partial_admission',
      );
      // Retrying intentionally simulates a lost response without a second write.
      probeCheck(
        decodeAutomationJobResponse(
          await json('/metadata-jobs', { ...request, dryRun: false }, 202),
        ).job!.id === accepted.job.id,
        'write_replay',
      );
      const done = await poll(accepted.job.id);
      revision = done.job!.items[0]!.resultRevision!;
      const completeBody = {
        operationId: randomUUID(),
        claimId: claim.claimId,
        claimGeneration: claim.generation,
        expectedRevision: revision,
        policyVersion: policy.policyVersion,
        sourceNotes: 'Explicit synthetic review',
      };
      const completed = decodeCurationCompletion(
        await json('/tracks/' + encodeURIComponent(trackId) + '/curation/complete', completeBody),
      );
      probeCheck(
        decodeCurationCompletion(
          await json('/tracks/' + encodeURIComponent(trackId) + '/curation/complete', completeBody),
        ).receipt.id === completed.receipt.id,
        'completion_replay',
      );
      const optional = decodeCurationClaimResult(
        await json('/curation-claims', {
          operationId: randomUUID(),
          purpose: 'optional_enrichment',
          fields: ['lyrics'],
          targets: targets(),
        }),
      );
      probeCheck(optional.claimId, 'optional_claim');
      const attempt = async () =>
        decodeMetadataAttemptResponse(
          await json('/tracks/' + encodeURIComponent(trackId) + '/metadata-attempts', {
            operationId: randomUUID(),
            claimId: optional.claimId,
            claimGeneration: optional.generation,
            expectedRevision: revision,
            field: 'lyrics',
            status: 'unavailable',
            reason: 'No permitted source in synthetic fixture',
            sourceNotes: null,
          }),
        );
      probeCheck((await attempt()).fieldState.status === 'unavailable', 'attempt');
      const selector = { language: 'eng', description: 'isolated-probe' };
      for (const patch of [
        {
          lyrics: {
            op: 'set',
            selector,
            text: 'This is an original verification lyric, written for a synthetic song.',
          },
        },
        { lyrics: { op: 'clear', selector } },
      ] as MetadataPatch[]) {
        const job = decodeAutomationJobResponse(
          await json(
            '/metadata-jobs',
            {
              operationId: randomUUID(),
              targets: targets(),
              patch,
              automation: {
                claimId: optional.claimId,
                claimGeneration: optional.generation,
                purpose: 'optional_enrichment',
                sourceNotes: 'Original verification lyric',
              },
              dryRun: false,
            },
            202,
          ),
        );
        revision = (await poll(job.job!.id)).job!.items[0]!.resultRevision!;
      }
      await attempt();
      probeCheck(
        (await raw('/curation-claims/' + optional.claimId, undefined, { method: 'DELETE' }))
          .status === 204,
        'release',
      );
      const detail = await json('/tracks/' + encodeURIComponent(trackId) + '/curation');
      probeCheck(
        detail.track.curationStatus === 'completed' &&
          detail.track.receipt.id === completed.receipt.id &&
          detail.track.lyricsState === 'unavailable',
        'completion_preserved',
      );
      return {
        trackId,
        revision,
        firstJobId: accepted.job.id,
        firstItemId: accepted.job.items[0]!.itemId,
        receiptId: completed.receipt.id,
        summary: {
          schemaVersion: 1,
          http: true,
          partialAdmission: true,
          replay: true,
          completed: true,
          optionalPreserved: true,
        },
      };
    },
  };
}
export async function runAutomationHTTPClient(config: AutomationProbeConfig) {
  const client = await createAutomationHTTPClient(config);
  try {
    const result = await client.workflow();
    await client.revoke();
    return { ...result.summary, revocation: true };
  } catch (error) {
    await client.revoke().catch(() => {});
    throw error;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const path = process.argv[process.argv.indexOf('--config') + 1];
    probeCheck(path, 'private_config');
    process.stdout.write(
      JSON.stringify(await runAutomationHTTPClient(readAutomationProbeConfig(path))) + '\n',
    );
  } catch (error) {
    process.stderr.write(
      error instanceof Error && /^probe_failed:[a-z0-9_]+$/.test(error.message)
        ? error.message + '\n'
        : 'probe_failed:client\n',
    );
    process.exitCode = 1;
  }
}
