import type {
  PlaylistCreateRequest,
  PlaylistDeleteRequest,
  PlaylistDetail,
  PlaylistMutationRequest,
  PlaylistMutationResponse,
  PlaylistDeleteResponse,
  PlaylistMutationConflictResponse,
} from '@musiclatte/contracts';
import type { SessionService } from '../auth/session-service.js';
import { ApiError } from '../auth/session-service.js';
import type { SubsonicClient } from '../subsonic/client.js';
import { SubsonicError } from '../subsonic/errors.js';
import type {
  PlaylistOperationKind,
  PlaylistOperationReceipt,
} from '../storage/playlist-operation-repository.js';
import { createMutationLock } from './mutation-lock.js';
import { playlistDetail } from './playlist-snapshot.js';

type Verified = Awaited<ReturnType<SessionService['verify']>>;
type ExistingRequest = PlaylistMutationRequest | PlaylistDeleteRequest;
type MutationSuccess = PlaylistMutationResponse | PlaylistDeleteResponse;
type MutationResult = MutationSuccess | PlaylistMutationConflictResponse;

const lock = createMutationLock();

function currentSession(service: SessionService, verified: Verified): void {
  service.find(verified.session.token, verified.session.scheme);
}

function validName(value: string): string {
  const name = value.trim();
  if (name.length === 0 || [...name].length > 255) throw new ApiError(422, 'invalid_request');
  return name;
}

function fingerprint(service: SessionService, purpose: string, value: string): string {
  return Buffer.from(service.sign(purpose, value), 'base64url').toString('hex');
}

function identityKey(service: SessionService, verified: Verified): string {
  return fingerprint(
    service,
    'playlist-operation-identity',
    JSON.stringify([verified.session.instanceId, verified.identity.username]),
  );
}

function requestHash(
  service: SessionService,
  kind: PlaylistOperationKind,
  playlistId: string | null,
  request: PlaylistCreateRequest | ExistingRequest,
): string {
  const body =
    kind === 'create'
      ? { name: validName((request as PlaylistCreateRequest).name) }
      : kind === 'delete'
        ? { expectedRevision: (request as PlaylistDeleteRequest).expectedRevision }
        : canonicalMutation(request as PlaylistMutationRequest);
  return fingerprint(
    service,
    'playlist-operation-request',
    JSON.stringify([kind, playlistId, body]),
  );
}

function canonicalMutation(request: PlaylistMutationRequest): Record<string, unknown> {
  switch (request.action) {
    case 'rename':
      return {
        expectedRevision: request.expectedRevision,
        action: request.action,
        name: validName(request.name),
      };
    case 'append':
      return {
        expectedRevision: request.expectedRevision,
        action: request.action,
        songIds: request.songIds,
      };
    case 'remove':
      return {
        expectedRevision: request.expectedRevision,
        action: request.action,
        occurrence: request.occurrence,
      };
    case 'reorder':
      return {
        expectedRevision: request.expectedRevision,
        action: request.action,
        order: request.order,
      };
  }
}

function operationKeys(
  service: SessionService,
  verified: Verified,
  kind: PlaylistOperationKind,
  playlistId: string | null,
  request: PlaylistCreateRequest | ExistingRequest,
) {
  return {
    identityKey: identityKey(service, verified),
    operationIdHash: fingerprint(service, 'playlist-operation-id', request.operationId),
    requestHash: requestHash(service, kind, playlistId, request),
    kind,
  };
}

function conflict(
  code: 'conflict' | 'outcome_unknown',
  current?: PlaylistDetail,
): PlaylistMutationConflictResponse {
  return {
    schemaVersion: 1,
    error: { code, retryable: false },
    ...(current ? { current } : {}),
  };
}

function success(playlist: PlaylistDetail, replay = false): PlaylistMutationResponse {
  return { schemaVersion: 1, outcome: replay ? 'already_applied' : 'applied', playlist };
}

function deleted(playlistId: string, replay = false): PlaylistDeleteResponse {
  return {
    schemaVersion: 1,
    outcome: replay ? 'already_applied' : 'applied',
    playlistId,
    deleted: true,
  };
}

function mapReadError(service: SessionService, verified: Verified, error: unknown): never {
  if (error instanceof SubsonicError) {
    if (error.kind === 'not_found' || error.httpStatus === 404)
      throw new ApiError(404, 'not_found');
    if (error.kind === 'protocol_incompatible') throw new ApiError(422, 'upstream_incompatible');
    if (error.kind === 'invalid_request') throw new ApiError(400, 'invalid_request');
  }
  return service.rejectUpstream(error, verified.session.raw);
}

async function current(
  service: SessionService,
  verified: Verified,
  playlistId: string,
  signal?: AbortSignal,
): Promise<PlaylistDetail> {
  try {
    return playlistDetail(
      service,
      { instanceId: verified.session.instanceId, username: verified.identity.username },
      await verified.upstream.getPlaylist(playlistId, signal ? { signal } : undefined),
    );
  } catch (error) {
    return mapReadError(service, verified, error);
  }
}

async function maybeCurrent(
  service: SessionService,
  verified: Verified,
  playlistId: string,
): Promise<PlaylistDetail | undefined> {
  try {
    return await current(service, verified, playlistId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return undefined;
    throw error;
  }
}

function desired(
  snapshot: PlaylistDetail,
  request: PlaylistMutationRequest,
): { name: string; songIds: string[] } | PlaylistMutationConflictResponse {
  const currentIds = snapshot.entries.map((entry) => entry.song.id);
  switch (request.action) {
    case 'rename':
      return { name: validName(request.name), songIds: currentIds };
    case 'append':
      return { name: snapshot.name, songIds: [...currentIds, ...request.songIds] };
    case 'remove': {
      if (
        request.occurrence.position >= currentIds.length ||
        currentIds[request.occurrence.position] !== request.occurrence.songId
      )
        return conflict('conflict', snapshot);
      return {
        name: snapshot.name,
        songIds: currentIds.filter((_id, position) => position !== request.occurrence.position),
      };
    }
    case 'reorder': {
      if (
        request.order.length !== currentIds.length ||
        request.order.some((position) => position >= currentIds.length) ||
        new Set(request.order).size !== currentIds.length
      )
        return conflict('conflict', snapshot);
      return {
        name: snapshot.name,
        songIds: request.order.map((position) => currentIds[position]!),
      };
    }
  }
}

function isDesired(snapshot: PlaylistDetail, expectation: { name: string; songIds: string[] }) {
  return (
    snapshot.name === expectation.name &&
    snapshot.entries.length === expectation.songIds.length &&
    snapshot.entries.every((entry, position) => entry.song.id === expectation.songIds[position])
  );
}

function deterministic(error: unknown): boolean {
  return (
    error instanceof SubsonicError &&
    [
      'invalid_request',
      'forbidden',
      'not_found',
      'authentication',
      'token_auth_unsupported',
      'protocol_incompatible',
    ].includes(error.kind)
  );
}

function rejectWrite(service: SessionService, verified: Verified, error: unknown): never {
  if (error instanceof SubsonicError) {
    if (error.kind === 'invalid_request') throw new ApiError(400, 'invalid_request');
    if (error.kind === 'not_found') throw new ApiError(404, 'not_found');
    if (error.kind === 'protocol_incompatible') throw new ApiError(422, 'upstream_incompatible');
  }
  return service.rejectUpstream(error, verified.session.raw);
}

function sameReceipt(receipt: PlaylistOperationReceipt, keys: ReturnType<typeof operationKeys>) {
  return receipt.requestHash === keys.requestHash && receipt.kind === keys.kind;
}

async function replayExisting(
  service: SessionService,
  verified: Verified,
  playlistId: string,
  keys: ReturnType<typeof operationKeys>,
  receipt: PlaylistOperationReceipt,
): Promise<MutationResult> {
  if (!sameReceipt(receipt, keys)) return conflict('conflict');
  if (receipt.status === 'applied') {
    if (keys.kind === 'delete') return deleted(playlistId, true);
    const snapshot = await maybeCurrent(service, verified, receipt.resourceId ?? playlistId);
    return snapshot ? success(snapshot, true) : conflict('outcome_unknown');
  }
  if (receipt.status === 'failed') return conflict('outcome_unknown');
  if (keys.kind === 'delete') {
    const snapshot = await maybeCurrent(service, verified, playlistId);
    if (!snapshot) {
      service.options.playlistOperations.markApplied(keys.identityKey, keys.operationIdHash, {
        resourceId: playlistId,
        beforeRevision: null,
        afterRevision: null,
      });
      return deleted(playlistId, true);
    }
    return conflict('outcome_unknown', snapshot);
  }
  const snapshot = await maybeCurrent(service, verified, receipt.resourceId ?? playlistId);
  return conflict('outcome_unknown', snapshot);
}

async function reconcilePatch(
  service: SessionService,
  verified: Verified,
  playlistId: string,
  beforeRevision: string,
  expectation: { name: string; songIds: string[] },
  keys: ReturnType<typeof operationKeys>,
): Promise<MutationResult> {
  let snapshot: PlaylistDetail | undefined;
  try {
    snapshot = await maybeCurrent(service, verified, playlistId);
  } catch {
    service.options.playlistOperations.markUncertain(keys.identityKey, keys.operationIdHash);
    return conflict('outcome_unknown');
  }
  if (snapshot && isDesired(snapshot, expectation)) {
    service.options.playlistOperations.markApplied(keys.identityKey, keys.operationIdHash, {
      resourceId: playlistId,
      beforeRevision,
      afterRevision: snapshot.revision,
    });
    return success(snapshot);
  }
  service.options.playlistOperations.markUncertain(keys.identityKey, keys.operationIdHash);
  return conflict('outcome_unknown', snapshot);
}

async function writePatch(
  upstream: SubsonicClient,
  playlistId: string,
  request: PlaylistMutationRequest,
  expectation: { name: string; songIds: string[] },
  signal: AbortSignal,
) {
  if (request.action === 'rename') {
    await upstream.updatePlaylist({ playlistId, name: expectation.name, signal });
  } else if (request.action === 'append') {
    await upstream.updatePlaylist({ playlistId, songIdsToAdd: request.songIds, signal });
  } else {
    await upstream.createPlaylist({
      playlistId,
      name: expectation.name,
      songIds: expectation.songIds,
      signal,
    });
  }
}

export function createPlaylistMutationService(service: SessionService) {
  return {
    async create(
      verified: Verified,
      request: PlaylistCreateRequest,
      signal: AbortSignal,
    ): Promise<MutationResult> {
      const name = validName(request.name);
      const keys = operationKeys(service, verified, 'create', null, request);
      return lock.run(`${keys.identityKey}:create`, async () => {
        currentSession(service, verified);
        const existing = service.options.playlistOperations.get(
          keys.identityKey,
          keys.operationIdHash,
        );
        if (existing) {
          if (!sameReceipt(existing, keys)) return conflict('conflict');
          if (existing.status !== 'applied' || !existing.resourceId)
            return conflict('outcome_unknown');
          const snapshot = await maybeCurrent(service, verified, existing.resourceId);
          return snapshot ? success(snapshot, true) : conflict('outcome_unknown');
        }
        const claim = service.options.playlistOperations.claim(keys);
        if (claim.outcome !== 'claimed')
          return claim.outcome === 'conflict' ? conflict('conflict') : conflict('outcome_unknown');
        let createdId: string | undefined;
        try {
          createdId = (await verified.upstream.createPlaylist({ name, songIds: [], signal })).id;
        } catch (error) {
          if (deterministic(error)) {
            service.options.playlistOperations.markFailed(keys.identityKey, keys.operationIdHash);
            return rejectWrite(service, verified, error);
          }
          service.options.playlistOperations.markUncertain(keys.identityKey, keys.operationIdHash);
          return conflict('outcome_unknown');
        }
        let snapshot: PlaylistDetail | undefined;
        try {
          snapshot = await maybeCurrent(service, verified, createdId);
        } catch {
          service.options.playlistOperations.markUncertain(keys.identityKey, keys.operationIdHash);
          return conflict('outcome_unknown');
        }
        if (!snapshot || snapshot.name !== name || snapshot.entries.length !== 0) {
          service.options.playlistOperations.markUncertain(keys.identityKey, keys.operationIdHash);
          return conflict('outcome_unknown', snapshot);
        }
        service.options.playlistOperations.markApplied(keys.identityKey, keys.operationIdHash, {
          resourceId: snapshot.id,
          beforeRevision: null,
          afterRevision: snapshot.revision,
        });
        return success(snapshot);
      });
    },

    async mutate(
      verified: Verified,
      playlistId: string,
      request: PlaylistMutationRequest,
      signal: AbortSignal,
    ): Promise<MutationResult> {
      const kind = request.action;
      const keys = operationKeys(service, verified, kind, playlistId, request);
      return lock.run(`${keys.identityKey}:${playlistId}`, async () => {
        currentSession(service, verified);
        const existing = service.options.playlistOperations.get(
          keys.identityKey,
          keys.operationIdHash,
        );
        if (existing) return replayExisting(service, verified, playlistId, keys, existing);
        const snapshot = await current(service, verified, playlistId, signal);
        currentSession(service, verified);
        if (!snapshot.editable) throw new ApiError(403, 'forbidden');
        if (snapshot.revision !== request.expectedRevision) return conflict('conflict', snapshot);
        const expectation = desired(snapshot, request);
        if ('error' in expectation) return expectation;
        const claim = service.options.playlistOperations.claim(keys);
        if (claim.outcome !== 'claimed')
          return replayExisting(service, verified, playlistId, keys, claim.receipt);
        try {
          await writePatch(verified.upstream, playlistId, request, expectation, signal);
        } catch (error) {
          if (deterministic(error)) {
            service.options.playlistOperations.markFailed(keys.identityKey, keys.operationIdHash);
            return rejectWrite(service, verified, error);
          }
          return reconcilePatch(
            service,
            verified,
            playlistId,
            snapshot.revision,
            expectation,
            keys,
          );
        }
        const result = await reconcilePatch(
          service,
          verified,
          playlistId,
          snapshot.revision,
          expectation,
          keys,
        );
        return result;
      });
    },

    async delete(
      verified: Verified,
      playlistId: string,
      request: PlaylistDeleteRequest,
      signal: AbortSignal,
    ): Promise<MutationResult> {
      const keys = operationKeys(service, verified, 'delete', playlistId, request);
      return lock.run(`${keys.identityKey}:${playlistId}`, async () => {
        currentSession(service, verified);
        const existing = service.options.playlistOperations.get(
          keys.identityKey,
          keys.operationIdHash,
        );
        if (existing) return replayExisting(service, verified, playlistId, keys, existing);
        const snapshot = await current(service, verified, playlistId, signal);
        currentSession(service, verified);
        if (!snapshot.editable) throw new ApiError(403, 'forbidden');
        if (snapshot.revision !== request.expectedRevision) return conflict('conflict', snapshot);
        const claim = service.options.playlistOperations.claim(keys);
        if (claim.outcome !== 'claimed')
          return replayExisting(service, verified, playlistId, keys, claim.receipt);
        try {
          await verified.upstream.deletePlaylist(playlistId, { signal });
        } catch (error) {
          if (deterministic(error)) {
            service.options.playlistOperations.markFailed(keys.identityKey, keys.operationIdHash);
            return rejectWrite(service, verified, error);
          }
        }
        let postflight: PlaylistDetail | undefined;
        try {
          postflight = await maybeCurrent(service, verified, playlistId);
        } catch {
          service.options.playlistOperations.markUncertain(keys.identityKey, keys.operationIdHash);
          return conflict('outcome_unknown');
        }
        if (postflight) {
          service.options.playlistOperations.markUncertain(keys.identityKey, keys.operationIdHash);
          return conflict('outcome_unknown', postflight);
        }
        service.options.playlistOperations.markApplied(keys.identityKey, keys.operationIdHash, {
          resourceId: playlistId,
          beforeRevision: snapshot.revision,
          afterRevision: null,
        });
        return deleted(playlistId);
      });
    },
  };
}
