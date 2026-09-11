import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import {
  decodeAutomationDryRun,
  decodeAutomationJobResponse,
  decodeCurationClaimResult,
  decodeMetadataCoverUpload,
  decodeMetadataJob,
  decodeMetadataPreview,
  decodeMetadataSnapshot,
  decodeOrganizationCandidates,
  decodeOrganizationJobResponse,
  decodeOrganizationPreview,
  decodeOrganizationSelection,
  metadataFields,
  organizationEvidenceKinds,
  type MetadataField,
  type MetadataPatch,
  type OrganizationJob,
  type OrganizationSourceEvidence,
} from '@musiclatte/contracts';
import {
  checkpointId3OrganizationBatch,
  createId3OrganizationBatchJournal,
  id3OrganizationBatchBinding,
  id3OrganizationBatchStatus,
  nextId3OrganizationBatchItem,
  recordId3OrganizationBatchFailure,
  skipId3OrganizationBatchItem,
  verifyId3OrganizationBatchContext,
} from './id3-organize-batch-journal.js';

type MetadataValues = Partial<{
  title: string;
  artist: string[];
  album: string;
  albumArtist: string[];
  trackNumber: string;
  year: string;
  genre: string[];
}>;

export interface Id3OrganizationManifest {
  schemaVersion: 1;
  metadata: MetadataValues;
  sourceEvidence: OrganizationSourceEvidence[];
  cover?: { path: string; usageBasis: string };
}

type PollOptions = { attempts: number; intervalMs: number; recoveryRetries: number };

export interface Id3OrganizeCommandOptions {
  api: string;
  tokenFile: string;
  command:
    | 'candidates'
    | 'inspect'
    | 'metadata-preview'
    | 'cover-upload'
    | 'metadata-submit'
    | 'organization-preview'
    | 'organization-submit'
    | 'status'
    | 'retry'
    | 'batch-start'
    | 'batch-next'
    | 'batch-skip'
    | 'batch-status';
  title?: string;
  libraryId?: string;
  trackId?: string;
  revision?: string;
  jobId?: string;
  metadataJobId?: string;
  operationId?: string;
  manifest?: Id3OrganizationManifest;
  sourceEvidence?: OrganizationSourceEvidence[];
  coverUploadId?: string;
  stateFile?: string;
  source?: 'favorites' | 'playlist';
  playlistId?: string;
  skipReason?: string;
  poll?: PollOptions;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

function fail(code: string): never {
  throw new Error(`client_failed:${code}`);
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const text = (value: unknown, max = 4096): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max && /\S/.test(value);
const strings = (value: unknown, max = 32): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.length <= max && value.every((v) => text(v));

function privateFile(path: string, maxBytes: number, code: string) {
  try {
    if (!isAbsolute(path)) fail(code);
    const stat = lstatSync(path);
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      stat.size > maxBytes ||
      stat.size < 1 ||
      (stat.mode & 0o077) !== 0 ||
      stat.uid !== process.getuid?.()
    )
      fail(code);
    return readFileSync(path);
  } catch (error) {
    if (error instanceof Error && error.message === `client_failed:${code}`) throw error;
    return fail(code);
  }
}

export function readPrivateToken(path: string): string {
  const token = privateFile(path, 8192, 'private_token').toString('utf8').trim();
  if (!/^mlpat_[A-Za-z0-9_-]{32,}$/.test(token)) fail('private_token');
  return token;
}

function decodeEvidence(value: unknown): OrganizationSourceEvidence[] {
  if (!Array.isArray(value) || !value.length || value.length > 8) fail('manifest');
  return value.map((entry) => {
    if (!object(entry) || !exact(entry, ['url', 'kind', 'fields'])) fail('manifest');
    let url: URL;
    try {
      url = new URL(String(entry.url));
    } catch {
      return fail('manifest');
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !organizationEvidenceKinds.includes(entry.kind as never) ||
      !Array.isArray(entry.fields) ||
      !entry.fields.length ||
      new Set(entry.fields).size !== entry.fields.length ||
      !entry.fields.every((field) => metadataFields.includes(field as never))
    )
      fail('manifest');
    return {
      url: String(entry.url),
      kind: entry.kind as OrganizationSourceEvidence['kind'],
      fields: entry.fields as MetadataField[],
    };
  });
}

export function decodeId3OrganizationManifest(value: unknown): Id3OrganizationManifest {
  if (!object(value)) fail('manifest');
  const keys = ['schemaVersion', 'metadata', 'sourceEvidence'];
  if (Object.hasOwn(value, 'cover')) keys.push('cover');
  if (!exact(value, keys) || value.schemaVersion !== 1 || !object(value.metadata)) fail('manifest');
  const allowed = ['title', 'artist', 'album', 'albumArtist', 'trackNumber', 'year', 'genre'];
  if (
    Object.keys(value.metadata).some((key) => !allowed.includes(key)) ||
    !Object.keys(value.metadata).length
  )
    fail('manifest');
  const metadata = value.metadata as Record<string, unknown>;
  if (
    ['title', 'album'].some((key) => metadata[key] !== undefined && !text(metadata[key])) ||
    (metadata.trackNumber !== undefined &&
      (typeof metadata.trackNumber !== 'string' ||
        !/^[1-9][0-9]*(\/[1-9][0-9]*)?$/.test(metadata.trackNumber))) ||
    (metadata.year !== undefined &&
      (typeof metadata.year !== 'string' || !/^[0-9]{4}$/.test(metadata.year))) ||
    ['artist', 'albumArtist', 'genre'].some(
      (key) => metadata[key] !== undefined && !strings(metadata[key]),
    )
  )
    fail('manifest');
  let cover: Id3OrganizationManifest['cover'];
  if (value.cover !== undefined) {
    if (
      !object(value.cover) ||
      !exact(value.cover, ['path', 'usageBasis']) ||
      !text(value.cover.path) ||
      !isAbsolute(value.cover.path) ||
      !text(value.cover.usageBasis)
    )
      fail('manifest');
    cover = { path: value.cover.path, usageBasis: value.cover.usageBasis };
  }
  return {
    schemaVersion: 1,
    metadata: metadata as MetadataValues,
    sourceEvidence: decodeEvidence(value.sourceEvidence),
    ...(cover ? { cover } : {}),
  };
}

export function readPrivateManifest(path: string) {
  try {
    return decodeId3OrganizationManifest(
      JSON.parse(privateFile(path, 65536, 'private_manifest').toString('utf8')),
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('client_failed:')) throw error;
    return fail('manifest');
  }
}

function patchFor(manifest: Id3OrganizationManifest, coverUploadId?: string): MetadataPatch {
  const patch = Object.fromEntries(
    Object.entries(manifest.metadata).map(([key, value]) => [key, { op: 'set', value }]),
  ) as MetadataPatch;
  if (coverUploadId) patch.cover = { op: 'replaceAll', uploadId: coverUploadId };
  return patch;
}

function required(value: string | undefined, code: string): string {
  if (!text(value, 4096)) fail(code);
  return value;
}

function apiRoot(raw: string) {
  try {
    const url = new URL(raw);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      fail('api');
    return url.toString().replace(/\/$/, '');
  } catch (error) {
    if (error instanceof Error && error.message === 'client_failed:api') throw error;
    return fail('api');
  }
}

export async function runId3OrganizeCommand(options: Id3OrganizeCommandOptions): Promise<any> {
  const request = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => delay(ms));
  const token = readPrivateToken(options.tokenFile);
  const base = apiRoot(options.api);
  const headers = { authorization: `Bearer ${token}` };
  const stopBoundBatch = (code: string) => {
    if (options.stateFile && options.trackId)
      recordId3OrganizationBatchFailure(options.stateFile, options.trackId, code);
  };
  const call = async (
    path: string,
    init: RequestInit = {},
    expected: readonly number[] = [200],
    replayLost = false,
  ) => {
    const execute = () =>
      request(base + path, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
    let response: Response;
    try {
      response = await execute();
    } catch {
      if (!replayLost) {
        stopBoundBatch('upstream_unavailable');
        return fail('network');
      }
      try {
        response = await execute();
      } catch {
        stopBoundBatch('upstream_unavailable');
        return fail('network');
      }
    }
    if (!expected.includes(response.status)) {
      if (response.status === 401) stopBoundBatch('unauthenticated');
      else if (response.status === 403) stopBoundBatch('forbidden');
      else if ([502, 503, 504].includes(response.status)) stopBoundBatch('upstream_unavailable');
      fail(`http_${response.status}`);
    }
    if (response.status === 204) return undefined;
    try {
      return await response.json();
    } catch {
      return fail('response');
    }
  };
  const jsonPost = (path: string, body: unknown, expected: readonly number[], replay = false) =>
    call(
      path,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      expected,
      replay,
    );
  const target = () => ({
    trackId: required(options.trackId, 'target'),
    expectedRevision: required(options.revision, 'target'),
  });

  if (options.command === 'batch-start') {
    const stateFile = required(options.stateFile, 'state_file');
    const source = options.source;
    if (!source || (source === 'playlist' && !options.playlistId)) fail('source');
    const selection = decodeOrganizationSelection(
      await jsonPost(
        '/metadata-organization/selections',
        {
          source:
            source === 'favorites'
              ? { kind: 'favorites' }
              : { kind: 'playlist', playlistId: options.playlistId },
        },
        [200],
      ),
    );
    createId3OrganizationBatchJournal({ path: stateFile, api: base, token, selection });
    return id3OrganizationBatchStatus(stateFile);
  }
  if (options.command === 'batch-next') {
    const stateFile = required(options.stateFile, 'state_file');
    verifyId3OrganizationBatchContext(stateFile, base, token);
    return nextId3OrganizationBatchItem(stateFile);
  }
  if (options.command === 'batch-skip') {
    const stateFile = required(options.stateFile, 'state_file');
    verifyId3OrganizationBatchContext(stateFile, base, token);
    skipId3OrganizationBatchItem(
      stateFile,
      required(options.trackId, 'target'),
      required(options.skipReason, 'skip_reason'),
    );
    return id3OrganizationBatchStatus(stateFile);
  }
  if (options.command === 'batch-status') {
    const stateFile = required(options.stateFile, 'state_file');
    verifyId3OrganizationBatchContext(stateFile, base, token);
    return id3OrganizationBatchStatus(stateFile);
  }

  const batchBinding = () => {
    if (!options.stateFile) return undefined;
    verifyId3OrganizationBatchContext(options.stateFile, base, token);
    return id3OrganizationBatchBinding(options.stateFile, required(options.trackId, 'target'));
  };

  if (options.command === 'candidates') {
    const query = new URLSearchParams({ title: required(options.title, 'title') });
    if (options.libraryId) query.set('libraryId', options.libraryId);
    return decodeOrganizationCandidates(
      await call('/metadata-organization/candidates?' + query.toString()),
    );
  }
  if (options.command === 'inspect')
    return decodeMetadataSnapshot(
      await call(
        '/tracks/' + encodeURIComponent(required(options.trackId, 'target')) + '/metadata',
      ),
    );
  if (options.command === 'organization-preview')
    return decodeOrganizationPreview(
      await jsonPost(
        '/metadata-organization/previews',
        { ...target(), destinationPolicy: 'id3-managed-v1' },
        [200],
      ),
    );
  if (options.command === 'metadata-preview') {
    if (!options.manifest) fail('manifest');
    return decodeMetadataPreview(
      await jsonPost(
        '/metadata-previews',
        { targets: [target()], patch: patchFor(options.manifest, options.coverUploadId) },
        [200],
      ),
    );
  }
  if (options.command === 'cover-upload') {
    if (!options.manifest?.cover) fail('cover');
    const image = privateFile(options.manifest.cover.path, 8 * 1024 * 1024, 'cover');
    if (!(image[0] === 0xff && image[1] === 0xd8 && image.at(-2) === 0xff && image.at(-1) === 0xd9))
      fail('cover');
    const binding = batchBinding();
    if (
      binding &&
      (binding.state !== 'researching' ||
        (options.operationId !== undefined && options.operationId !== binding.operations.cover))
    )
      fail('journal_binding');
    const upload = decodeMetadataCoverUpload(
      await call(
        '/metadata-covers',
        {
          method: 'POST',
          headers: {
            'content-type': 'image/jpeg',
            'x-operation-id': binding?.operations.cover ?? options.operationId ?? randomUUID(),
            'x-metadata-library-id': required(options.libraryId, 'library'),
          },
          body: image,
        },
        [201],
        true,
      ),
    );
    if (binding && options.stateFile)
      checkpointId3OrganizationBatch(options.stateFile, binding.trackId, {
        kind: 'cover',
        uploadId: upload.uploadId,
      });
    return upload;
  }
  if (options.command === 'metadata-submit') {
    if (!options.manifest) fail('manifest');
    const patch = patchFor(options.manifest, options.coverUploadId);
    const fields = Object.keys(patch) as MetadataField[];
    const requiredFields = fields.filter((field) => ['title', 'artist'].includes(field));
    const optionalFields = fields.filter((field) => !['title', 'artist'].includes(field));
    if (requiredFields.length && optionalFields.length) fail('mixed_claim_purpose');
    const purpose = requiredFields.length ? 'required_review' : 'optional_enrichment';
    const binding = batchBinding();
    if (
      binding &&
      (!['researching', 'metadata_accepted'].includes(binding.state) ||
        (options.operationId !== undefined &&
          options.operationId !== binding.operations.metadata) ||
        (binding.coverUploadId !== null && binding.coverUploadId !== options.coverUploadId))
    )
      fail('journal_binding');
    const claim = decodeCurationClaimResult(
      await jsonPost(
        '/curation-claims',
        {
          operationId: randomUUID(),
          purpose,
          fields,
          targets: [target()],
        },
        [200],
        true,
      ),
    );
    if (!claim.claimId || claim.results[0]?.status !== 'granted') fail('claim');
    const claimId = claim.claimId;
    try {
      const body = {
        operationId: binding?.operations.metadata ?? options.operationId ?? randomUUID(),
        targets: [target()],
        patch,
        automation: {
          claimId,
          claimGeneration: claim.generation!,
          purpose,
          sourceNotes: 'Verified source manifest',
        },
        dryRun: false,
        ...(options.manifest.sourceEvidence[0]
          ? { sourceReference: options.manifest.sourceEvidence[0].url }
          : {}),
        ...(options.manifest.cover ? { usageBasis: options.manifest.cover.usageBasis } : {}),
      };
      const accepted = decodeAutomationJobResponse(
        await jsonPost('/metadata-jobs', body, [202], true),
      );
      if (!accepted.job || accepted.admissionResults[0]?.status !== 'accepted') fail('admission');
      if (binding && options.stateFile) {
        const result = accepted.job.items.find((item) => item.originalTrackId === binding.trackId);
        checkpointId3OrganizationBatch(options.stateFile, binding.trackId, {
          kind: 'metadata',
          jobId: accepted.job.id,
          resultRevision: result?.resultRevision ?? null,
          serverStage: result?.stage ?? accepted.job.status,
        });
      }
      return accepted;
    } finally {
      await call(
        '/curation-claims/' + encodeURIComponent(claimId),
        { method: 'DELETE' },
        [204],
        true,
      );
    }
  }
  if (options.command === 'organization-submit') {
    const binding = batchBinding();
    if (
      binding &&
      (!['metadata_accepted', 'organization_accepted'].includes(binding.state) ||
        binding.metadataJobId !== options.metadataJobId ||
        (binding.resultRevision !== null && binding.resultRevision !== options.revision) ||
        (options.operationId !== undefined &&
          options.operationId !== binding.operations.organization))
    )
      fail('journal_binding');
    const evidence = decodeEvidence(options.sourceEvidence ?? options.manifest?.sourceEvidence);
    const accepted = decodeOrganizationJobResponse(
      await jsonPost(
        '/metadata-organization-jobs',
        {
          ...target(),
          destinationPolicy: 'id3-managed-v1',
          operationId: binding?.operations.organization ?? options.operationId ?? randomUUID(),
          metadataJobId: required(options.metadataJobId, 'metadata_job'),
          sourceEvidence: evidence,
        },
        [202],
        true,
      ),
    );
    if (binding && options.stateFile)
      checkpointId3OrganizationBatch(options.stateFile, binding.trackId, {
        kind: 'organization',
        jobId: accepted.job.id,
        newTrackId: accepted.job.newTrackId,
        serverStage: accepted.job.stage,
      });
    if (!options.poll) return accepted;
    const completed = {
      schemaVersion: 1,
      job: await pollOrganization(accepted.job, options.poll),
    };
    if (binding && options.stateFile)
      checkpointId3OrganizationBatch(options.stateFile, binding.trackId, {
        kind: 'organization',
        jobId: completed.job.id,
        newTrackId: completed.job.newTrackId,
        serverStage: completed.job.stage,
      });
    return completed;
  }
  if (options.command === 'status') {
    const binding = batchBinding();
    if (binding && binding.organizationJobId !== options.jobId) fail('journal_binding');
    const first = decodeOrganizationJobResponse(
      await call(
        '/metadata-organization-jobs/' + encodeURIComponent(required(options.jobId, 'job')),
      ),
    );
    const result = options.poll
      ? { schemaVersion: 1 as const, job: await pollOrganization(first.job, options.poll) }
      : first;
    if (binding && options.stateFile)
      checkpointId3OrganizationBatch(options.stateFile, binding.trackId, {
        kind: 'organization',
        jobId: result.job.id,
        newTrackId: result.job.newTrackId,
        serverStage: result.job.stage,
      });
    return result;
  }
  if (options.command === 'retry')
    return decodeOrganizationJobResponse(
      await jsonPost(
        '/metadata-organization-jobs/' +
          encodeURIComponent(required(options.jobId, 'job')) +
          '/retries',
        { operationId: options.operationId ?? randomUUID() },
        [202],
        true,
      ),
    );
  return fail('command');

  async function pollOrganization(initial: OrganizationJob, poll: PollOptions) {
    if (
      !Number.isSafeInteger(poll.attempts) ||
      poll.attempts < 1 ||
      poll.attempts > 600 ||
      !Number.isSafeInteger(poll.intervalMs) ||
      poll.intervalMs < 0 ||
      poll.intervalMs > 60000 ||
      !Number.isSafeInteger(poll.recoveryRetries) ||
      poll.recoveryRetries < 0 ||
      poll.recoveryRetries > 3
    )
      fail('poll');
    let job = initial;
    const retriedOwners = new Set<string>();
    for (let attempt = 0; attempt < poll.attempts; attempt++) {
      if (job.stage === 'succeeded') return job;
      if (['failed', 'conflict'].includes(job.stage)) fail('job_terminal');
      if (job.stage === 'recovery_required') {
        if (!job.nextOwner) fail('recovery_required');
        if (!retriedOwners.has(job.nextOwner)) {
          if (retriedOwners.size >= poll.recoveryRetries) fail('recovery_required');
          retriedOwners.add(job.nextOwner);
          job = decodeOrganizationJobResponse(
            await jsonPost(
              '/metadata-organization-jobs/' + encodeURIComponent(job.id) + '/retries',
              { operationId: randomUUID() },
              [202],
              true,
            ),
          ).job;
        }
      }
      await sleep(poll.intervalMs);
      job = decodeOrganizationJobResponse(
        await call('/metadata-organization-jobs/' + encodeURIComponent(job.id)),
      ).job;
    }
    return fail('job_timeout');
  }
}

function parseArgs(argv: string[]) {
  const command = argv[0] as Id3OrganizeCommandOptions['command'];
  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) fail('arguments');
    values.set(key.slice(2), value);
  }
  const manifest = values.get('manifest')
    ? readPrivateManifest(resolve(values.get('manifest')!))
    : undefined;
  const result: Id3OrganizeCommandOptions = {
    command,
    api: required(values.get('api'), 'api'),
    tokenFile: resolve(required(values.get('token-file'), 'private_token')),
  };
  const optional = [
    ['title', 'title'],
    ['library-id', 'libraryId'],
    ['track-id', 'trackId'],
    ['revision', 'revision'],
    ['job-id', 'jobId'],
    ['metadata-job-id', 'metadataJobId'],
    ['operation-id', 'operationId'],
    ['cover-upload-id', 'coverUploadId'],
    ['state-file', 'stateFile'],
    ['playlist-id', 'playlistId'],
    ['skip-reason', 'skipReason'],
  ] as const;
  for (const [flag, property] of optional) {
    const value = values.get(flag);
    if (value) result[property] = value;
  }
  const source = values.get('source');
  if (source !== undefined) {
    if (!['favorites', 'playlist'].includes(source)) fail('source');
    result.source = source as 'favorites' | 'playlist';
  }
  if (manifest) result.manifest = manifest;
  if (values.get('poll-attempts'))
    result.poll = {
      attempts: Number(values.get('poll-attempts')),
      intervalMs: Number(values.get('poll-interval-ms') ?? 1000),
      recoveryRetries: Number(values.get('recovery-retries') ?? 1),
    };
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runId3OrganizeCommand(parseArgs(process.argv.slice(2)));
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    process.stderr.write(
      /^client_failed:[a-z0-9_]+$/.test(message) ? message + '\n' : 'client_failed:unknown\n',
    );
    process.exitCode = 1;
  }
}
