import { createHash } from 'node:crypto';
import {
  accessTokenScopes,
  validateTokenScopes,
  validateTokenLibraries,
  validateTokenName,
  type AccessTokenScope,
} from '@musiclatte/contracts';
import { createAccessTokenRepository } from '../storage/access-token-repository.js';
import { canEditMetadata } from '../metadata/policy.js';
import { createSubsonicClient } from '../subsonic/client.js';
import { ApiError, upstreamError, type SessionService } from './session-service.js';
import type { AutomationOptions } from '../automation/config.js';

export function createAccessTokenService(service: SessionService, options: AutomationOptions) {
  const repository = createAccessTokenRepository({ ...options, maxAgeMs: options.maxTokenAgeMs });
  async function allowedLibraries(
    username: string,
    upstream: ReturnType<typeof createSubsonicClient>,
  ): Promise<string[]> {
    const folders = await upstream.folders();
    return options.policy.libraries
      .filter(
        (library) =>
          canEditMetadata(options.policy, username, library.id) &&
          folders.some((folder) => folder.id === library.musicFolderId),
      )
      .map((library) => library.id);
  }
  function find(token: string) {
    if (!/^mlpat_[A-Za-z0-9_-]{43}$/.test(token)) throw new ApiError(401, 'unauthenticated');
    const found = repository.findByHash(createHash('sha256').update(token).digest('hex'));
    if (!found) throw new ApiError(401, 'unauthenticated');
    return found;
  }
  return {
    find,
    repository,
    allowedLibraries,
    async creationOptions(verified: Awaited<ReturnType<SessionService['verify']>>) {
      let libraryIds: string[];
      try {
        libraryIds = await allowedLibraries(verified.identity.username, verified.upstream);
      } catch (error) {
        return service.rejectUpstream(error, verified.session.raw);
      }
      service.find(verified.session.token, verified.session.scheme);
      if (!libraryIds.length) throw new ApiError(403, 'forbidden');
      return {
        schemaVersion: 1 as const,
        now: options.clock(),
        maxTokenAgeMs: options.maxTokenAgeMs,
        libraryIds,
        scopes: [...accessTokenScopes],
      };
    },
    async create(
      verified: Awaited<ReturnType<SessionService['verify']>>,
      input: { name: string; scopes: AccessTokenScope[]; libraryIds: string[]; expiresAt: number },
    ) {
      let scopes: AccessTokenScope[];
      let libraries: string[];
      let name: string;
      try {
        scopes = validateTokenScopes(input.scopes);
        libraries = validateTokenLibraries(input.libraryIds);
        name = validateTokenName(input.name);
        if (
          !Number.isSafeInteger(input.expiresAt) ||
          input.expiresAt <= options.clock() ||
          input.expiresAt - options.clock() > options.maxTokenAgeMs
        )
          throw new Error();
      } catch {
        throw new ApiError(400, 'invalid_request');
      }
      let allowed: string[];
      try {
        allowed = await allowedLibraries(verified.identity.username, verified.upstream);
      } catch (error) {
        return service.rejectUpstream(error, verified.session.raw);
      }
      if (libraries.some((id) => !allowed.includes(id))) throw new ApiError(403, 'forbidden');
      service.find(verified.session.token, verified.session.scheme);
      const result = repository.create({
        name,
        scopes,
        libraryIds: libraries,
        expiresAt: input.expiresAt,
        proof: verified.session.proof,
      });
      return { schemaVersion: 1 as const, ...result };
    },
    async verify(token: string, requiredScopes: readonly AccessTokenScope[] = ['metadata:read']) {
      const stored = find(token);
      const upstream = createSubsonicClient({
        upstream: service.options.upstream,
        timeoutMs: service.options.timeoutMs,
        proof: stored.proof,
      });
      try {
        const identity = await upstream.currentUser();
        if (identity.username !== stored.ownerUsername) throw new ApiError(401, 'unauthenticated');
        const allowed = await allowedLibraries(identity.username, upstream);
        const current = find(token);
        if (requiredScopes.some((scope) => !current.accessToken.scopes.includes(scope)))
          throw new ApiError(403, 'forbidden');
        const libraries = allowed.filter((id) => current.accessToken.libraryIds.includes(id));
        if (!libraries.length) throw new ApiError(403, 'forbidden');
        repository.markUsed(current.accessToken.id);
        return { ...current, identity, upstream, allowedLibraries: libraries };
      } catch (error) {
        const mapped = upstreamError(error);
        if (mapped.status === 401)
          repository.revokeOwned(stored.ownerUsername, stored.accessToken.id);
        throw mapped;
      }
    },
  };
}
export type AccessTokenService = ReturnType<typeof createAccessTokenService>;
