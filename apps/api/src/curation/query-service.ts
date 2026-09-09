import { createHash, timingSafeEqual } from 'node:crypto';
import {
  accessTokenScopes,
  decodeCurationList,
  decodeCurationDetail,
  type CurationDetail,
} from '@musiclatte/contracts';
import { ApiError, type SessionService } from '../auth/session-service.js';
import {
  isTokenPrincipal,
  metadataContext,
  rejectMetadataUpstream,
  checkMetadataPrincipal,
  type MetadataPrincipal,
} from '../auth/metadata-principal.js';
import {
  createCurationRepository,
  type CurationScope,
  type CurationFilter,
} from '../storage/curation-repository.js';
import { createCurationPolicy } from './policy.js';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function curationErrors<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const code = error instanceof Error ? error.message : '';
    if (['invalid_filter', 'invalid_limit', 'invalid_cursor'].includes(code))
      throw new ApiError(400, 'invalid_request');
    if (code === 'snapshot_expired' || code === 'snapshot_scope_changed')
      throw new ApiError(409, code);
    if (code === 'snapshot_capacity') throw new ApiError(503, code);
    throw error;
  }
}
export function createCurationQueryService(service: SessionService) {
  const config = service.options.automation;
  if (!config?.curation || !config.policy.enabled) throw new ApiError(403, 'forbidden');
  const limits = config.curation.limits;
  const repository = createCurationRepository({
    database: config.database,
    clock: config.clock,
    cursorKey: service.options.signingKey,
    limits,
  });
  const db = config.database.connection;
  async function scope(principal: MetadataPrincipal): Promise<CurationScope> {
    checkMetadataPrincipal(service, principal);
    const context = metadataContext(principal);
    let libraryIds: string[];
    if (isTokenPrincipal(principal)) libraryIds = principal.allowedLibraries;
    else {
      try {
        const folders = await principal.upstream.folders();
        libraryIds = config!.policy.libraries
          .filter((library) => folders.some((folder) => folder.id === library.musicFolderId))
          .map((library) => library.id);
      } catch (error) {
        return rejectMetadataUpstream(service, principal, error);
      }
    }
    checkMetadataPrincipal(service, principal);
    const credentialId = isTokenPrincipal(principal)
      ? principal.accessToken.id
      : service.sign('curation-session', principal.session.raw);
    return {
      instanceId: context.instanceId,
      actorKey: service.sign(
        'curation-actor',
        JSON.stringify([context.instanceId, principal.identity.username, credentialId]),
      ),
      credentialId,
      scopes: isTokenPrincipal(principal)
        ? [...principal.accessToken.scopes].sort()
        : [...accessTokenScopes].sort(),
      libraryIds: [...libraryIds].sort(),
      policyRevision: context.policyRevision,
    };
  }
  function trackRef(scope: CurationScope, trackId: string): string {
    const matches = db
      .prepare('SELECT id,library_id FROM curation_tracks WHERE track_id=? AND tombstoned=0')
      .all(trackId)
      .filter((row) => scope.libraryIds.includes(String(row.library_id)));
    if (matches.length !== 1)
      throw new ApiError(matches.length ? 409 : 404, matches.length ? 'conflict' : 'not_found');
    return String(matches[0]!.id);
  }
  return {
    repository,
    scope,
    trackRef,
    limits,
    policy: () => ({ schemaVersion: 1 as const, policy: createCurationPolicy(limits) }),
    list(scope: CurationScope, query: CurationFilter & { cursor?: string; limit?: string }) {
      const { cursor, limit, ...filter } = query;
      if (filter.libraryId && !scope.libraryIds.includes(filter.libraryId))
        throw new ApiError(403, 'forbidden');
      return curationErrors(() =>
        decodeCurationList({
          schemaVersion: 1,
          ...repository.list(scope, filter, limit ? Number(limit) : 25, cursor),
        }),
      );
    },
    detail(scope: CurationScope, trackId: string, query: { cursor?: string; limit?: string }) {
      return curationErrors(() => {
        const id = trackRef(scope, trackId);
        const epoch = db.prepare('SELECT claim_epoch FROM curation_state WHERE singleton=1').get()!
          .claim_epoch;
        const binding = hash([scope, id, epoch]);
        let after = 0;
        if (query.cursor) {
          const [payload, mac, extra] = query.cursor.split('.');
          if (
            !payload ||
            !mac ||
            extra ||
            query.cursor.length > 2048 ||
            mac.length !== 43 ||
            !timingSafeEqual(
              Buffer.from(service.sign('curation-history', payload)),
              Buffer.from(mac),
            )
          )
            throw new Error('invalid_cursor');
          let parsed: { binding: string; sequence: number };
          try {
            parsed = JSON.parse(
              Buffer.from(payload, 'base64url').toString('utf8'),
            ) as typeof parsed;
          } catch {
            throw new Error('invalid_cursor');
          }
          if (
            !parsed ||
            typeof parsed !== 'object' ||
            typeof parsed.binding !== 'string' ||
            !Number.isSafeInteger(parsed.sequence) ||
            parsed.sequence < 0
          )
            throw new Error('invalid_cursor');
          if (parsed.binding !== binding) throw new Error('snapshot_scope_changed');
          after = parsed.sequence;
        }
        const limit = query.limit ? Number(query.limit) : 25;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('invalid_limit');
        const rows = db
          .prepare(
            'SELECT sequence,kind,created_at FROM curation_events WHERE track_ref=? AND sequence>? ORDER BY sequence LIMIT ?',
          )
          .all(id, after, limit + 1);
        const page = rows.slice(0, limit);
        const payload = Buffer.from(
          JSON.stringify({ binding, sequence: Number(page.at(-1)?.sequence ?? after) }),
        ).toString('base64url');
        const claim = repository.activeClaim(id);
        const track = repository.get(id)!;
        const activeWork = db
          .prepare(
            "SELECT i.id,i.job_id,i.stage FROM metadata_items i JOIN curation_tracks t ON t.file_identity=i.file_identity WHERE t.id=? AND i.stage IN ('queued','preparing','backed_up','prepared','file_saved','reflecting','recovery_required') ORDER BY i.stage_changed_at,i.id LIMIT 100",
          )
          .all(id)
          .map((row) => ({
            itemId: String(row.id),
            jobId: String(row.job_id),
            stage: String(row.stage),
          }));
        return decodeCurationDetail({
          schemaVersion: 1,
          track,
          coverage: repository.coverage([track.libraryId]),
          activeClaim: claim
            ? {
                id: String(claim.id),
                purpose: claim.purpose as NonNullable<CurationDetail['activeClaim']>['purpose'],
                fields: JSON.parse(String(claim.fields_json)),
                generation: Number(claim.generation),
                leaseUntil: Number(claim.lease_until),
              }
            : null,
          activeWork,
          history: page.map((row) => ({
            sequence: Number(row.sequence),
            kind: String(row.kind),
            createdAt: Number(row.created_at),
          })),
          nextCursor:
            rows.length > limit ? `${payload}.${service.sign('curation-history', payload)}` : null,
        } satisfies CurationDetail);
      });
    },
  };
}
