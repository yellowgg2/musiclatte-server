import { Readable } from 'node:stream';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { MediaTransportKind } from '@musiclatte/contracts';
import { requiredCredentials } from '../auth/guards.js';
import { ApiError, type SessionService } from '../auth/session-service.js';
import { SubsonicError } from '../subsonic/errors.js';
import {
  forwardMediaRequestHeaders,
  forwardMediaResponseHeaders,
  validMediaType,
} from './headers.js';

const passthroughStatuses = new Set([200, 206, 304, 416]);

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    /* The response is already unusable and will not be exposed. */
  }
}

export async function proxyMedia(
  service: SessionService,
  request: FastifyRequest,
  reply: FastifyReply,
  kind: MediaTransportKind,
  id: string,
) {
  const auth = requiredCredentials(request, service);
  const controller = new AbortController();
  const abort = () => controller.abort();
  const close = () => {
    if (!reply.raw.writableFinished) abort();
  };
  const cleanup = () => {
    request.raw.off('aborted', abort);
    reply.raw.off('close', close);
  };
  request.raw.once('aborted', abort);
  reply.raw.once('close', close);
  if (request.raw.aborted || reply.raw.destroyed) abort();

  let raw: string | undefined;
  let streaming = false;
  try {
    const verified = await service.verify(auth.token, auth.scheme, { signal: controller.signal });
    raw = verified.session.raw;
    const range = request.headers.range;
    if (range !== undefined && typeof range !== 'string')
      throw new ApiError(400, 'invalid_request');
    const upstreamRequest = verified.upstream.mediaRequest(
      kind === 'audio' ? 'stream' : 'getCoverArt',
      id,
      {
        method: request.method === 'HEAD' ? 'HEAD' : 'GET',
        signal: controller.signal,
        ...(range === undefined ? {} : { range }),
      },
    );
    forwardMediaRequestHeaders(request, upstreamRequest);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, service.options.timeoutMs);
    let response: Response;
    try {
      response = await fetch(upstreamRequest, { redirect: 'manual' });
    } catch {
      throw new SubsonicError(
        timedOut ? 'timeout' : controller.signal.aborted ? 'cancelled' : 'network',
      );
    } finally {
      clearTimeout(timer);
    }

    service.find(auth.token, auth.scheme);
    if (!passthroughStatuses.has(response.status)) {
      await discard(response);
      if (response.status === 404) throw new ApiError(404, 'not_found');
      throw new SubsonicError('http_error', undefined, response.status);
    }
    if (
      (response.status === 200 || response.status === 206) &&
      !validMediaType(kind, response.headers.get('content-type'))
    ) {
      await discard(response);
      throw new SubsonicError('invalid_response');
    }

    reply.code(response.status);
    forwardMediaResponseHeaders(response, reply);
    if (request.method === 'HEAD' || response.status === 304 || response.status === 416) {
      await discard(response);
      reply.hijack();
      reply.raw.statusCode = response.status;
      for (const [name, value] of Object.entries(reply.getHeaders()))
        if (value !== undefined) reply.raw.setHeader(name, value);
      reply.raw.end();
      return reply;
    }
    if (!response.body) throw new SubsonicError('invalid_response');

    const body = Readable.from(response.body);
    body.once('end', cleanup);
    body.once('close', cleanup);
    body.once('error', cleanup);
    streaming = true;
    return reply.send(body);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof SubsonicError) {
      if (error.kind === 'invalid_request') throw new ApiError(400, 'invalid_request');
      if (error.kind === 'not_found' || error.httpStatus === 404)
        throw new ApiError(404, 'not_found');
    }
    return service.rejectUpstream(error, raw);
  } finally {
    if (!streaming) cleanup();
  }
}
