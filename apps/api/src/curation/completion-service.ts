import {
  decodeCurationCompletion,
  decodeCurationReopen,
  type CurationCompletionRequest,
  type CurationReopenRequest,
  type CurationFailureReason,
  type MusicEntry,
} from '@musiclatte/contracts';
import { ApiError, type SessionService } from '../auth/session-service.js';
import {
  checkMetadataPrincipal,
  isTokenPrincipal,
  rejectMetadataUpstream,
  type MetadataPrincipal,
} from '../auth/metadata-principal.js';
import { canEditMetadata } from '../metadata/policy.js';
import type { MetadataTagSnapshot } from '../metadata/helper-client.js';
import { createCurationClaimService } from './claim-service.js';
import { curationSnapshot, reconcileVerifiedSnapshot } from './reconciliation.js';
import type { CurationScope } from '../storage/curation-repository.js';
const fail = (reason: CurationFailureReason, status = 409): never => {
  throw new ApiError(
    status,
    status === 503 ? 'upstream_unavailable' : status === 422 ? 'invalid_request' : 'conflict',
    reason,
  );
};
export function verifyRequiredProjection(snapshot: MetadataTagSnapshot, song: MusicEntry) {
  const normalized = (value: string) => value.normalize('NFC').trim();
  const actual = curationSnapshot(snapshot);
  if (!actual.requiredFingerprint) fail('required_fields_missing', 422);
  if (
    normalized(song.title) !== actual.title ||
    !actual.artist.includes(normalized(song.artist ?? ''))
  )
    fail('reflection_pending');
  return actual;
}
export function createCurationCompletionService(service: SessionService) {
  const claims = createCurationClaimService(service);
  const { query: q, provider: p, publications } = claims;
  const repo = q.repository;
  const config = service.options.automation!;
  const db = config.database.connection;
  const fence = config.curation!.fence!;
  function requireReview(principal: MetadataPrincipal) {
    if (isTokenPrincipal(principal) && !principal.accessToken.scopes.includes('curation:write'))
      throw new ApiError(403, 'forbidden');
  }
  function operation(scope: CurationScope, route: string, id: string, body: unknown) {
    try {
      return repo.operation(scope.actorKey, route, id, body);
    } catch {
      throw new ApiError(409, 'conflict');
    }
  }
  function baseline(scope: CurationScope, id: string, body: CurationCompletionRequest) {
    const own = db
      .prepare('SELECT * FROM curation_claims WHERE id=? AND actor_key=?')
      .get(body.claimId, scope.actorKey);
    if (!own) throw new ApiError(404, 'not_found');
    if (
      own.released_at !== null ||
      Number(own.created_at) > config.clock() ||
      Number(own.lease_until) <= config.clock() ||
      own.claim_epoch !==
        db.prepare('SELECT claim_epoch FROM curation_state WHERE singleton=1').get()!.claim_epoch
    )
      fail('claim_expired');
    try {
      return claims.assertClaimForMutation(
        scope,
        body.claimId,
        body.claimGeneration,
        id,
        'required_review',
        [],
      );
    } catch {
      return fail('claimed_by_other');
    }
  }
  function jobs(fileIdentity: string, revision: string, digest: string) {
    const pending = db
      .prepare(
        "SELECT stage FROM metadata_items WHERE file_identity=? AND stage IN ('queued','preparing','backed_up','prepared','file_saved','reflecting','recovery_required') LIMIT 1",
      )
      .get(fileIdentity);
    if (pending)
      fail(
        ['file_saved', 'reflecting'].includes(String(pending.stage))
          ? 'reflection_pending'
          : 'pending_job',
      );
    if (!digest) return null;
    const latest = db
      .prepare(
        'SELECT id,stage,expected_revision,expected_digest,result_revision,file_saved_at FROM metadata_items WHERE file_identity=? ORDER BY rowid DESC LIMIT 1',
      )
      .get(fileIdentity);
    if (!latest || latest.stage === 'succeeded') return null;
    if (['failed', 'conflict'].includes(String(latest.stage))) {
      if (
        latest.file_saved_at === null &&
        latest.expected_revision === revision &&
        latest.expected_digest === digest
      )
        return String(latest.id);
      fail('failed_job');
    }
    return null;
  }
  function consumeClaim(id: string, trackRef: string) {
    db.prepare('DELETE FROM curation_claim_items WHERE claim_id=? AND track_ref=?').run(
      id,
      trackRef,
    );
    db.prepare(
      'UPDATE curation_claims SET released_at=?,generation=generation+1 WHERE id=? AND NOT EXISTS(SELECT 1 FROM curation_claim_items WHERE claim_id=?)',
    ).run(config.clock(), id, id);
  }
  async function completeTrack(
    principal: MetadataPrincipal,
    trackId: string,
    body: CurationCompletionRequest,
  ) {
    requireReview(principal);
    const scope = await q.scope(principal);
    const trackRef = q.trackRef(scope, trackId);
    const route = 'complete:' + trackId;
    const previous = operation(scope, route, body.operationId, body);
    if (previous) return decodeCurationCompletion(previous);
    if (body.policyVersion !== q.policy().policy.policyVersion) fail('policy_changed');
    const bound = baseline(scope, trackRef, body);
    if (bound.expected_revision !== body.expectedRevision) fail('revision_conflict');
    try {
      return await fence.withMediaFence(String(bound.file_identity), 'verify', async (held) => {
        const generation = publications.begin(held.fileIdentity, held.nonce);
        jobs(held.fileIdentity, body.expectedRevision, '');
        publications.assertAvailable(held.fileIdentity, scope.actorKey);
        const file = await p.resolver.resolve(principal, trackId, 'read');
        if (!canEditMetadata(config.policy, principal.identity.username, file.libraryId))
          throw new ApiError(403, 'forbidden');
        if (
          file.fileIdentity !== held.fileIdentity ||
          file.bindingRevision !== bound.binding_revision
        )
          fail('identity_changed');
        if (file.fileRevision !== body.expectedRevision) fail('revision_conflict');
        const snapshot = await p.helper.read({ key: file.relativeFileKey });
        if (!snapshot.editable) fail('file_unavailable', 422);
        if (snapshot.fullDigest !== file.inspection.digest) fail('revision_conflict');
        if (!curationSnapshot(snapshot).requiredFingerprint) fail('required_fields_missing', 422);
        let indexed;
        try {
          indexed = await principal.upstream.recentSong(trackId);
        } catch (error) {
          return rejectMetadataUpstream(service, principal, error);
        }
        if (
          indexed.song.id !== trackId ||
          indexed.song.isDir ||
          indexed.path !== file.relativeFileKey
        )
          fail('identity_changed');
        const actual = verifyRequiredProjection(snapshot, indexed.song);
        if (repo.rowFor(trackRef)!.audio_identity !== actual.audioIdentity)
          fail('identity_changed');
        await claims.current(principal, scope);
        await held.validate();
        const after = await p.fileAccess.inspect(file.relativeFileKey);
        if (
          after.digest !== snapshot.fullDigest ||
          after.inode !== file.inspection.inode ||
          after.ctimeNs !== file.inspection.ctimeNs
        )
          fail('revision_conflict');
        return repo.atomic(() => {
          checkMetadataPrincipal(service, principal);
          held.assertHeld();
          publications.validate(generation);
          const replay = operation(scope, route, body.operationId, body);
          if (replay) return decodeCurationCompletion(replay);
          if (body.policyVersion !== q.policy().policy.policyVersion) fail('policy_changed');
          const current = baseline(scope, trackRef, body);
          if (
            current.expected_revision !== file.fileRevision ||
            current.binding_revision !== file.bindingRevision
          )
            fail('revision_conflict');
          const failed = jobs(held.fileIdentity, file.fileRevision, snapshot.fullDigest);
          publications.assertAvailable(held.fileIdentity, scope.actorKey);
          reconcileVerifiedSnapshot(repo, trackRef, snapshot, file.fileRevision, []);
          if (failed)
            repo.event(
              trackRef,
              'failed_intent_not_applied',
              { itemId: failed, verifiedRevision: file.fileRevision },
              'resolved-failure:' + failed + ':' + file.fileRevision,
            );
          const row = repo.rowFor(trackRef)!;
          const receipt =
            row.base_status === 'completed' && row.receipt_id
              ? repo.get(trackRef)!.receipt!
              : repo.complete(
                  trackRef,
                  {
                    username: principal.identity.username,
                    credentialKind: principal.kind,
                    tokenId: isTokenPrincipal(principal) ? principal.accessToken.id : null,
                    clientLabel: isTokenPrincipal(principal) ? principal.accessToken.name : null,
                  },
                  body.sourceNotes,
                );
          consumeClaim(body.claimId, trackRef);
          publications.recordMediaPublication(generation, snapshot.fullDigest);
          publications.reconcile(generation);
          const result = decodeCurationCompletion({
            schemaVersion: 1,
            curation: repo.get(trackRef),
            receipt,
          });
          repo.recordOperation(scope.actorKey, route, body.operationId, body, result);
          return result;
        });
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof Error && ['file_busy', 'fence_lost'].includes(error.message))
        fail('pending_job');
      fail('file_unavailable', 503);
    }
  }
  async function reopenTrack(
    principal: MetadataPrincipal,
    trackId: string,
    body: CurationReopenRequest,
  ) {
    requireReview(principal);
    const scope = await q.scope(principal);
    const trackRef = q.trackRef(scope, trackId);
    const route = 'reopen:' + trackId;
    const previous = operation(scope, route, body.operationId, body);
    if (previous) return decodeCurationReopen(previous);
    const row = repo.rowFor(trackRef)!;
    if (!row.file_identity) fail('file_unavailable', 503);
    try {
      return await fence.withMediaFence(String(row.file_identity), 'verify', async (held) => {
        const generation = publications.begin(held.fileIdentity, held.nonce);
        const available = () => {
          const claim = repo.activeClaim(trackRef);
          if (claim && claim.actor_key !== scope.actorKey) fail('claimed_by_other');
          publications.assertAvailable(held.fileIdentity, scope.actorKey);
        };
        available();
        const file = await p.resolver.resolve(principal, trackId, 'read');
        if (!canEditMetadata(config.policy, principal.identity.username, file.libraryId))
          throw new ApiError(403, 'forbidden');
        if (
          file.fileIdentity !== held.fileIdentity ||
          file.bindingRevision !== row.binding_revision
        )
          fail('identity_changed');
        if (file.fileRevision !== body.expectedRevision) fail('revision_conflict');
        const snapshot = await p.helper.read({ key: file.relativeFileKey });
        if (snapshot.fullDigest !== file.inspection.digest) fail('revision_conflict');
        await claims.current(principal, scope);
        await held.validate();
        const after = await p.fileAccess.inspect(file.relativeFileKey);
        if (
          after.digest !== snapshot.fullDigest ||
          after.inode !== file.inspection.inode ||
          after.ctimeNs !== file.inspection.ctimeNs
        )
          fail('revision_conflict');
        return repo.atomic(() => {
          checkMetadataPrincipal(service, principal);
          held.assertHeld();
          publications.validate(generation);
          const replay = operation(scope, route, body.operationId, body);
          if (replay) return decodeCurationReopen(replay);
          available();
          reconcileVerifiedSnapshot(repo, trackRef, snapshot, file.fileRevision, []);
          repo.transition(trackRef, { type: 'reopened' });
          repo.event(trackRef, 'review_requested', {
            reason: body.reason,
            actorRef: scope.actorKey,
          });
          const claim = repo.activeClaim(trackRef);
          if (claim) consumeClaim(String(claim.id), trackRef);
          const result = decodeCurationReopen({ schemaVersion: 1, curation: repo.get(trackRef) });
          repo.recordOperation(scope.actorKey, route, body.operationId, body, result);
          return result;
        });
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof Error && ['file_busy', 'fence_lost'].includes(error.message))
        fail('pending_job');
      fail('file_unavailable', 503);
    }
  }
  return { completeTrack, reopenTrack, verifyRequiredProjection };
}
