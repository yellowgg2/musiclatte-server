import type { FastifyRequest } from 'fastify';
import type { AuthScheme } from '@musiclatte/contracts';
import { ApiError, type SessionService } from './session-service.js';

export function credentials(request: FastifyRequest, service: SessionService, required = true): { token: string; scheme: AuthScheme } | undefined {
  const cookies = (request.headers.cookie ?? '').split(';').map(c => c.trim()).filter(c => c.startsWith(`${service.cookieName}=`));
  const authorization = request.headers.authorization;
  if (cookies.length > 1 || (cookies.length && authorization)) throw new ApiError(400, 'invalid_request');
  if (authorization) {
    if (!/^Bearer [A-Za-z0-9_.-]+$/.test(authorization)) throw new ApiError(401, 'unauthenticated');
    return { token: authorization.slice(7), scheme: 'bearer' };
  }
  if (cookies.length) return { token: cookies[0]!.slice(service.cookieName.length + 1), scheme: 'cookie' };
  if (required) throw new ApiError(401, 'unauthenticated');
  return undefined;
}
export function requiredCredentials(request: FastifyRequest, service: SessionService) { return credentials(request, service)!; }
