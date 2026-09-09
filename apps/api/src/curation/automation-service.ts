import { createHash, randomUUID } from 'node:crypto';
import {
  decodeAutomationDryRun,
  decodeAutomationJobResponse,
  decodeMetadataAttemptResponse,
  type AutomationJobRequest,
  type AutomationDryRun,
  type AutomationAdmission,
  type AutomationFailureReason,
  type CurationField,
  type MetadataAttemptRequest,
} from '@musiclatte/contracts';
import { ApiError, type SessionService } from '../auth/session-service.js';
import {
  checkMetadataPrincipal,
  isTokenPrincipal,
  metadataContext,
  type MetadataPrincipal,
} from '../auth/metadata-principal.js';
import { createMetadataJobAuthorizer } from '../auth/metadata-job-authorizer.js';
import {
  createMetadataRepository,
  type ValidatedMetadataItem,
} from '../storage/metadata-repository.js';
import { createMetadataService } from '../metadata/service.js';
import { metadataReady } from '../metadata/provider.js';
import type { HeldMediaFence, PublicationFence } from '../metadata/media-fence.js';
import { createCurationClaimService } from './claim-service.js';
import { curationSnapshot, reconcileVerifiedSnapshot } from './reconciliation.js';
interface StoredJob {
  jobId: string | null;
  claimId: string;
  admissionResults: AutomationAdmission[];
}
export function createAutomationService(service: SessionService) {
  const claims = createCurationClaimService(service);
  const { query: q, provider: p, publications } = claims;
  const repo = q.repository;
  const config = service.options.automation!;
  const fence = config.curation!.fence!;
  const db = config.database.connection;
  const metadata = createMetadataService(service);
  const jobs = createMetadataRepository(p.options);
  const authorizer = createMetadataJobAuthorizer(config);
  function operation(actor: string, route: string, id: string, intent: unknown) {
    try {
      return repo.operation(actor, route, id, intent);
    } catch {
      throw new ApiError(409, 'conflict');
    }
  }
  function requiredWrite(principal: MetadataPrincipal, fields: readonly string[]) {
    if (
      isTokenPrincipal(principal) &&
      (!principal.accessToken.scopes.includes('metadata:write') ||
        (fields.includes('lyrics') && !principal.accessToken.scopes.includes('lyrics:write')))
    )
      throw new ApiError(403, 'forbidden');
  }
  function failure(error: unknown): AutomationFailureReason {
    if (error instanceof ApiError) {
      if ([401, 403, 503].includes(error.status)) throw error;
      if (error.status === 404) return 'not_found';
      if (error.status === 409) return 'claim_conflict';
      if (error.status === 422) return 'unsupported_format';
    }
    const code = error instanceof Error ? error.message : '';
    if (['file_busy', 'fence_lost'].includes(code)) return 'file_busy';
    if (['revision_conflict', 'inventory_pending', 'unsupported_format'].includes(code))
      return code as AutomationFailureReason;
    return 'invalid_metadata';
  }
  async function response(principal: MetadataPrincipal, saved: StoredJob) {
    const job = saved.jobId ? (await metadata.detail(principal, saved.jobId)).job : null;
    return decodeAutomationJobResponse({
      schemaVersion: 1,
      job,
      admissionResults: saved.admissionResults,
    });
  }
  async function submitAutomationJob(principal: MetadataPrincipal, body: AutomationJobRequest) {
    const fields = Object.keys(body.patch) as CurationField[];
    requiredWrite(principal, fields);
    claims.requirePurpose(principal, body.automation.purpose, fields);
    if (!metadataReady(p.options)) throw new ApiError(503, 'upstream_unavailable');
    if (
      !body.targets.length ||
      body.targets.length > q.limits.maxTargets ||
      new Set(body.targets.map((t) => t.trackId)).size !== body.targets.length
    )
      throw new ApiError(400, 'invalid_request');
    const scope = await q.scope(principal);
    if (!body.dryRun) {
      const saved = operation(scope.actorKey, 'write', body.operationId, body) as StoredJob | null;
      if (saved) return await response(principal, saved);
    }
    const locks: HeldMediaFence[] = [];
    const generations: PublicationFence[] = [];
    const accepted: {
      item: ValidatedMetadataItem;
      trackRef: string;
      libraryId: string;
      key: string;
      held: HeldMediaFence;
    }[] = [];
    const admission: AutomationAdmission[] = [];
    const results: AutomationDryRun['results'] = [];
    try {
      for (const target of body.targets) {
        try {
          const trackRef = q.trackRef(scope, target.trackId);
          const baseline = claims.assertClaimForMutation(
            scope,
            body.automation.claimId,
            body.automation.claimGeneration,
            trackRef,
            body.automation.purpose,
            fields,
          );
          if (baseline.expected_revision !== target.expectedRevision)
            throw new Error('revision_conflict');
          const held = await fence.acquire(String(baseline.file_identity), 'verify');
          locks.push(held);
          if (!body.dryRun) generations.push(publications.begin(held.fileIdentity, held.nonce));
          publications.assertAvailable(held.fileIdentity, scope.actorKey);
          const file = await p.resolver.resolve(principal, target.trackId, 'edit');
          if (
            file.fileIdentity !== held.fileIdentity ||
            file.bindingRevision !== baseline.binding_revision ||
            file.fileRevision !== target.expectedRevision
          )
            throw new Error('revision_conflict');
          if (!file.editable) throw new ApiError(422, 'invalid_request');
          const cover =
            body.patch.cover?.op === 'set'
              ? metadata.covers.resolve(principal, body.patch.cover.uploadId, file.libraryId)
              : undefined;
          const diff = await p.helper.preview({
            key: file.relativeFileKey,
            expectedDigest: file.inspection.digest,
            patch: body.patch,
            ...(cover ? { cover } : {}),
          });
          await held.validate();
          const item: ValidatedMetadataItem = {
            id: randomUUID(),
            mediaLinkId: file.mediaLinkId,
            fileIdentity: file.fileIdentity,
            bindingRevision: file.bindingRevision,
            trackId: file.trackId,
            expectedRevision: file.fileRevision,
            expectedDigest: file.inspection.digest,
            policyRevision: metadataContext(principal).policyRevision,
            patch: body.patch,
            actorSessionId: isTokenPrincipal(principal)
              ? null
              : createHash('sha256').update(principal.session.raw).digest('hex'),
          };
          accepted.push({
            item,
            trackRef,
            libraryId: file.libraryId,
            key: file.relativeFileKey,
            held,
          });
          results.push({
            trackId: target.trackId,
            status: diff.every((d) => d.status === 'no_change') ? 'no_change' : 'changed',
            diff,
          });
          admission.push({ trackId: target.trackId, status: 'accepted', jobItemId: item.id });
        } catch (error) {
          const reason = failure(error);
          results.push({ trackId: target.trackId, status: 'rejected', diff: [], reason });
          admission.push({ trackId: target.trackId, status: 'rejected', jobItemId: null, reason });
        }
      }
      if (new Set(accepted.map((a) => a.libraryId)).size > 1)
        throw new ApiError(400, 'invalid_request');
      await claims.current(principal, scope);
      if (body.dryRun)
        return decodeAutomationDryRun({
          schemaVersion: 1,
          dryRun: true,
          writeGuaranteed: false,
          results,
        });
      for (const a of accepted) {
        const inspection = await p.fileAccess.inspect(a.key);
        if (inspection.digest !== a.item.expectedDigest) throw new ApiError(409, 'conflict');
        await a.held.validate();
      }
      const saved = repo.atomic(() => {
        checkMetadataPrincipal(service, principal);
        const replay = operation(
          scope.actorKey,
          'write',
          body.operationId,
          body,
        ) as StoredJob | null;
        if (replay) return replay;
        locks.forEach((held) => held.assertHeld());
        generations.forEach(publications.validate);
        const identityKey = p.identity(principal);
        for (const a of accepted) {
          claims.assertClaimForMutation(
            scope,
            body.automation.claimId,
            body.automation.claimGeneration,
            a.trackRef,
            body.automation.purpose,
            fields,
          );
          publications.assertAvailable(a.item.fileIdentity, scope.actorKey);
          if (isTokenPrincipal(principal))
            Object.assign(
              a.item,
              authorizer.createGrant(principal, {
                id: a.item.id,
                mediaLinkId: a.item.mediaLinkId,
                fileIdentity: a.item.fileIdentity,
                bindingRevision: a.item.bindingRevision,
                trackId: a.item.trackId,
                expectedRevision: a.item.expectedRevision,
                expectedDigest: a.item.expectedDigest,
                policyRevision: a.item.policyRevision,
                patch: a.item.patch,
                identityKey,
                libraryId: a.libraryId,
              }),
            );
        }
        const jobId = accepted.length ? randomUUID() : null;
        if (jobId)
          jobs.createOrReplay({
            id: jobId,
            identityKey,
            libraryId: accepted[0]!.libraryId,
            operationIdHash: p.hash('operation', ['automation', scope.actorKey, body.operationId]),
            requestHash: p.hash('request', body),
            items: accepted.map((a) => a.item),
            curationAuthorization: {
              actorKey: scope.actorKey,
              claimId: body.automation.claimId,
              generation: body.automation.claimGeneration,
            },
            ...(body.sourceReference ? { sourceReference: body.sourceReference } : {}),
            ...(body.usageBasis ? { usageBasis: body.usageBasis } : {}),
          });
        const result: StoredJob = {
          jobId,
          claimId: body.automation.claimId,
          admissionResults: admission,
        };
        repo.recordOperation(scope.actorKey, 'write', body.operationId, body, result, admission);
        return result;
      });
      return await response(principal, saved);
    } finally {
      await Promise.all(locks.map((held) => held.release()));
    }
  }
  async function recordMetadataAttempt(
    principal: MetadataPrincipal,
    trackId: string,
    body: MetadataAttemptRequest,
  ) {
    requiredWrite(principal, [body.field]);
    claims.requirePurpose(principal, 'optional_enrichment', [body.field]);
    const scope = await q.scope(principal);
    const trackRef = q.trackRef(scope, trackId);
    const route = 'attempt:' + trackId;
    const saved = operation(scope.actorKey, route, body.operationId, body);
    if (saved) return decodeMetadataAttemptResponse(saved);
    const baseline = claims.assertClaimForMutation(
      scope,
      body.claimId,
      body.claimGeneration,
      trackRef,
      'optional_enrichment',
      [body.field],
    );
    if (baseline.expected_revision !== body.expectedRevision) throw new ApiError(409, 'conflict');
    try {
      return await fence.withMediaFence(String(baseline.file_identity), 'verify', async (held) => {
        const generation = publications.begin(held.fileIdentity, held.nonce);
        publications.assertAvailable(held.fileIdentity, scope.actorKey);
        const file = await p.resolver.resolve(principal, trackId, 'edit');
        if (
          file.fileIdentity !== held.fileIdentity ||
          file.bindingRevision !== baseline.binding_revision ||
          file.fileRevision !== body.expectedRevision
        )
          throw new ApiError(409, 'conflict');
        const snapshot = await p.helper.read({ key: file.relativeFileKey });
        if (!snapshot.editable) throw new ApiError(422, 'invalid_request');
        if (
          snapshot.fullDigest !== file.inspection.digest ||
          curationSnapshot(snapshot).fields[body.field]
        )
          throw new ApiError(409, 'conflict');
        await claims.current(principal, scope);
        const after = await p.fileAccess.inspect(file.relativeFileKey);
        if (after.digest !== snapshot.fullDigest) throw new ApiError(409, 'conflict');
        await held.validate();
        return repo.atomic(() => {
          checkMetadataPrincipal(service, principal);
          held.assertHeld();
          publications.validate(generation);
          const replay = operation(scope.actorKey, route, body.operationId, body);
          if (replay) return decodeMetadataAttemptResponse(replay);
          claims.assertClaimForMutation(
            scope,
            body.claimId,
            body.claimGeneration,
            trackRef,
            'optional_enrichment',
            [body.field],
          );
          publications.assertAvailable(held.fileIdentity, scope.actorKey);
          reconcileVerifiedSnapshot(repo, trackRef, snapshot, file.fileRevision, []);
          const fieldState = repo.attempt(
            trackRef,
            body.field,
            body.status,
            body.reason,
            body.sourceNotes,
            scope.actorKey,
          );
          const result = decodeMetadataAttemptResponse({
            schemaVersion: 1,
            trackId,
            field: body.field,
            fieldState,
          });
          repo.recordOperation(scope.actorKey, route, body.operationId, body, result);
          return result;
        });
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const reason = failure(error);
      throw new ApiError(reason === 'file_busy' ? 409 : 422, 'invalid_request');
    }
  }
  return {
    submitAutomationJob,
    dryRunAutomationPatch: (principal: MetadataPrincipal, body: AutomationJobRequest) =>
      submitAutomationJob(principal, { ...body, dryRun: true }),
    recordMetadataAttempt,
  };
}
