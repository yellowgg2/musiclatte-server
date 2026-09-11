import { createHash, randomUUID } from 'node:crypto';
import {
  decodeCurationClaimResult,
  decodeCurationClaimRenewed,
  optionalCurationFields,
  requiredCurationFields,
  type CurationClaimRequest,
  type CurationClaimResult,
  type ClaimPurpose,
  type CurationField,
  type AccessTokenScope,
} from '@musiclatte/contracts';
import { ApiError, type SessionService } from '../auth/session-service.js';
import {
  checkMetadataPrincipal,
  isTokenPrincipal,
  type MetadataPrincipal,
} from '../auth/metadata-principal.js';
import { createCurationQueryService } from './query-service.js';
import { createMetadataProvider } from '../metadata/provider.js';
import { canEditMetadata } from '../metadata/policy.js';
import {
  createMediaPublicationLedger,
  type PublicationFence,
  type HeldMediaFence,
} from '../metadata/media-fence.js';
import type { CurationScope } from '../storage/curation-repository.js';
interface PendingClaim {
  pending: true;
  id: string;
  createdAt: number;
  leaseUntil: number;
  results: CurationClaimResult['results'];
}
export function createCurationClaimService(service: SessionService) {
  const config = service.options.automation;
  const fence = config?.curation?.fence;
  if (!config?.curation || !fence) throw new ApiError(503, 'upstream_unavailable');
  const q = createCurationQueryService(service);
  const repo = q.repository;
  const p = createMetadataProvider(service);
  const db = config.database.connection;
  const publications = createMediaPublicationLedger(config.database, config.clock);
  const epoch = () =>
    String(
      db.prepare('SELECT claim_epoch FROM curation_state WHERE singleton=1').get()!.claim_epoch,
    );
  const live = (claim: Record<string, unknown>) =>
    claim.claim_epoch === epoch() &&
    claim.released_at === null &&
    Number(claim.created_at) <= config.clock() &&
    Number(claim.lease_until) > config.clock();
  function requirePurpose(
    principal: MetadataPrincipal,
    purpose: ClaimPurpose,
    fields: readonly CurationField[],
  ) {
    const supported: readonly CurationField[] =
      purpose === 'required_review'
        ? requiredCurationFields
        : purpose === 'optional_enrichment'
          ? optionalCurationFields
          : [];
    if (
      !fields.length ||
      new Set(fields).size !== fields.length ||
      fields.some((field) => !supported.includes(field))
    )
      throw new ApiError(400, 'invalid_request');
    if (isTokenPrincipal(principal)) {
      const required: AccessTokenScope[] =
        purpose === 'required_review'
          ? ['curation:write']
          : fields.includes('lyrics')
            ? ['metadata:write', 'lyrics:write']
            : ['metadata:write'];
      if (required.some((scope) => !principal.accessToken.scopes.includes(scope)))
        throw new ApiError(403, 'forbidden');
    }
  }
  async function current(principal: MetadataPrincipal, scope: CurationScope) {
    const fresh =
      principal.kind === 'access_token'
        ? { ...principal, ...(await principal.revalidate()) }
        : { ...principal, ...(await principal.revalidate()) };
    if (JSON.stringify(await q.scope(fresh)) !== JSON.stringify(scope))
      throw new ApiError(403, 'forbidden');
    checkMetadataPrincipal(service, principal);
  }
  function owner(scope: CurationScope, id: string) {
    const claim = db
      .prepare('SELECT * FROM curation_claims WHERE id=? AND actor_key=?')
      .get(id, scope.actorKey);
    if (!claim) throw new ApiError(404, 'not_found');
    return claim;
  }
  function operation(scope: CurationScope, route: string, operationId: string, intent: unknown) {
    try {
      return repo.operation(scope.actorKey, route, operationId, intent);
    } catch {
      throw new ApiError(409, 'conflict');
    }
  }
  function updatePending(
    scope: CurationScope,
    operationId: string,
    value: PendingClaim | CurationClaimResult,
  ) {
    // Match the same hash convention as the repository without ever storing raw operation IDs.
    db.prepare(
      'UPDATE curation_operations SET result_json=? WHERE actor_key=? AND route=? AND operation_hash=?',
    ).run(JSON.stringify(value), scope.actorKey, 'claim', operationIdHash(operationId));
  }
  return {
    query: q,
    provider: p,
    publications,
    current,
    requirePurpose,
    async claimTracks(
      principal: MetadataPrincipal,
      body: CurationClaimRequest,
    ): Promise<CurationClaimResult> {
      requirePurpose(principal, body.purpose, body.fields);
      if (
        !body.targets.length ||
        body.targets.length > q.limits.maxTargets ||
        new Set(body.targets.map((target) => target.trackId)).size !== body.targets.length
      )
        throw new ApiError(400, 'invalid_request');
      const scope = await q.scope(principal);
      const saved = operation(scope, 'claim', body.operationId, body) as
        PendingClaim | CurationClaimResult | null;
      if (saved && !('pending' in saved)) return decodeCurationClaimResult(saved);
      let pending = saved;
      if (!pending)
        pending = repo.atomic(() => {
          const existing = operation(scope, 'claim', body.operationId, body) as PendingClaim | null;
          if (existing) return existing;
          const value: PendingClaim = {
            pending: true,
            id: randomUUID(),
            createdAt: config.clock(),
            leaseUntil: config.clock() + q.limits.claimLeaseMs,
            results: [],
          };
          repo.recordOperation(scope.actorKey, 'claim', body.operationId, body, value);
          return value;
        });
      const pendingId = pending.id;
      for (const target of body.targets) {
        const latest = operation(scope, 'claim', body.operationId, body) as
          PendingClaim | CurationClaimResult;
        if (!('pending' in latest)) return decodeCurationClaimResult(latest);
        if (latest.results.some((result) => result.trackId === target.trackId)) continue;
        let status: CurationClaimResult['results'][number]['status'] = 'not_found';
        try {
          const id = q.trackRef(scope, target.trackId);
          const row = repo.rowFor(id)!;
          if (!canEditMetadata(config.policy, principal.identity.username, String(row.library_id)))
            throw new ApiError(403, 'forbidden');
          if (!row.file_identity || row.validation !== 'verified' || row.binding_revision === null)
            status = 'inventory_pending';
          else
            await fence.withMediaFence(String(row.file_identity), 'verify', async (held) => {
              const publication = publications.begin(held.fileIdentity, held.nonce);
              const active = repo.activeClaim(id);
              if (active && active.id !== pendingId) {
                if (active.actor_key === scope.actorKey) throw new ApiError(409, 'conflict');
                status = 'claimed_by_other';
                return;
              }
              try {
                publications.assertAvailable(held.fileIdentity, scope.actorKey, {
                  allowOrganizationAlbumProjection: true,
                });
              } catch {
                status = 'file_busy';
                return;
              }
              const file = await p.resolver.resolve(principal, target.trackId, 'read');
              if (
                file.fileIdentity !== held.fileIdentity ||
                file.fileRevision !== target.expectedRevision
              ) {
                status = 'stale_revision';
                return;
              }
              if (
                row.revision !== file.fileRevision ||
                row.binding_revision !== file.bindingRevision
              ) {
                status = 'inventory_pending';
                return;
              }
              await current(principal, scope);
              await held.validate();
              repo.atomic(() => {
                held.assertHeld();
                publications.validate(publication);
                checkMetadataPrincipal(service, principal);
                const currentPending = operation(
                  scope,
                  'claim',
                  body.operationId,
                  body,
                ) as PendingClaim;
                if (currentPending.results.some((result) => result.trackId === target.trackId))
                  return;
                if (
                  config.clock() < currentPending.createdAt ||
                  config.clock() >= currentPending.leaseUntil
                )
                  throw new ApiError(409, 'conflict');
                const competing = repo.activeClaim(id);
                if (competing && competing.id !== pendingId) throw new ApiError(409, 'conflict');
                publications.assertAvailable(held.fileIdentity, scope.actorKey, {
                  allowOrganizationAlbumProjection: true,
                });
                db.prepare(
                  'INSERT OR IGNORE INTO curation_claims VALUES(?,?,?,?,1,?,?,?,NULL)',
                ).run(
                  pendingId,
                  scope.actorKey,
                  body.purpose,
                  JSON.stringify(body.fields),
                  epoch(),
                  currentPending.createdAt,
                  currentPending.leaseUntil,
                );
                db.prepare('INSERT INTO curation_claim_items VALUES(?,?,?,?,?)').run(
                  pendingId,
                  id,
                  held.fileIdentity,
                  file.bindingRevision,
                  file.fileRevision,
                );
                status = 'granted';
                currentPending.results.push({ trackId: target.trackId, status });
                updatePending(scope, body.operationId, currentPending);
              });
            });
        } catch (error) {
          if (error instanceof ApiError && [400, 403, 401, 409].includes(error.status)) throw error;
          if (error instanceof ApiError && error.status === 404) status = 'not_found';
          else if (error instanceof Error && ['file_busy', 'fence_lost'].includes(error.message))
            status = 'file_busy';
          else status = 'inventory_pending';
        }
        repo.atomic(() => {
          const value = operation(scope, 'claim', body.operationId, body) as PendingClaim;
          if (
            'pending' in value &&
            !value.results.some((result) => result.trackId === target.trackId)
          ) {
            value.results.push({ trackId: target.trackId, status });
            updatePending(scope, body.operationId, value);
          }
        });
      }
      await current(principal, scope);
      return repo.atomic(() => {
        const result = operation(scope, 'claim', body.operationId, body) as
          PendingClaim | CurationClaimResult;
        if (!('pending' in result)) return decodeCurationClaimResult(result);
        const granted = result.results.some((entry) => entry.status === 'granted');
        const response = decodeCurationClaimResult({
          schemaVersion: 1,
          claimId: granted ? result.id : null,
          leaseUntil: granted ? result.leaseUntil : null,
          generation: granted ? 1 : null,
          results: body.targets.map((target) =>
            result.results.find((row) => row.trackId === target.trackId)!,
          ),
        });
        updatePending(scope, body.operationId, response);
        return response;
      });
    },
    async renewClaim(
      principal: MetadataPrincipal,
      id: string,
      body: { operationId: string; expectedGeneration: number },
    ) {
      const scope = await q.scope(principal);
      const claim = owner(scope, id);
      requirePurpose(
        principal,
        claim.purpose as ClaimPurpose,
        JSON.parse(String(claim.fields_json)) as CurationField[],
      );
      const replay = operation(scope, 'renew:' + id, body.operationId, body);
      if (replay) return decodeCurationClaimRenewed(replay);
      if (!live(claim) || claim.generation !== body.expectedGeneration)
        throw new ApiError(409, 'conflict');
      const heldGenerations: PublicationFence[] = [];
      const locks: HeldMediaFence[] = [];
      try {
        for (const item of db
          .prepare(
            'SELECT i.*,t.track_id,t.library_id FROM curation_claim_items i JOIN curation_tracks t ON t.id=i.track_ref WHERE i.claim_id=?',
          )
          .all(id)) {
          if (
            !scope.libraryIds.includes(String(item.library_id)) ||
            !canEditMetadata(config.policy, principal.identity.username, String(item.library_id))
          )
            throw new ApiError(403, 'forbidden');
          const held = await fence.acquire(String(item.file_identity), 'verify');
          locks.push(held);
          {
            const publication = publications.begin(held.fileIdentity, held.nonce);
            const file = await p.resolver.resolve(principal, String(item.track_id), 'read');
            if (
              file.fileIdentity !== held.fileIdentity ||
              file.bindingRevision !== item.binding_revision ||
              file.fileRevision !== item.expected_revision
            )
              throw new ApiError(409, 'conflict');
            await held.validate();
            heldGenerations.push(publication);
          }
        }
        await current(principal, scope);
        return repo.atomic(() => {
          const replay = operation(scope, 'renew:' + id, body.operationId, body);
          if (replay) return decodeCurationClaimRenewed(replay);
          const fresh = owner(scope, id);
          if (!live(fresh) || fresh.generation !== body.expectedGeneration)
            throw new ApiError(409, 'conflict');
          locks.forEach((held) => held.assertHeld());
          checkMetadataPrincipal(service, principal);
          heldGenerations.forEach(publications.validate);
          const response = {
            schemaVersion: 1 as const,
            claimId: id,
            generation: body.expectedGeneration + 1,
            leaseUntil: config.clock() + q.limits.claimLeaseMs,
          };
          db.prepare('UPDATE curation_claims SET generation=?,lease_until=? WHERE id=?').run(
            response.generation,
            response.leaseUntil,
            id,
          );
          repo.recordOperation(scope.actorKey, 'renew:' + id, body.operationId, body, response);
          return decodeCurationClaimRenewed(response);
        });
      } catch (error) {
        if (error instanceof Error && ['file_busy', 'fence_lost'].includes(error.message))
          throw new ApiError(409, 'conflict');
        throw error;
      } finally {
        await Promise.all(locks.map((held) => held.release()));
      }
    },
    async releaseClaim(principal: MetadataPrincipal, id: string) {
      const scope = await q.scope(principal);
      const claim = owner(scope, id);
      requirePurpose(
        principal,
        claim.purpose as ClaimPurpose,
        JSON.parse(String(claim.fields_json)) as CurationField[],
      );
      await current(principal, scope);
      repo.atomic(() => {
        owner(scope, id);
        checkMetadataPrincipal(service, principal);
        db.prepare(
          'UPDATE curation_claims SET released_at=COALESCE(released_at,?),generation=generation+CASE WHEN released_at IS NULL THEN 1 ELSE 0 END WHERE id=?',
        ).run(config.clock(), id);
      });
    },
    assertClaimForMutation(
      scope: CurationScope,
      id: string,
      generation: number,
      trackRef: string,
      purpose: ClaimPurpose,
      fields: readonly CurationField[],
    ) {
      const claim = owner(scope, id);
      if (
        !live(claim) ||
        claim.generation !== generation ||
        claim.purpose !== purpose ||
        fields.some((field) => !(JSON.parse(String(claim.fields_json)) as string[]).includes(field))
      )
        throw new ApiError(409, 'conflict');
      const item = db
        .prepare('SELECT * FROM curation_claim_items WHERE claim_id=? AND track_ref=?')
        .get(id, trackRef);
      if (!item) throw new ApiError(409, 'conflict');
      return item;
    },
  };
}
const operationIdHash = (value: string) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
