import { createHash, randomUUID } from 'node:crypto';
import {
  metadataFields,
  type MusicEntry,
  type MetadataField,
  type OrganizationJobRequest,
  type OrganizationPreviewRequest,
  type OrganizationSelectionRequest,
  type OrganizationSelectionSource,
} from '@musiclatte/contracts';
import { ApiError, type SessionService } from '../auth/session-service.js';
import {
  checkMetadataPrincipal,
  metadataCredentialFingerprint,
  revalidateMetadataPrincipal,
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
  const grants = createMetadataJobAuthorizer({
    database: automation.database,
    vault: automation.vault,
  });
  const db = automation.database.connection;
  const hash = (purpose: string, value: unknown) =>
    createHash('sha256')
      .update(service.sign(`organization-${purpose}`, JSON.stringify(canonical(value))))
      .digest('hex');
  const available = () => {
    if (!metadataReady(metadata) || organization.ready?.() !== true)
      throw new ApiError(503, 'upstream_unavailable');
  };
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
  return {
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
      if (replay) {
        if (replay.request_hash !== requestHash) throw new ApiError(409, 'conflict');
        return {
          schemaVersion: 1 as const,
          job: publicJob(scopedJob(principal, String(replay.id))),
        };
      }
      const { file, snapshot, plan } = await inspect(principal, body);
      if (plan.status !== 'ready') throw new ApiError(422, 'invalid_request');
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
        (metadataItem.stage !== 'succeeded' &&
          !isOrganizationAlbumProjectionPending(metadataItem)) ||
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
      const intent = {
        id: randomUUID(),
        itemId: randomUUID(),
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
      const grant = grants.createOrganizationGrant(principal, intent);
      const job = repository.createOrReplay({ ...intent, ...grant });
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
  };
}
