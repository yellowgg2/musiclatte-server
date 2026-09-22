import type { MediaOptions } from '../subsonic/client.js';
import { qualityRequestHeaders, qualityResponseHeaders } from './quality-headers.js';
import { Readable } from 'node:stream';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { MediaTransportKind } from '@musiclatte/contracts';
import { requiredCredentials } from '../auth/guards.js';
import { ApiError, type SessionService } from '../auth/session-service.js';
import { SubsonicError } from '../subsonic/errors.js';
import { createConcurrencyLimit } from './concurrency.js';
import {
  forwardMediaRequestHeaders,
  forwardMediaResponseHeaders,
  validMediaType,
} from './headers.js';

const passthroughStatuses = new Set([200, 206, 304, 416]);
const coverLimits = new WeakMap<SessionService, ReturnType<typeof createConcurrencyLimit>>();

export function safeMediaFailure(kind: string, stage: string, classification: string) {
  return JSON.stringify({ event: 'media_proxy_failure', kind, stage, classification });
}

function failureClassification(error: unknown) {
  if (error instanceof ApiError) return `api:${error.status}:${error.code}`;
  if (error instanceof SubsonicError) return `subsonic:${error.kind}:${error.httpStatus ?? 'none'}`;
  return error instanceof Error ? `error:${error.name}` : 'unknown';
}

function coverLimit(service: SessionService) {
  let limit = coverLimits.get(service);
  if (!limit) {
    limit = createConcurrencyLimit(1);
    coverLimits.set(service, limit);
  }
  return limit;
}

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
  options?: {
    freshCover?: boolean;
    streamOptions?: (
      verified: Awaited<ReturnType<SessionService['verify']>>,
      signal: AbortSignal,
    ) => Promise<Pick<MediaOptions, 'quality' | 'offset'>>;
    authorize?: (verified: Awaited<ReturnType<SessionService['verify']>>) => Promise<void>;
  },
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
  let releaseCover: (() => void) | undefined;
  let stage = 'identity';
  try {
    const verified = await service.verify(auth.token, auth.scheme, {
      signal: controller.signal,
      reuseIdentity: true,
    });
    raw = verified.session.raw;
    stage = 'queue';
    if (kind === 'cover') releaseCover = await coverLimit(service).acquire(controller.signal);
    stage = 'authorize';
    await options?.authorize?.(verified);
    stage = 'options';
    const streamOptions = await options?.streamOptions?.(verified, controller.signal);
    const range = options?.freshCover ? undefined : request.headers.range;
    if (range !== undefined && typeof range !== 'string')
      throw new ApiError(400, 'invalid_request');
    const upstreamRequest = verified.upstream.mediaRequest(
      kind === 'audio' ? 'stream' : 'getCoverArt',
      id,
      {
        ...streamOptions,
        method: request.method === 'HEAD' ? 'HEAD' : 'GET',
        signal: controller.signal,
        ...(range === undefined ? {} : { range }),
      },
    );
    if (!options?.freshCover) forwardMediaRequestHeaders(request, upstreamRequest);

    if (streamOptions?.quality) qualityRequestHeaders(upstreamRequest, streamOptions);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, service.options.timeoutMs);
    let response: Response;
    try {
      stage = 'fetch';
      response = await fetch(upstreamRequest, { redirect: 'manual' });
    } catch {
      throw new SubsonicError(
        timedOut ? 'timeout' : controller.signal.aborted ? 'cancelled' : 'network',
      );
    } finally {
      clearTimeout(timer);
    }

    stage = 'validate';
    service.find(auth.token, auth.scheme);
    if (
      !passthroughStatuses.has(response.status) ||
      (options?.freshCover && response.status !== 200)
    ) {
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
    if (streamOptions?.quality) qualityResponseHeaders(response, reply, streamOptions);
    if (options?.freshCover) reply.header('Cache-Control', 'private, no-store');
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
    const finish = () => {
      releaseCover?.();
      releaseCover = undefined;
      cleanup();
    };
    body.once('end', finish);
    body.once('close', finish);
    body.once('error', finish);
    streaming = true;
    return reply.send(body);
  } catch (error) {
    if (process.env.NODE_ENV === 'production')
      process.stderr.write(`${safeMediaFailure(kind, stage, failureClassification(error))}\n`);
    if (error instanceof ApiError) throw error;
    if (error instanceof SubsonicError) {
      if (error.kind === 'invalid_request') throw new ApiError(400, 'invalid_request');
      if (error.kind === 'not_found' || error.httpStatus === 404)
        throw new ApiError(404, 'not_found');
    }
    return service.rejectUpstream(error, raw);
  } finally {
    if (!streaming) {
      releaseCover?.();
      cleanup();
    }
  }
}
