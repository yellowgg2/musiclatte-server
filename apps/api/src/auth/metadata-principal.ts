import type { FastifyRequest } from 'fastify';
import type { AccessTokenScope } from '@musiclatte/contracts';
import { createAccessTokenService } from './access-token-service.js';
import { requiredCredentials } from './guards.js';
import { ApiError, type SessionService } from './session-service.js';

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
  const tokens = createAccessTokenService(service, service.options.automation);
  const verified = await tokens.verify(auth.token, scopes);
  return {
    kind: 'access_token' as const,
    ...verified,
    revalidate: () => tokens.verify(auth.token, scopes),
  };
}
export type MetadataPrincipal = Awaited<ReturnType<typeof verifyMetadataPrincipal>>;
export function revalidatePrincipal(principal: MetadataPrincipal) {
  return principal.revalidate();
}
