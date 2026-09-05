import {
  mediaRequestHeaderNames,
  mediaResponseHeaderNames,
  type MediaTransportKind,
} from '@musiclatte/contracts';
import { ApiError } from '../auth/session-service.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

function single(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new ApiError(400, 'invalid_request');
  return value;
}

export function forwardMediaRequestHeaders(request: FastifyRequest, upstream: Request): void {
  upstream.headers.set('accept-encoding', 'identity');
  for (const name of mediaRequestHeaderNames) {
    const value = single(request.headers[name]);
    if (value !== undefined) upstream.headers.set(name, value);
  }
}

export function forwardMediaResponseHeaders(response: Response, reply: FastifyReply): void {
  for (const name of mediaResponseHeaderNames) {
    const value = response.headers.get(name);
    if (value !== null) reply.header(name, value);
  }
}

export function validMediaType(kind: MediaTransportKind, value: string | null): boolean {
  if (!value) return false;
  const mediaType = value.split(';', 1)[0]!.trim().toLowerCase();
  return kind === 'cover'
    ? mediaType.startsWith('image/')
    : mediaType.startsWith('audio/') ||
        mediaType.startsWith('video/') ||
        mediaType === 'application/octet-stream' ||
        mediaType === 'application/ogg';
}
