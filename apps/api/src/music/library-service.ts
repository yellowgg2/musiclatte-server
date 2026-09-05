import type { FastifyReply, FastifyRequest } from 'fastify';
import { requiredCredentials } from '../auth/guards.js';
import { ApiError, type SessionService } from '../auth/session-service.js';
import type { SubsonicClient } from '../subsonic/client.js';
import { SubsonicError } from '../subsonic/errors.js';

/** Each operation is one bounded upstream read; no recursive traversal or library cache. */
export async function libraryRead<T>(
  service: SessionService,
  request: FastifyRequest,
  reply: FastifyReply,
  read: (
    upstream: SubsonicClient,
    signal: AbortSignal,
    verified: Awaited<ReturnType<SessionService['verify']>>,
  ) => Promise<T>,
): Promise<T> {
  const auth = requiredCredentials(request, service);
  const controller = new AbortController();
  const abort = () => controller.abort();
  const close = () => {
    if (!reply.raw.writableFinished) abort();
  };
  request.raw.once('aborted', abort);
  reply.raw.once('close', close);
  if (request.raw.aborted || reply.raw.destroyed) abort();
  let raw: string | undefined;
  try {
    const verified = await service.verify(auth.token, auth.scheme, { signal: controller.signal });
    raw = verified.session.raw;
    const result = await read(verified.upstream, controller.signal, verified);
    service.find(auth.token, auth.scheme);
    return result;
  } catch (error) {
    if (error instanceof SubsonicError) {
      if (error.kind === 'not_found' || error.httpStatus === 404)
        throw new ApiError(404, 'not_found');
      if (error.kind === 'protocol_incompatible') throw new ApiError(422, 'upstream_incompatible');
      if (error.kind === 'invalid_request') throw new ApiError(400, 'invalid_request');
    }
    return service.rejectUpstream(error, raw);
  } finally {
    request.raw.off('aborted', abort);
    reply.raw.off('close', close);
  }
}
export function integer(
  value: string | undefined,
  fallback: number,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max)
    throw new ApiError(400, 'invalid_request');
  return result;
}
