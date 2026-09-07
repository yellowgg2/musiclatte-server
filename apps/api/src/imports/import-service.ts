import { randomUUID } from 'node:crypto';
import {
  importFailureCodes,
  type FeatureCapability,
  type ImportCreateRequest,
  type ImportDetailResponse,
  type ImportItem,
  type ImportJob,
  type ImportListQuery,
  type ImportListResponse,
  type ImportRetryRequest,
} from '@musiclatte/contracts';
import { ApiError, type SessionService } from '../auth/session-service.js';
import type { ManagementDatabase } from '../storage/database.js';
import {
  createImportRepository,
  type ImportJob as StoredJob,
} from '../storage/import-repository.js';
import { createEngineRepository } from '../storage/engine-repository.js';
import { createWorkerStateRepository } from '../storage/worker-state-repository.js';
import type { ImportPolicy } from './policy.js';
import { parseYouTubeSource } from './source-url.js';

export interface ImportOptions {
  database: ManagementDatabase;
  policy: ImportPolicy;
  clock: () => number;
}
type Verified = Awaited<ReturnType<SessionService['verify']>>;
/** Heartbeats at the deadline or in the future are unavailable, without any process/file probe. */
export const importHeartbeatMaxAgeMs = 30_000;
export function importCapability(
  options: ImportOptions | undefined,
  username: string,
): FeatureCapability {
  const supported = options?.policy.enabled === true;
  const allowed =
    supported &&
    options.policy.libraries.some((library) => library.allowedUsers.includes(username));
  if (!allowed) return { supported, permission: 'denied', availability: 'available' };
  const worker = createWorkerStateRepository(options).get();
  const engine = createEngineRepository(options).get();
  const age = worker.heartbeatAt === null ? -1 : options.clock() - worker.heartbeatAt;
  const available =
    age >= 0 &&
    age < importHeartbeatMaxAgeMs &&
    ['idle', 'working'].includes(worker.status) &&
    engine.activeVersion !== null;
  return {
    supported: true,
    permission: 'allowed',
    availability: available ? 'available' : 'temporarily_unavailable',
  };
}

export function createImportService(service: SessionService) {
  const options = service.options.imports;
  const repository = options ? createImportRepository(options) : undefined;
  const fingerprint = (purpose: string, value: unknown) =>
    Buffer.from(service.sign(`import-${purpose}`, JSON.stringify(value)), 'base64url').toString(
      'hex',
    );
  const identity = (v: Verified) =>
    fingerprint('identity', [v.session.instanceId, v.identity.username]);
  const libraries = (v: Verified) =>
    options?.policy.enabled
      ? options.policy.libraries
          .filter((library) => library.allowedUsers.includes(v.identity.username))
          .map((library) => library.id)
          .sort()
      : [];
  const assertAllowed = (v: Verified, libraryId?: string) => {
    const allowed = libraries(v);
    if (!repository || !allowed.length || (libraryId !== undefined && !allowed.includes(libraryId)))
      throw new ApiError(403, 'forbidden');
    return repository;
  };
  const assertAvailable = (v: Verified) => {
    if (importCapability(options, v.identity.username).availability !== 'available')
      throw new ApiError(503, 'upstream_unavailable');
  };
  const handle = (v: Verified, kind: string, raw: string) =>
    `${Buffer.from(raw).toString('base64url')}.${service.sign(`import-${kind}`, JSON.stringify([identity(v), raw]))}`;
  const unwrap = (v: Verified, kind: string, token: string, status: 400 | 404) => {
    const parts = token.split('.');
    const raw = Buffer.from(parts[0] ?? '', 'base64url').toString();
    if (parts.length !== 2 || !raw || !service.matches(handle(v, kind, raw), token))
      throw new ApiError(status, status === 404 ? 'not_found' : 'invalid_request');
    return raw;
  };
  const project = (v: Verified, job: StoredJob): ImportJob => ({
    id: handle(v, 'job', job.id),
    libraryId: job.libraryId,
    createdAt: job.createdAt,
    cancelRequestedAt: job.cancelRequestedAt,
    retryOfJobId: job.retryOfJobId ? handle(v, 'job', job.retryOfJobId) : null,
    status: job.status,
    items: job.items.map((item): ImportItem => ({
      id: handle(v, 'item', item.id),
      sourceId: item.sourceId,
      stage: item.stage,
      ...(item.observedTitle ? { title: item.observedTitle } : {}),
      ...(item.observedChannel ? { channel: item.observedChannel } : {}),
      ...(item.failureCode
        ? {
            failureCode:
              importFailureCodes.find((code) => code === item.failureCode) ?? 'download_failed',
          }
        : {}),
      ...(item.mediaLinkId ? { mediaLinkId: handle(v, 'media', item.mediaLinkId) } : {}),
      ...(item.stage === 'duplicate' && (item.mediaLinkId || item.duplicateOfItemId)
        ? {
            duplicate: item.mediaLinkId
              ? { kind: 'media' as const, id: handle(v, 'media', item.mediaLinkId) }
              : { kind: 'item' as const, id: handle(v, 'item', item.duplicateOfItemId!) },
          }
        : {}),
    })),
  });
  const detail = (v: Verified, job: StoredJob): ImportDetailResponse => ({
    schemaVersion: 1,
    job: project(v, job),
  });
  const get = (v: Verified, token: string) => {
    const id = unwrap(v, 'job', token, 404);
    const job = repository?.getJob(id);
    if (!job || job.identityKey !== identity(v)) throw new ApiError(404, 'not_found');
    assertAllowed(v, job.libraryId);
    return job;
  };
  const result = (v: Verified, value: { outcome: string; job: StoredJob }) => {
    if (value.outcome === 'conflict') throw new ApiError(409, 'conflict');
    return detail(v, value.job);
  };
  const replay = (v: Verified, operationId: string, requestHash: string) => {
    const existing = repository!.findOperation(identity(v), fingerprint('operation', operationId));
    if (!existing) return null;
    if (existing.requestHash !== requestHash) throw new ApiError(409, 'conflict');
    assertAllowed(v, existing.libraryId);
    return detail(v, existing);
  };
  return {
    list(v: Verified, query: ImportListQuery): ImportListResponse {
      const repo = assertAllowed(v);
      const allowed = libraries(v);
      let before: { createdAt: number; id: string } | undefined;
      if (query.cursor) {
        try {
          const parsed = JSON.parse(unwrap(v, 'cursor', query.cursor, 400));
          if (
            !Array.isArray(parsed) ||
            parsed.length !== 3 ||
            JSON.stringify(parsed[0]) !== JSON.stringify(allowed) ||
            !Number.isSafeInteger(parsed[1]) ||
            parsed[1] < 0 ||
            typeof parsed[2] !== 'string'
          )
            throw new Error();
          before = { createdAt: parsed[1], id: parsed[2] };
        } catch {
          throw new ApiError(400, 'invalid_request');
        }
      }
      const limit = Number(query.limit ?? 20);
      const jobs = repo.listJobs(identity(v), allowed, limit + 1, before);
      const page = jobs.slice(0, limit);
      const last = page.at(-1);
      return {
        schemaVersion: 1,
        jobs: page.map((job) => project(v, job)),
        libraries: allowed.map((id) => ({ id })),
        nextCursor:
          jobs.length > limit && last
            ? handle(v, 'cursor', JSON.stringify([allowed, last.createdAt, last.id]))
            : null,
      };
    },
    detail: (v: Verified, id: string) => detail(v, get(v, id)),
    create(v: Verified, input: ImportCreateRequest) {
      const repo = assertAllowed(v, input.libraryId);
      let sources: string[];
      try {
        sources = input.urls.map((url) => parseYouTubeSource(url).videoId);
      } catch {
        throw new ApiError(422, 'invalid_request');
      }
      const requestHash = fingerprint('request', ['create', input.libraryId, sources]);
      const existing = replay(v, input.operationId, requestHash);
      if (existing) return existing;
      assertAvailable(v);
      const id = randomUUID();
      return result(
        v,
        repo.createJob({
          id,
          identityKey: identity(v),
          libraryId: input.libraryId,
          operationIdHash: fingerprint('operation', input.operationId),
          requestHash,
          items: sources.map((sourceId) => ({ id: randomUUID(), sourceId })),
          deduplicate: true,
        }),
      );
    },
    cancel(v: Verified, id: string) {
      const job = get(v, id);
      return detail(v, repository!.requestCancel(job.id));
    },
    retry(v: Verified, id: string, input: ImportRetryRequest) {
      const job = get(v, id);
      const ids = input.itemIds.map((itemId) => unwrap(v, 'item', itemId, 400));
      const selected = job.items.filter((item) => ids.includes(item.id));
      if (selected.length !== ids.length || selected.some((item) => item.stage !== 'failed'))
        throw new ApiError(422, 'invalid_request');
      const requestHash = fingerprint('request', [
        'retry',
        job.id,
        selected.map((item) => item.id),
      ]);
      const existing = replay(v, input.operationId, requestHash);
      if (existing) return existing;
      assertAvailable(v);
      return result(
        v,
        repository!.retryFailed({
          sourceJobId: job.id,
          id: randomUUID(),
          operationIdHash: fingerprint('operation', input.operationId),
          requestHash,
          itemIds: selected.map((item) => item.id),
          deduplicate: true,
        }),
      );
    },
  };
}
