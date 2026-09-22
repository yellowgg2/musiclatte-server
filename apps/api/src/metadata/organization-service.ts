import { createHash, randomUUID } from 'node:crypto';
import {
  metadataFields,
  type MusicEntry,
  type MetadataField,
  type OrganizationJobRequest,
  type OrganizationPreviewRequest,
  type OrganizationTargetReplacementRequest,
  type OrganizationSelectionRequest,
  type OrganizationSelectionSource,
  type OrganizationReferenceRestoreRequest,
  type OrganizationStatusRequest,
  type UnorganizedSelectionRequest,
  decodeOrganizationStatusResponse,
} from '@musiclatte/contracts';
import { ApiError, type SessionService } from '../auth/session-service.js';
import {
  checkMetadataPrincipal,
  metadataCredentialFingerprint,
  revalidateMetadataPrincipal,
  type MetadataPrincipal,
} from '../auth/metadata-principal.js';
import type { verifyAccessTokenPrincipal } from '../auth/metadata-principal.js';
import { createMetadataProvider, metadataReady } from './provider.js';
import { planOrganizationPath } from './organization-path.js';
import { createOrganizationRepository } from '../storage/organization-repository.js';
import { createMetadataJobAuthorizer } from '../auth/metadata-job-authorizer.js';
import { curationSnapshot } from '../curation/reconciliation.js';
import { createOrganizationCandidates } from './organization-candidates.js';
import { rejectMetadataUpstream } from '../auth/metadata-principal.js';
import { isOrganizationAlbumProjectionPending } from './organization-album-projection.js';
import { createOrganizationSelection } from './organization-selection.js';
import { createUnorganizedLibrarySelection } from './organization-selection.js';
import { createOrganizationSelectionRepository } from '../storage/organization-selection-repository.js';
import { defaultOrganizationSelectionLimits } from '../automation/config.js';
import { captureMetadataReferences, decodeMetadataReferences } from './reference-check.js';
import { restoreMetadataReferencesForSuccessor } from './reference-restoration.js';
import { transientSqliteContention } from '../storage/sqlite-contention.js';

type Principal = Awaited<ReturnType<typeof verifyAccessTokenPrincipal>>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}

export function createOrganizationService(service: SessionService) {
  const automation = service.options.automation;
  const organization = automation?.organization;
  const metadata = service.options.metadata;
  if (!automation || !organization || !metadata) throw new ApiError(403, 'forbidden');
  const provider = createMetadataProvider(service);
  const repository = createOrganizationRepository({
    database: automation.database,
    clock: automation.clock,
  });
  const selectionSnapshots = automation.curation
    ? createOrganizationSelectionRepository({
        database: automation.database,
        clock: automation.clock,
        cursorKey: service.options.signingKey,
        limits: organization.policy.selection ?? defaultOrganizationSelectionLimits,
      })
    : null;
  const grants = createMetadataJobAuthorizer({
    database: automation.database,
    vault: automation.vault,
  });
  const db = automation.database.connection;
  const successorLineage = (oldTrackId: string, newTrackId: string) => {
    type Edge = {
      itemId: string;
      libraryId: string;
      mediaLinkId: string;
      oldTrackId: string;
      newTrackId: string;
      displacedTrackId: string | null;
    };
    type Path = { traversed: string[]; predecessorTrackIds: string[]; edges: Edge[] };
    const paths: Path[] = [];
    const stack: Array<{
      trackId: string;
      traversed: string[];
      predecessorTrackIds: string[];
      edges: Edge[];
    }> = [{ trackId: oldTrackId, traversed: [], predecessorTrackIds: [], edges: [] }];
    while (stack.length) {
      const current = stack.pop()!;
      if (current.edges.length >= 16) continue;
      const rows = db
        .prepare(
          "SELECT i.id AS itemId,j.library_id AS libraryId,i.media_link_id AS mediaLinkId,i.old_track_id AS oldTrackId,i.new_track_id AS newTrackId,r.displaced_track_id AS displacedTrackId FROM organization_items i JOIN organization_jobs j ON j.id=i.job_id LEFT JOIN organization_target_replacements r ON r.item_id=i.id WHERE (i.old_track_id=? OR r.displaced_track_id=?) AND i.stage='succeeded' ORDER BY i.stage_changed_at,i.id",
        )
        .all(current.trackId, current.trackId) as Edge[];
      for (const edge of rows) {
        if (
          (edge.oldTrackId !== current.trackId && edge.displacedTrackId !== current.trackId) ||
          current.traversed.includes(edge.newTrackId)
        )
          continue;
        const next: Path = {
          traversed: [...current.traversed, current.trackId],
          predecessorTrackIds: [
            ...new Set(
              [
                ...current.predecessorTrackIds,
                current.trackId,
                edge.oldTrackId,
                edge.displacedTrackId,
              ].filter((trackId): trackId is string => trackId !== null),
            ),
          ],
          edges: [...current.edges, edge],
        };
        if (edge.newTrackId === newTrackId) paths.push(next);
        else
          stack.push({
            trackId: edge.newTrackId,
            traversed: next.traversed,
            predecessorTrackIds: next.predecessorTrackIds,
            edges: next.edges,
          });
      }
    }
    if (paths.length !== 1) return null;
    const path = paths[0]!;
    if (new Set(path.edges.map(({ libraryId }) => libraryId)).size !== 1) return null;
    return {
      ...path.edges.at(-1)!,
      predecessorTrackIds: path.predecessorTrackIds,
    };
  };
  const matchesSuccessorBinding = (
    successor: { libraryId: string; mediaLinkId: string; newTrackId: string },
    resolved: { libraryId: string; mediaLinkId: string },
  ) => {
    if (resolved.libraryId !== successor.libraryId) return false;
    if (resolved.mediaLinkId === successor.mediaLinkId) return true;
    type Handoff = { libraryId: string; mediaLinkId: string };
    type Path = { mediaLinkId: string; traversed: string[]; depth: number };
    const matches: Path[] = [];
    const stack: Path[] = [{ mediaLinkId: successor.mediaLinkId, traversed: [], depth: 0 }];
    while (stack.length) {
      const current = stack.pop()!;
      if (current.depth >= 16) continue;
      const rows = db
        .prepare(
          "SELECT j.library_id AS libraryId,i.media_link_id AS mediaLinkId FROM organization_target_replacements r JOIN organization_items i ON i.id=r.item_id JOIN organization_jobs j ON j.id=i.job_id WHERE r.displaced_media_link_id=? AND r.displaced_track_id=? AND i.new_track_id=? AND i.stage='succeeded' ORDER BY i.stage_changed_at,i.id",
        )
        .all(current.mediaLinkId, successor.newTrackId, successor.newTrackId) as Handoff[];
      for (const row of rows) {
        if (row.libraryId !== successor.libraryId || current.traversed.includes(row.mediaLinkId))
          continue;
        const next = {
          mediaLinkId: row.mediaLinkId,
          traversed: [...current.traversed, current.mediaLinkId],
          depth: current.depth + 1,
        };
        if (row.mediaLinkId === resolved.mediaLinkId) matches.push(next);
        else stack.push(next);
      }
    }
    return matches.length === 1;
  };
  const hash = (purpose: string, value: unknown) =>
    createHash('sha256')
      .update(service.sign(`organization-${purpose}`, JSON.stringify(canonical(value))))
      .digest('hex');
  const available = () => {
    if (!metadataReady(metadata) || organization.ready?.() !== true)
      throw new ApiError(503, 'upstream_unavailable');
  };
  const selectionError = (error: unknown): never => {
    if (error instanceof ApiError) throw error;
    const code = error instanceof Error ? error.message : '';
    if (['invalid_cursor', 'invalid_limit'].includes(code))
      throw new ApiError(400, 'invalid_request');
    if (code === 'snapshot_scope_changed') throw new ApiError(409, code);
    if (code === 'snapshot_expired') throw new ApiError(409, code);
    if (code === 'snapshot_capacity') throw new ApiError(503, code);
    throw error;
  };
  const selectionScope = (principal: Principal, allowedLibraryIds: readonly string[]) => ({
    actorTokenId: principal.accessToken.id,
    scopeHash: hash('unorganized-selection-scope', [
      principal.instanceId,
      principal.actorIdentityKey,
      principal.accessToken.id,
      [...principal.accessToken.scopes].sort(),
      [...allowedLibraryIds].sort(),
      principal.policyRevision,
    ]),
  });
  const publicJob = (job: NonNullable<ReturnType<typeof repository.getJob>>) => ({
    id: job.id,
    itemId: job.item.itemId,
    libraryId: job.libraryId,
    trackId: job.item.oldTrackId,
    newTrackId: job.item.newTrackId,
    stage: job.item.stage,
    errorCode: job.item.errorCode,
    nextOwner: job.item.nextOwner,
  });
  const scopedJob = (principal: Principal, id: string) => {
    checkMetadataPrincipal(service, principal);
    const row = db
      .prepare(
        'SELECT j.identity_key,j.library_id,j.actor_token_id FROM organization_jobs j WHERE j.id=?',
      )
      .get(id);
    if (
      !row ||
      row.identity_key !== principal.actorIdentityKey ||
      row.actor_token_id !== principal.accessToken.id ||
      !principal.allowedLibraries.includes(String(row.library_id))
    )
      throw new ApiError(404, 'not_found');
    const job = repository.getJob(id, principal.actorIdentityKey);
    if (!job) throw new ApiError(404, 'not_found');
    return job;
  };
  const inspect = async (principal: Principal, body: OrganizationPreviewRequest) => {
    available();
    const file = await provider.resolver.resolve(principal, body.trackId, 'read');
    if (!service.matches(file.fileRevision, body.expectedRevision))
      throw new ApiError(409, 'conflict');
    const snapshot = await provider.helper.read({ key: file.relativeFileKey });
    if (snapshot.fullDigest !== file.inspection.digest) throw new ApiError(409, 'conflict');
    const library = metadata.policy.libraries.find((entry) => entry.id === file.libraryId);
    if (!library || !principal.allowedLibraries.includes(library.id))
      throw new ApiError(403, 'forbidden');
    const plan = planOrganizationPath({
      musicRoot: metadata.runtime.musicRoot,
      libraryId: file.libraryId,
      ownerUsername: principal.identity.username,
      allowedLibraryIds: principal.allowedLibraries,
      relativeRoot: library.relativeRoot,
      sourceKey: file.relativeFileKey,
      accounts: organization.policy.accounts,
      values: snapshot.values,
    });
    checkMetadataPrincipal(service, principal);
    return { file, snapshot, plan };
  };
  const validatedIntent = async (
    principal: Principal,
    body: OrganizationJobRequest,
    expectedStatus: 'ready' | 'no_op',
    operationIdHash: string,
    requestHash: string,
    ids: { id: string; itemId: string },
  ) => {
    const { file, snapshot, plan } = await inspect(principal, body);
    if (plan.status !== expectedStatus) throw new ApiError(422, 'invalid_request');
    const metadataItem = db
      .prepare(
        'SELECT i.id,i.result_revision,i.changed_fields_json,i.stage,i.error_code,e.reflection_json,j.identity_key,j.library_id FROM metadata_items i JOIN metadata_jobs j ON j.id=i.job_id LEFT JOIN metadata_item_evidence e ON e.item_id=i.id WHERE j.id=? AND i.actor_token_id=? AND i.current_track_id=?',
      )
      .get(body.metadataJobId, principal.accessToken.id, body.trackId);
    let changed: MetadataField[] = [];
    try {
      changed = JSON.parse(String(metadataItem?.changed_fields_json)) as MetadataField[];
    } catch {
      changed = [];
    }
    if (
      !metadataItem ||
      (metadataItem.stage !== 'succeeded' && !isOrganizationAlbumProjectionPending(metadataItem)) ||
      metadataItem.identity_key !== principal.actorIdentityKey ||
      metadataItem.library_id !== file.libraryId ||
      metadataItem.result_revision !== file.fileRevision
    )
      throw new ApiError(422, 'invalid_request');
    const present = new Set<MetadataField>([
      ...(snapshot.values.title ? (['title'] as const) : []),
      ...(snapshot.values.artist.length ? (['artist'] as const) : []),
      ...(snapshot.values.album ? (['album'] as const) : []),
      ...(snapshot.values.albumArtist.length ? (['albumArtist'] as const) : []),
      ...(snapshot.values.trackNumber ? (['trackNumber'] as const) : []),
      ...(snapshot.values.year ? (['year'] as const) : []),
      ...(snapshot.values.genre.length ? (['genre'] as const) : []),
      ...(snapshot.coverFrames.length ? (['cover'] as const) : []),
      ...(snapshot.lyricsFrames.length ? (['lyrics'] as const) : []),
    ]);
    const evidenced = new Set(body.sourceEvidence.flatMap((entry) => entry.fields));
    if (
      changed.some((field) => !evidenced.has(field)) ||
      [...evidenced].some(
        (field) =>
          !metadataFields.includes(field) || (!changed.includes(field) && !present.has(field)),
      ) ||
      (changed.includes('lyrics') && !principal.accessToken.scopes.includes('lyrics:write'))
    )
      throw new ApiError(422, 'invalid_request');
    for (const evidence of body.sourceEvidence) {
      const url = new URL(evidence.url);
      if (url.protocol !== 'https:' || url.username || url.password)
        throw new ApiError(422, 'invalid_request');
    }
    await revalidateMetadataPrincipal(service, principal);
    return {
      ...ids,
      identityKey: principal.actorIdentityKey,
      libraryId: file.libraryId,
      operationIdHash,
      requestHash,
      actorTokenId: principal.accessToken.id,
      policyRevision: principal.policyRevision,
      policyVersion: 'id3-managed-v1' as const,
      metadataJobId: body.metadataJobId,
      metadataRevision: file.fileRevision,
      sourceEvidence: body.sourceEvidence,
      mediaLinkId: file.mediaLinkId,
      sourceKey: file.relativeFileKey,
      targetKey: plan.targetKey,
      oldTrackId: file.trackId,
      fileIdentity: file.fileIdentity,
      audioIdentity: curationSnapshot(snapshot).audioIdentity,
    };
  };
  return {
    async unorganizedSelection(
      principal: Principal,
      _body: UnorganizedSelectionRequest,
      signal?: AbortSignal,
    ) {
      available();
      if (!selectionSnapshots) throw new ApiError(503, 'upstream_unavailable');
      const allowedLibraryIds = await provider.allowedLibraries(principal, signal);
      await revalidateMetadataPrincipal(service, principal);
      try {
        return createUnorganizedLibrarySelection({
          database: automation.database,
          organization: repository,
          snapshots: selectionSnapshots,
          allowedLibraryIds,
          actorTokenId: principal.accessToken.id,
          scopeHash: selectionScope(principal, allowedLibraryIds).scopeHash,
          currentPolicyVersion: organization.policy.policyVersion,
          revision: (value) => hash('unorganized-inventory', value),
          ...(signal ? { signal } : {}),
        });
      } catch (error) {
        return selectionError(error);
      }
    },
    async unorganizedSelectionPage(
      principal: Principal,
      input: { selectionId: string; cursor: string; limit?: string },
      signal?: AbortSignal,
    ) {
      available();
      if (!selectionSnapshots) throw new ApiError(503, 'upstream_unavailable');
      signal?.throwIfAborted();
      const allowedLibraryIds = await provider.allowedLibraries(principal, signal);
      await revalidateMetadataPrincipal(service, principal);
      try {
        return selectionSnapshots.page({
          scope: selectionScope(principal, allowedLibraryIds),
          selectionId: input.selectionId,
          cursor: input.cursor,
          ...(input.limit ? { limit: Number(input.limit) } : {}),
        });
      } catch (error) {
        return selectionError(error);
      }
    },
    async statuses(
      principal: MetadataPrincipal,
      body: OrganizationStatusRequest,
      signal?: AbortSignal,
    ) {
      available();
      signal?.throwIfAborted();
      const allowedLibraryIds = await provider.allowedLibraries(principal, signal);
      signal?.throwIfAborted();
      const items = repository.readOrganizationStatuses({
        targets: body.targets,
        allowedLibraryIds,
        currentPolicyVersion: organization.policy.policyVersion,
        ...(signal ? { signal } : {}),
      });
      await revalidateMetadataPrincipal(service, principal);
      signal?.throwIfAborted();
      return decodeOrganizationStatusResponse({
        schemaVersion: 1,
        capturedAt: automation.clock(),
        items,
      });
    },
    async referenceSnapshot(principal: Principal, body: { trackId: string }, signal?: AbortSignal) {
      available();
      await provider.resolver.resolve(principal, body.trackId, 'read');
      try {
        const references = await captureMetadataReferences(
          principal.upstream,
          body.trackId,
          signal,
        );
        await revalidateMetadataPrincipal(service, principal);
        return { schemaVersion: 1 as const, ...references };
      } catch (error) {
        if (error instanceof ApiError) throw error;
        return rejectMetadataUpstream(service, principal, error);
      }
    },
    async restoreReferences(
      principal: Principal,
      body: OrganizationReferenceRestoreRequest,
      signal?: AbortSignal,
    ) {
      available();
      let baseline;
      try {
        baseline = decodeMetadataReferences({
          trackId: body.trackId,
          starred: body.starred,
          playlists: body.playlists,
        });
      } catch {
        throw new ApiError(422, 'invalid_request');
      }
      const successor = successorLineage(body.trackId, body.newTrackId);
      if (!successor || !principal.allowedLibraries.includes(successor.libraryId))
        throw new ApiError(422, 'invalid_request');
      const identityReused = body.trackId === body.newTrackId;
      if (identityReused && successor.displacedTrackId !== body.trackId)
        throw new ApiError(422, 'invalid_request');
      const resolved = await provider.resolver.resolve(principal, body.newTrackId, 'read');
      if (!matchesSuccessorBinding(successor, resolved)) throw new ApiError(409, 'conflict');
      await revalidateMetadataPrincipal(service, principal);
      try {
        const restored = await restoreMetadataReferencesForSuccessor({
          client: principal.upstream,
          username: principal.identity.username,
          baseline,
          newTrackId: body.newTrackId,
          predecessorTrackIds: successor.predecessorTrackIds,
          allowIdentityReuse: identityReused,
          ...(signal ? { signal } : {}),
        });
        await revalidateMetadataPrincipal(service, principal);
        return {
          schemaVersion: 1 as const,
          trackId: body.trackId,
          newTrackId: body.newTrackId,
          starred: restored.starred,
          playlistsRestored: restored.playlists.length,
        };
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (error instanceof Error && error.message === 'reference_conflict')
          throw new ApiError(409, 'conflict');
        return rejectMetadataUpstream(service, principal, error);
      }
    },
    async selection(
      principal: Principal,
      body: OrganizationSelectionRequest,
      signal?: AbortSignal,
    ) {
      available();
      let source: OrganizationSelectionSource;
      let songs: MusicEntry[];
      try {
        if (body.source.kind === 'favorites') {
          source = { kind: 'favorites' };
          songs = await principal.upstream.getStarred2(signal ? { signal } : undefined);
        } else {
          const playlist = await principal.upstream.getPlaylist(
            body.source.playlistId,
            signal ? { signal } : undefined,
          );
          source = {
            kind: 'playlist',
            playlistId: playlist.id,
            name: playlist.name,
          };
          songs = playlist.entry;
          await revalidateMetadataPrincipal(service, principal);
          if (
            playlist.id !== body.source.playlistId ||
            playlist.owner !== principal.identity.username
          )
            throw new ApiError(404, 'not_found');
          return createOrganizationSelection({
            capturedAt: automation.clock(),
            source,
            songs,
            actorCredentialFingerprint: metadataCredentialFingerprint(principal),
            revision: (value) => hash('selection', value),
          });
        }
      } catch (error) {
        if (error instanceof ApiError) throw error;
        return rejectMetadataUpstream(service, principal, error);
      }
      await revalidateMetadataPrincipal(service, principal);
      return createOrganizationSelection({
        capturedAt: automation.clock(),
        source,
        songs,
        actorCredentialFingerprint: metadataCredentialFingerprint(principal),
        revision: (value) => hash('selection', value),
      });
    },
    async candidateList(
      principal: Principal,
      query: { title: string; libraryId?: string; limit?: string },
    ) {
      available();
      const limit = Number(query.limit ?? 10);
      if (query.libraryId && !principal.allowedLibraries.includes(query.libraryId))
        throw new ApiError(403, 'forbidden');
      const candidates = createOrganizationCandidates({
        database: db,
        libraries: metadata.policy.libraries,
        search: async (title, musicFolderId, count) => {
          try {
            return (
              await principal.upstream.search(title, {
                musicFolderId,
                artistCount: 0,
                albumCount: 0,
                songCount: count,
              })
            ).song;
          } catch (error) {
            return rejectMetadataUpstream(service, principal, error);
          }
        },
        resolve: (trackId) => provider.resolver.resolve(principal, trackId, 'read'),
      });
      const result = await candidates.list({
        title: query.title.trim(),
        ...(query.libraryId ? { libraryId: query.libraryId } : {}),
        limit,
        allowedLibraryIds: principal.allowedLibraries,
      });
      await revalidateMetadataPrincipal(service, principal);
      return result;
    },
    async preview(principal: Principal, body: OrganizationPreviewRequest) {
      const { file, plan } = await inspect(principal, body);
      return {
        schemaVersion: 1 as const,
        trackId: file.trackId,
        libraryId: file.libraryId,
        currentRevision: file.fileRevision,
        currentKey: plan.currentKey,
        targetKey: plan.status === 'error' ? null : plan.targetKey,
        writeGuaranteed: false as const,
        status: plan.status,
        code: plan.status === 'error' ? plan.code : null,
      };
    },
    async submit(principal: Principal, body: OrganizationJobRequest) {
      const operationIdHash = hash('operation', [
        metadataCredentialFingerprint(principal),
        body.operationId,
      ]);
      const requestHash = hash('request', body);
      const replay = db
        .prepare(
          'SELECT id,request_hash FROM organization_jobs WHERE identity_key=? AND operation_id_hash=?',
        )
        .get(principal.actorIdentityKey, operationIdHash);
      const replayJob = replay
        ? repository.getJob(String(replay.id), principal.actorIdentityKey)
        : null;
      if (replay) {
        if (replay.request_hash !== requestHash) throw new ApiError(409, 'conflict');
        if (
          !replayJob ||
          replayJob.item.stage !== 'failed' ||
          !transientSqliteContention(replayJob.item.errorCode) ||
          replayJob.item.newTrackId !== null
        )
          return {
            schemaVersion: 1 as const,
            job: publicJob(scopedJob(principal, String(replay.id))),
          };
      }
      const intent = await validatedIntent(principal, body, 'ready', operationIdHash, requestHash, {
        id: replayJob?.id ?? randomUUID(),
        itemId: replayJob?.item.itemId ?? randomUUID(),
      });
      const grant = grants.createOrganizationGrant(principal, intent);
      const job = repository.createOrReplay({ ...intent, ...grant });
      return { schemaVersion: 1 as const, job: publicJob(job) };
    },
    async adoptNoOp(principal: Principal, body: OrganizationJobRequest) {
      const operationIdHash = hash('no-op-operation', [
        metadataCredentialFingerprint(principal),
        body.operationId,
      ]);
      const requestHash = hash('no-op-request', body);
      const replay = db
        .prepare(
          'SELECT id,request_hash FROM organization_jobs WHERE identity_key=? AND operation_id_hash=?',
        )
        .get(principal.actorIdentityKey, operationIdHash);
      if (replay) {
        if (replay.request_hash !== requestHash) throw new ApiError(409, 'conflict');
        return {
          schemaVersion: 1 as const,
          job: publicJob(scopedJob(principal, String(replay.id))),
        };
      }
      const intent = await validatedIntent(principal, body, 'no_op', operationIdHash, requestHash, {
        id: randomUUID(),
        itemId: randomUUID(),
      });
      const job = repository.createOrReplayNoOp(intent);
      return { schemaVersion: 1 as const, job: publicJob(job) };
    },
    detail(principal: Principal, id: string) {
      return { schemaVersion: 1 as const, job: publicJob(scopedJob(principal, id)) };
    },
    async retry(principal: Principal, id: string, body: { operationId: string }) {
      const job = scopedJob(principal, id);
      const requestHash = hash('retry-request', [id, body]);
      await revalidateMetadataPrincipal(service, principal);
      const result = repository.requestRetry({
        itemId: job.item.itemId,
        identityKey: principal.actorIdentityKey,
        operationIdHash: hash('retry-operation', [
          metadataCredentialFingerprint(principal),
          body.operationId,
        ]),
        requestHash,
      });
      return { schemaVersion: 1 as const, job: publicJob(result) };
    },
    async approveTargetReplacement(
      principal: Principal,
      id: string,
      body: OrganizationTargetReplacementRequest,
    ) {
      const job = scopedJob(principal, id);
      await revalidateMetadataPrincipal(service, principal);
      try {
        repository.approveTargetReplacement({
          itemId: job.item.itemId,
          operationIdHash: hash('target-replacement-operation', [
            metadataCredentialFingerprint(principal),
            body.operationId,
          ]),
          requestHash: hash('target-replacement-request', [id, body]),
          displacedTrackId: body.displacedTrackId,
          backupReceiptDigest: body.backupReceiptDigest,
          referenceSnapshotDigests: body.referenceSnapshotDigests,
        });
      } catch (error) {
        if (error instanceof Error && error.message === 'conflict')
          throw new ApiError(409, 'conflict');
        throw error;
      }
      return {
        schemaVersion: 1 as const,
        job: publicJob(scopedJob(principal, id)),
      };
    },
  };
}
