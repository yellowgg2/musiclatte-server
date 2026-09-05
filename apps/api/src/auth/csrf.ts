import type { FastifyRequest } from 'fastify';
import { ApiError, type SessionService } from './session-service.js';
export function requireJSON(request: FastifyRequest): void {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? ''))
    throw new ApiError(415, 'invalid_request');
}
export function cookieMutation(
  request: FastifyRequest,
  service: SessionService,
  token?: string,
): void {
  requireJSON(request);
  if (
    request.headers.origin !== service.options.origin ||
    request.headers['sec-fetch-site'] === 'cross-site' ||
    request.headers['x-musiclatte-client'] !== 'web'
  )
    throw new ApiError(403, 'csrf_rejected');
  if (token) {
    const supplied = request.headers['x-csrf-token'];
    if (typeof supplied !== 'string' || !service.matches(supplied, service.sign('csrf', token)))
      throw new ApiError(403, 'csrf_rejected');
  }
}
