import {
  metadataCredentialFingerprint,
  revalidateMetadataPrincipal,
  metadataContext,
  metadataSession,
  isTokenPrincipal,
} from '../auth/metadata-principal.js';
import { restoreState } from './backup-preview.js';
import { createHash, randomUUID } from 'node:crypto';
import {
  metadataFields,
  decodeMetadataRestoreState,
  decodeMetadataRestorePreview,
  decodeMetadataSnapshot,
  type MetadataJob,
  type MetadataJobRequest,
  type MetadataPatch,
  type MetadataSnapshot,
  type MetadataTarget,
} from '@musiclatte/contracts';
import { ApiError, type SessionService } from '../auth/session-service.js';
import {
  createMetadataRepository,
  type ValidatedMetadataItem,
  type ValidatedMetadataRequest,
} from '../storage/metadata-repository.js';
import { createMetadataProvider, metadataReady } from './provider.js';
import type { VerifiedMetadataSession as Verified, ResolvedMetadataFile } from './resolver.js';
import { createMetadataCoverService } from './cover-service.js';
import { canEditMetadata } from './policy.js';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}
export function createMetadataService(service: SessionService) {
  const p = createMetadataProvider(service);
  const { options, identity, hash } = p;
  const db = options.database.connection;
  const repository = createMetadataRepository(options);
  let coverService: ReturnType<typeof createMetadataCoverService> | undefined;
  const getCovers = () => (coverService ??= createMetadataCoverService(service, p));
  const available = () => {
    if (!metadataReady(options)) throw new ApiError(503, 'upstream_unavailable');
  };
  const scopedJob = async (v: Verified, id: string): Promise<MetadataJob> => {
    if (
      isTokenPrincipal(v) &&
      !db
        .prepare('SELECT 1 FROM metadata_items WHERE job_id=? AND actor_token_id=?')
        .get(id, v.accessToken.id)
    )
      throw new ApiError(404, 'not_found');
    const job = repository.getJob(id, identity(v));
    if (!job || !(await p.allowedLibraries(v)).includes(job.libraryId))
      throw new ApiError(404, 'not_found');
    const library = options.policy.libraries.find((entry) => entry.id === job.libraryId)!;
    const editAllowed = canEditMetadata(options.policy, v.identity.username, job.libraryId);
    const restoreAllowed =
      !isTokenPrincipal(v) &&
      v.identity.adminRole &&
      options.policy.restoreManagers.includes(v.identity.username) &&
      library.writeProfile === 'exclusive' &&
      library.preserveOwnership;
    for (const item of job.items) {
      item.restoreAvailable = item.restoreAvailable && restoreAllowed;
      item.recoveryActions = item.recoveryActions.filter(
        (action) =>
          action === 'refresh' ||
          (!isTokenPrincipal(v) && (action === 'restore' ? restoreAllowed : editAllowed)),
      );
    }
    return job;
  };
  const requestKey = (v: Verified, operationId: string, intent: unknown) => ({
    identityKey: identity(v),
    operationIdHash: hash(
      'operation',
      isTokenPrincipal(v) ? [metadataCredentialFingerprint(v), operationId] : operationId,
    ),
    requestHash: hash('request', canonical(intent)),
  });
  const replay = async (v: Verified, key: ReturnType<typeof requestKey>) => {
    if (
      db
        .prepare('SELECT 1 FROM metadata_rechecks WHERE identity_key=? AND operation_id_hash=?')
        .get(key.identityKey, key.operationIdHash)
    )
      throw new ApiError(409, 'conflict');
    const row = db
      .prepare(
        'SELECT id,request_hash FROM metadata_jobs WHERE identity_key=? AND operation_id_hash=?',
      )
      .get(key.identityKey, key.operationIdHash);
    if (!row) return null;
    if (row.request_hash !== key.requestHash) throw new ApiError(409, 'conflict');
    return scopedJob(v, String(row.id));
  };
  const resolved = async (v: Verified, target: MetadataTarget, mode: 'edit' | 'restore') => {
    const file = await p.resolver.resolve(v, target.trackId, mode);
    if (
      !isTokenPrincipal(v) &&
      db
        .prepare(
          'SELECT 1 FROM curation_claim_items i JOIN curation_claims c ON c.id=i.claim_id JOIN curation_state s ON s.claim_epoch=c.claim_epoch WHERE i.file_identity=? AND c.released_at IS NULL AND c.created_at<=? AND c.lease_until>? LIMIT 1',
        )
        .get(file.fileIdentity, options.clock(), options.clock())
    )
      throw new ApiError(409, 'conflict');
    if (!service.matches(file.fileRevision, target.expectedRevision))
      throw new ApiError(409, 'conflict');
    available();
    if (!file.editable) throw new ApiError(422, 'invalid_request');
    return file;
  };
  const validate = async (v: Verified, targets: MetadataTarget[], patch: MetadataPatch) => {
    if (
      !targets.length ||
      targets.length > options.policy.limits.maxTargets ||
      new Set(targets.map((target) => target.trackId)).size !== targets.length
    )
      throw new ApiError(400, 'invalid_request');
    const files: ResolvedMetadataFile[] = [];
    for (const target of targets) files.push(await resolved(v, target, 'edit'));
    if (
      new Set(files.map((file) => file.libraryId)).size !== 1 ||
      new Set(files.map((file) => file.fileIdentity)).size !== files.length
    )
      throw new ApiError(400, 'invalid_request');
    const libraryId = files[0]!.libraryId;
    const cover =
      patch.cover?.op === 'set'
        ? getCovers().resolve(v, patch.cover.uploadId, libraryId)
        : undefined;
    for (const file of files)
      await p.helper.preview({
        key: file.relativeFileKey,
        expectedDigest: file.inspection.digest,
        patch,
        ...(cover ? { cover } : {}),
      });
    return files;
  };
  const item = (
    v: Verified,
    file: ResolvedMetadataFile,
    patch: MetadataPatch,
  ): ValidatedMetadataItem => ({
    id: randomUUID(),
    mediaLinkId: file.mediaLinkId,
    fileIdentity: file.fileIdentity,
    bindingRevision: file.bindingRevision,
    trackId: file.trackId,
    expectedRevision: file.fileRevision,
    expectedDigest: file.inspection.digest,
    actorSessionId: createHash('sha256').update(metadataSession(v).raw).digest('hex'),
    policyRevision: metadataContext(v).policyRevision,
    patch,
  });
  const frameHandle = (v: Verified, file: ResolvedMetadataFile, frameId: string) =>
    `${frameId}.${file.fileRevision}.${service.sign('metadata-frame', JSON.stringify([p.credentialIdentity(v), file.trackId, file.fileRevision, frameId]))}`;
  return {
    provider: p,
    get covers() {
      return getCovers();
    },
    async read(v: Verified, trackId: string): Promise<MetadataSnapshot> {
      const file = await p.resolver.resolve(v, trackId, 'read');
      if (file.reason === 'unsupported_format')
        return {
          schemaVersion: 1,
          trackId,
          editable: false,
          reason: file.reason,
          format: 'unsupported',
          supportedFields: [],
          fileRevision: file.fileRevision,
          values: {
            title: null,
            album: null,
            artist: [],
            albumArtist: [],
            genre: [],
            year: null,
            trackNumber: null,
          },
          coverFrames: [],
          lyricsFrames: [],
          lastVerifiedAt: options.clock(),
        };
      const snapshot = await p.helper.read({ key: file.relativeFileKey });
      if (snapshot.fullDigest !== file.inspection.digest) throw new ApiError(409, 'conflict');
      const claimed =
        !isTokenPrincipal(v) &&
        db
          .prepare(
            'SELECT 1 FROM curation_claim_items i JOIN curation_claims c ON c.id=i.claim_id JOIN curation_state s ON s.claim_epoch=c.claim_epoch WHERE i.file_identity=? AND c.released_at IS NULL AND c.created_at<=? AND c.lease_until>? LIMIT 1',
          )
          .get(file.fileIdentity, options.clock(), options.clock());
      const editable = file.editable && snapshot.editable && !claimed;
      return decodeMetadataSnapshot({
        schemaVersion: 1,
        trackId,
        editable,
        reason: claimed ? 'claimed_by_other' : editable ? null : (file.reason ?? 'read_only'),
        format: 'mp3',
        supportedFields: snapshot.editable ? [...metadataFields] : [],
        fileRevision: file.fileRevision,
        values: snapshot.values,
        coverFrames: snapshot.coverFrames
          .filter((frame) => ['image/png', 'image/jpeg'].includes(frame.mimeType))
          .map((frame) => {
            const id = frameHandle(v, file, frame.frameId);
            return {
              frameId: id,
              description: frame.description,
              pictureType: frame.pictureType,
              mimeType: frame.mimeType,
              previewUrl: `/api/v1/tracks/${encodeURIComponent(trackId)}/metadata/cover/${encodeURIComponent(id)}`,
            };
          }),
        lyricsFrames: snapshot.lyricsFrames,
        lastVerifiedAt: options.clock(),
      });
    },
    async frame(v: Verified, trackId: string, handle: string) {
      const file = await p.resolver.resolve(v, trackId, 'read');
      const [frameId] = handle.split('.');
      if (
        !frameId ||
        !/^[a-f0-9]{64}$/.test(frameId) ||
        !service.matches(handle, frameHandle(v, file, frameId))
      )
        throw new ApiError(404, 'not_found');
      return p.helper.cover({
        key: file.relativeFileKey,
        expectedDigest: file.inspection.digest,
        frameId,
      });
    },
    async intent(v: Verified, id: string, itemId: string) {
      const job = await scopedJob(v, id);
      const item = job.items.find((item) => item.itemId === itemId);
      if (!item) throw new ApiError(404, 'not_found');
      const row = db
        .prepare('SELECT patch_json FROM metadata_items WHERE id=? AND job_id=?')
        .get(itemId, id)!;
      return {
        targets: [{ trackId: item.currentTrackId, expectedRevision: item.previousRevision }],
        patch: JSON.parse(String(row.patch_json)) as MetadataPatch,
      };
    },
    async preview(v: Verified, body: Pick<MetadataJobRequest, 'targets' | 'patch'>) {
      const files = await validate(v, body.targets, body.patch);
      return {
        schemaVersion: 1 as const,
        libraryId: files[0]!.libraryId,
        targetCount: files.length,
        changedFields: Object.keys(body.patch),
        targets: files.map((file) => ({ trackId: file.trackId, fileRevision: file.fileRevision })),
        writeGuaranteed: false as const,
      };
    },
    async submit(v: Verified, body: MetadataJobRequest) {
      const key = requestKey(v, body.operationId, ['edit', body]);
      const existing = await replay(v, key);
      if (existing) return { schemaVersion: 1 as const, job: existing };
      const files = await validate(v, body.targets, body.patch);
      await revalidateMetadataPrincipal(service, v);
      const request: ValidatedMetadataRequest = {
        ...key,
        id: randomUUID(),
        libraryId: files[0]!.libraryId,
        items: files.map((file) => item(v, file, body.patch)),
        ...(body.sourceReference ? { sourceReference: body.sourceReference } : {}),
        ...(body.usageBasis ? { usageBasis: body.usageBasis } : {}),
      };
      const job = repository.createOrReplay(request);
      return { schemaVersion: 1 as const, job: await scopedJob(v, job.id) };
    },
    async detail(v: Verified, id: string) {
      return { schemaVersion: 1 as const, job: await scopedJob(v, id) };
    },
    async recheck(v: Verified, id: string, body: { operationId: string; itemIds: string[] }) {
      const parent = await scopedJob(v, id);
      const key = requestKey(v, body.operationId, ['recheck', id, body]);
      const prior = db
        .prepare(
          'SELECT request_hash,job_id FROM metadata_rechecks WHERE identity_key=? AND operation_id_hash=?',
        )
        .get(key.identityKey, key.operationIdHash);
      if (prior) {
        if (prior.request_hash !== key.requestHash || prior.job_id !== id)
          throw new ApiError(409, 'conflict');
        return { schemaVersion: 1 as const, job: parent };
      }
      if (body.itemIds.some((itemId) => !parent.items.some((entry) => entry.itemId === itemId)))
        throw new ApiError(404, 'not_found');
      if (!canEditMetadata(options.policy, v.identity.username, parent.libraryId))
        throw new ApiError(403, 'forbidden');
      available();
      repository.recheck({
        ...key,
        jobId: id,
        itemIds: body.itemIds,
        actorSessionId: createHash('sha256').update(metadataSession(v).raw).digest('hex'),
        policyRevision: metadataContext(v).policyRevision,
      });
      return { schemaVersion: 1 as const, job: await scopedJob(v, id) };
    },
    async list(v: Verified, query: { cursor?: string; limit?: string }) {
      const libraries = await p.allowedLibraries(v);
      const scope = [
        p.credentialIdentity(v),
        metadataContext(v).policyRevision,
        options.policy,
        libraries,
      ];
      let before: [number, string] = [Number.MAX_SAFE_INTEGER, '\uffff'];
      const wrap = (value: [number, string]) => {
        const raw = Buffer.from(JSON.stringify(value)).toString('base64url');
        return `${raw}.${service.sign('metadata-jobs-cursor', JSON.stringify([scope, raw]))}`;
      };
      if (query.cursor) {
        try {
          const value = JSON.parse(
            Buffer.from(query.cursor.split('.')[0]!, 'base64url').toString(),
          );
          if (
            !Array.isArray(value) ||
            value.length !== 2 ||
            !Number.isSafeInteger(value[0]) ||
            value[0] < 0 ||
            typeof value[1] !== 'string' ||
            !service.matches(query.cursor, wrap(value as [number, string]))
          )
            throw new Error();
          before = value as [number, string];
        } catch {
          throw new ApiError(400, 'invalid_request');
        }
      }
      const limit = Number(query.limit ?? 25);
      const rows = db
        .prepare(
          'SELECT id,created_at FROM metadata_jobs WHERE identity_key=? AND library_id IN (SELECT value FROM json_each(?)) AND (? IS NULL OR EXISTS(SELECT 1 FROM metadata_items i WHERE i.job_id=metadata_jobs.id AND i.actor_token_id=?)) AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?',
        )
        .all(
          identity(v),
          JSON.stringify(libraries),
          isTokenPrincipal(v) ? v.accessToken.id : null,
          isTokenPrincipal(v) ? v.accessToken.id : null,
          before[0],
          before[0],
          before[1],
          limit + 1,
        );
      const page = rows.slice(0, limit);
      const jobs: MetadataJob[] = [];
      for (const row of page) jobs.push(await scopedJob(v, String(row.id)));
      const last = page.at(-1);
      return {
        schemaVersion: 1 as const,
        jobs,
        nextCursor:
          rows.length > limit && last ? wrap([Number(last.created_at), String(last.id)]) : null,
      };
    },
    async retry(
      v: Verified,
      id: string,
      body: { operationId: string; items: { itemId: string; expectedRevision: string }[] },
    ) {
      const key = requestKey(v, body.operationId, ['retry', id, body]);
      const existing = await replay(v, key);
      if (existing) return { schemaVersion: 1 as const, job: existing };
      const parent = await scopedJob(v, id);
      if (
        body.items.length > options.policy.limits.maxTargets ||
        new Set(body.items.map((entry) => entry.itemId)).size !== body.items.length
      )
        throw new ApiError(400, 'invalid_request');
      const items: ValidatedMetadataItem[] = [];
      for (const entry of body.items) {
        const old = parent.items.find((candidate) => candidate.itemId === entry.itemId);
        if (!old) throw new ApiError(404, 'not_found');
        if (!['failed', 'conflict'].includes(old.stage) || old.fileSavedAt !== null)
          throw new ApiError(409, 'conflict');
        const row = db
          .prepare('SELECT patch_json FROM metadata_items WHERE id=? AND job_id=?')
          .get(old.itemId, id)!;
        const patch = JSON.parse(String(row.patch_json)) as MetadataPatch;
        const files = await validate(
          v,
          [{ trackId: old.currentTrackId, expectedRevision: entry.expectedRevision }],
          patch,
        );
        items.push(item(v, files[0]!, patch));
      }
      await revalidateMetadataPrincipal(service, v);
      const job = repository.retryFailed({
        request: { ...key, id: randomUUID(), libraryId: parent.libraryId, items },
        parentJobId: id,
        itemIds: body.items.map((entry) => entry.itemId),
      });
      return { schemaVersion: 1 as const, job: await scopedJob(v, job.id) };
    },
    async restorePreview(v: Verified, id: string, itemId: string) {
      const job = await scopedJob(v, id);
      const item = job.items.find((item) => item.itemId === itemId);
      if (!item) throw new ApiError(404, 'not_found');
      if (!item.restoreAvailable) throw new ApiError(403, 'forbidden');
      const row = db
        .prepare(
          'SELECT b.created_at,p.summary_json FROM metadata_backups b LEFT JOIN metadata_backup_previews p ON p.backup_id=b.id WHERE b.item_id=? AND b.identity_key=? AND b.library_id=?',
        )
        .get(itemId, identity(v), job.libraryId);
      if (!row?.summary_json) throw new ApiError(503, 'upstream_unavailable');
      const file = await p.resolver.resolve(v, item.currentTrackId, 'restore');
      const actual = await p.helper.read({ key: file.relativeFileKey });
      if (actual.fullDigest !== file.inspection.digest) throw new ApiError(409, 'conflict');
      await revalidateMetadataPrincipal(service, v);
      const state = restoreState(actual);
      return decodeMetadataRestorePreview({
        schemaVersion: 1,
        jobId: id,
        itemId,
        backupCreatedAt: Number(row.created_at),
        original: decodeMetadataRestoreState(JSON.parse(String(row.summary_json))),
        currentCovers: state.covers,
        current: {
          schemaVersion: 1,
          trackId: item.currentTrackId,
          editable: false,
          reason: 'read_only',
          format: 'mp3',
          supportedFields: [],
          fileRevision: file.fileRevision,
          values: actual.values,
          coverFrames: [],
          lyricsFrames: actual.lyricsFrames,
          lastVerifiedAt: options.clock(),
        },
      });
    },
    async restore(
      v: Verified,
      id: string,
      body: { operationId: string; itemId: string; currentExpectedRevision: string },
    ) {
      const key = requestKey(v, body.operationId, ['restore', id, body]);
      const existing = await replay(v, key);
      if (existing) return { schemaVersion: 1 as const, job: existing };
      const parent = await scopedJob(v, id);
      const old = parent.items.find((entry) => entry.itemId === body.itemId);
      if (!old) throw new ApiError(404, 'not_found');
      if (!old.restoreAvailable)
        throw new ApiError(
          v.identity.adminRole && options.policy.restoreManagers.includes(v.identity.username)
            ? 409
            : 403,
          v.identity.adminRole && options.policy.restoreManagers.includes(v.identity.username)
            ? 'conflict'
            : 'forbidden',
        );
      const file = await resolved(
        v,
        { trackId: old.currentTrackId, expectedRevision: body.currentExpectedRevision },
        'restore',
      );
      await revalidateMetadataPrincipal(service, v);
      const job = repository.createRestore({
        request: {
          ...key,
          id: randomUUID(),
          libraryId: parent.libraryId,
          items: [item(v, file, {})],
        },
        parentJobId: id,
        itemId: old.itemId,
      });
      return { schemaVersion: 1 as const, job: await scopedJob(v, job.id) };
    },
  };
}
export type MetadataService = ReturnType<typeof createMetadataService>;
