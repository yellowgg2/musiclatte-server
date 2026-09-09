import type { FastifyRequest } from 'fastify';
import type { AccessTokenScope } from '@musiclatte/contracts';
import { createAccessTokenService } from './access-token-service.js';
import { requiredCredentials } from './guards.js';
import { ApiError, upstreamError, type SessionService } from './session-service.js';

/** Explicit metadata consumers call this adapter; ordinary session APIs never accept PATs. */
export async function verifyMetadataPrincipal(
  request: FastifyRequest,
  service: SessionService,
  scopes: readonly AccessTokenScope[] = ['metadata:read'],
) {
  const auth = requiredCredentials(request, service);
  if (new URL(request.url, service.options.origin).searchParams.has('token'))
    throw new ApiError(400, 'invalid_request');
  if (!auth.token.startsWith('mlpat_')) {
    const verified = await service.verify(auth.token, auth.scheme);
    return {
      kind: 'session' as const,
      ...verified,
      revalidate: () => service.verify(auth.token, auth.scheme),
    };
  }
  if (auth.scheme !== 'bearer' || !service.options.automation) throw new ApiError(403, 'forbidden');
  return verifyAccessTokenPrincipal(service, auth.token, scopes);
}
export async function verifyAccessTokenPrincipal(
  service: SessionService,
  token: string,
  scopes: readonly AccessTokenScope[] = ['metadata:read'],
) {
  if (!service.options.automation) throw new ApiError(403, 'forbidden');
  const tokens = createAccessTokenService(service, service.options.automation);
  const verified = await tokens.verify(token, scopes);
  return {
    kind: 'access_token' as const,
    ...verified,
    actorIdentityKey: Buffer.from(
      service.sign(
        'metadata-identity',
        JSON.stringify([verified.instanceId, verified.identity.username]),
      ),
      'base64url',
    ).toString('hex'),
    checkCurrent: () => tokens.find(token),
    revalidate: () => tokens.verify(token, scopes),
  };
}
export type MetadataPrincipal = Awaited<ReturnType<typeof verifyMetadataPrincipal>>;
export function revalidatePrincipal(principal: MetadataPrincipal) {
  return principal.revalidate();
}
export type VerifiedMetadataActor =
  | Awaited<ReturnType<SessionService['verify']>>
  | Extract<MetadataPrincipal, { kind: 'access_token' }>;
export function isTokenPrincipal(
  v: VerifiedMetadataActor,
): v is Extract<MetadataPrincipal, { kind: 'access_token' }> {
  return 'kind' in v && v.kind === 'access_token';
}
export function metadataContext(v: VerifiedMetadataActor) {
  return isTokenPrincipal(v)
    ? { instanceId: v.instanceId, policyRevision: v.policyRevision }
    : v.session;
}
export function metadataSession(v: VerifiedMetadataActor) {
  if (isTokenPrincipal(v)) throw new ApiError(403, 'forbidden');
  return v.session;
}
export function checkMetadataPrincipal(service: SessionService, v: VerifiedMetadataActor): void {
  if (isTokenPrincipal(v)) v.checkCurrent();
  else service.find(v.session.token, v.session.scheme);
}
export async function revalidateMetadataPrincipal(
  service: SessionService,
  v: VerifiedMetadataActor,
): Promise<void> {
  if (isTokenPrincipal(v)) await v.revalidate();
  else await service.verify(v.session.token, v.session.scheme);
}
export function rejectMetadataUpstream(
  service: SessionService,
  v: VerifiedMetadataActor,
  error: unknown,
): never {
  if (!isTokenPrincipal(v)) return service.rejectUpstream(error, v.session.raw);
  const mapped = upstreamError(error);
  if (mapped.status === 401 && service.options.automation)
    createAccessTokenService(service, service.options.automation).repository.revokeOwned(
      v.ownerUsername,
      v.accessToken.id,
    );
  throw mapped;
}
export function metadataCredentialFingerprint(v: VerifiedMetadataActor): unknown {
  return isTokenPrincipal(v)
    ? ['access_token', v.accessToken.id, v.accessToken.scopes, v.allowedLibraries, v.policyRevision]
    : null;
}
