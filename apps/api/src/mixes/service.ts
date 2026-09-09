import { decodeMixInput, type MixConditions, type SavedMix } from '@musiclatte/contracts';
import { ApiError, type SessionService } from '../auth/session-service.js';
import type { MixAnchor, StoredMix, MixMutationResult } from '../storage/mix-repository.js';
type Verified = Awaited<ReturnType<SessionService['verify']>>;
export interface MixRequest {
  operationId: string;
  expectedRevision?: number;
  name?: string;
  conditions?: MixConditions;
}
const wire = (mix: StoredMix): SavedMix => ({
  ...mix,
  createdAt: new Date(mix.createdAt).toISOString(),
  updatedAt: new Date(mix.updatedAt).toISOString(),
});
function stable(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value))
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, stable(v)]),
    );
  return value;
}
export function createMixService(service: SessionService) {
  const repository = service.options.mixes;
  const hash = (purpose: string, value: string) =>
    Buffer.from(service.sign(purpose, value), 'base64url').toString('hex');
  const identity = (v: Verified) =>
    hash('mix-identity', JSON.stringify([v.session.instanceId, v.identity.username]));
  function ready() {
    if (!repository) throw new ApiError(404, 'not_found');
    return repository;
  }
  function current(v: Verified, id: string) {
    const mix = ready().get(identity(v), id);
    if (!mix) throw new ApiError(404, 'not_found');
    return mix;
  }
  async function scope(v: Verified, conditions: MixConditions, signal: AbortSignal) {
    if (
      conditions.musicFolderId !== undefined &&
      !(await v.upstream.folders({ signal })).some(
        (folder) => folder.id === conditions.musicFolderId,
      )
    )
      throw new ApiError(409, 'conflict', 'mix_scope_unavailable');
    if (signal.aborted) throw new ApiError(503, 'upstream_unavailable');
    service.find(v.session.token, v.session.scheme);
  }
  const response = (result: MixMutationResult) =>
    'mix' in result ? { schemaVersion: 1, mix: wire(result.mix) } : { schemaVersion: 1, ...result };
  return {
    get(v: Verified, id: string) {
      return { schemaVersion: 1, mix: wire(current(v, id)) };
    },
    list(v: Verified, query: { limit?: string; cursor?: string }) {
      const repo = ready();
      const owner = identity(v);
      const limit = query.limit === undefined ? 50 : Number(query.limit);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw new ApiError(400, 'invalid_request');
      let anchor: MixAnchor | undefined;
      let highWater: number | undefined;
      if (query.cursor !== undefined) {
        try {
          const [payload, signature, extra] = query.cursor.split('.');
          if (
            !payload ||
            !signature ||
            extra ||
            !service.matches(signature, service.sign('mix-cursor', payload))
          )
            throw new Error();
          const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
          if (
            decoded.owner !== owner ||
            decoded.limit !== limit ||
            !Number.isSafeInteger(decoded.highWater) ||
            decoded.highWater < 0 ||
            !decoded.anchor
          )
            throw new Error();
          anchor = decoded.anchor;
          highWater = decoded.highWater;
        } catch {
          throw new ApiError(400, 'invalid_request');
        }
      }
      let page;
      try {
        page = repo.list(owner, {
          limit,
          ...(anchor ? { anchor } : {}),
          ...(highWater === undefined ? {} : { highWater }),
        });
      } catch (error) {
        if (error instanceof Error && error.message === 'Invalid mix')
          throw new ApiError(400, 'invalid_request');
        throw error;
      }
      const payload = page.next
        ? Buffer.from(
            JSON.stringify({ owner, limit, highWater: page.highWater, anchor: page.next }),
          ).toString('base64url')
        : null;
      return {
        schemaVersion: 1,
        mixes: page.items.map(wire),
        nextCursor: payload ? `${payload}.${service.sign('mix-cursor', payload)}` : null,
      };
    },
    async songs(v: Verified, id: string, signal: AbortSignal) {
      const mix = current(v, id);
      await scope(v, mix.conditions, signal);
      const songs = await v.upstream.random({ ...mix.conditions, signal });
      service.rememberRandom(v.session.raw);
      return {
        schemaVersion: 1,
        mixId: mix.id,
        revision: mix.revision,
        conditions: mix.conditions,
        songs,
      };
    },
    async mutate(
      v: Verified,
      kind: 'create' | 'update' | 'delete',
      id: string | undefined,
      request: MixRequest,
      signal: AbortSignal,
    ) {
      const repo = ready();
      const identityKey = identity(v);
      const operationIdHash = hash(
        'mix-operation',
        JSON.stringify([identityKey, request.operationId]),
      );
      const requestHash = hash(
        'mix-request',
        JSON.stringify(stable({ kind, id: id ?? null, request })),
      );
      try {
        const replay = repo.replay(identityKey, operationIdHash, requestHash);
        if (replay) return response(replay);
        const previous = kind === 'create' ? undefined : current(v, id!);
        let input;
        if (kind !== 'delete') {
          try {
            input = decodeMixInput({
              name: request.name ?? previous?.name,
              conditions: request.conditions ?? previous?.conditions,
            });
          } catch {
            throw new ApiError(400, 'invalid_request');
          }
          await scope(v, input.conditions, signal);
        }
        if (signal.aborted) throw new ApiError(503, 'upstream_unavailable');
        service.find(v.session.token, v.session.scheme);
        return response(
          repo.mutate({
            identityKey,
            operationIdHash,
            requestHash,
            kind,
            ...(id ? { id } : {}),
            ...(request.expectedRevision === undefined
              ? {}
              : { revision: request.expectedRevision }),
            ...(input ? { input } : {}),
          }),
        );
      } catch (error) {
        if (error instanceof Error && error.message === 'Mix conflict')
          throw new ApiError(409, 'conflict');
        if (error instanceof Error && error.message === 'Mix not found')
          throw new ApiError(404, 'not_found');
        if (error instanceof Error && error.message === 'Invalid mix')
          throw new ApiError(400, 'invalid_request');
        throw error;
      }
    },
  };
}
