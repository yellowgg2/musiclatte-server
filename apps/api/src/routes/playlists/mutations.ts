import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  FastifySchemaValidationError,
} from 'fastify';
import {
  playlistIdSchema,
  playlistMutationSchemas,
  playlistResponseSchemas,
  type PlaylistCreateRequest,
  type PlaylistDeleteRequest,
  type PlaylistDeleteResponse,
  type PlaylistMutationConflictResponse,
  type PlaylistMutationRequest,
  type PlaylistMutationResponse,
} from '@musiclatte/contracts';
import { cookieMutation, requireJSON } from '../../auth/csrf.js';
import { requiredCredentials } from '../../auth/guards.js';
import { ApiError, type SessionService } from '../../auth/session-service.js';
import { createPlaylistMutationService } from '../../collections/playlist-mutations.js';

function validation(request: FastifyRequest): void {
  const error = request.validationError;
  if (!error) return;
  const details = error.validation ?? [];
  const body =
    request.body && typeof request.body === 'object' && !Array.isArray(request.body)
      ? (request.body as Record<string, unknown>)
      : undefined;
  if (
    details.some(
      (item: FastifySchemaValidationError) =>
        item.instancePath === '/name' && ['minLength', 'maxLength'].includes(item.keyword),
    ) &&
    (body?.action === undefined || body.action === 'rename')
  )
    throw new ApiError(422, 'invalid_request');
  throw new ApiError(400, 'invalid_request');
}

async function boundary<T>(
  request: FastifyRequest,
  service: SessionService,
  work: (
    verified: Awaited<ReturnType<SessionService['verify']>>,
    signal: AbortSignal,
  ) => Promise<T>,
): Promise<T> {
  const auth = requiredCredentials(request, service);
  requireJSON(request);
  if (auth.scheme === 'cookie') cookieMutation(request, service, auth.token);
  validation(request);
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.raw.once('aborted', abort);
  if (request.raw.destroyed) abort();
  try {
    const verified = await service.verify(auth.token, auth.scheme, { signal: controller.signal });
    const result = await work(verified, controller.signal);
    service.find(auth.token, auth.scheme);
    return result;
  } finally {
    request.raw.off('aborted', abort);
  }
}

function sendResult(
  reply: FastifyReply,
  result: PlaylistMutationResponse | PlaylistDeleteResponse | PlaylistMutationConflictResponse,
  successCode: 200 | 201,
) {
  if ('error' in result) return reply.code(409).send(result);
  return reply.code(successCode).send(result);
}

export function registerPlaylistMutationRoutes(app: FastifyInstance, service: SessionService) {
  const mutations = createPlaylistMutationService(service);
  app.post<{ Body: PlaylistCreateRequest }>(
    '/api/v1/playlists',
    {
      attachValidation: true,
      schema: {
        body: playlistMutationSchemas.create,
        querystring: playlistMutationSchemas.empty,
        response: {
          201: playlistResponseSchemas.mutation,
          409: playlistResponseSchemas.mutationConflict,
        },
      },
    },
    async (request, reply) =>
      sendResult(
        reply,
        await boundary(request, service, (verified, signal) =>
          mutations.create(verified, request.body, signal),
        ),
        201,
      ),
  );
  app.patch<{ Params: { id: string }; Body: PlaylistMutationRequest }>(
    '/api/v1/playlists/:id',
    {
      attachValidation: true,
      schema: {
        params: playlistIdSchema,
        querystring: playlistMutationSchemas.empty,
        body: playlistMutationSchemas.patch,
        response: {
          200: playlistResponseSchemas.mutation,
          409: playlistResponseSchemas.mutationConflict,
        },
      },
    },
    async (request, reply) =>
      sendResult(
        reply,
        await boundary(request, service, (verified, signal) =>
          mutations.mutate(verified, request.params.id, request.body, signal),
        ),
        200,
      ),
  );
  app.delete<{ Params: { id: string }; Body: PlaylistDeleteRequest }>(
    '/api/v1/playlists/:id',
    {
      attachValidation: true,
      schema: {
        params: playlistIdSchema,
        querystring: playlistMutationSchemas.empty,
        body: playlistMutationSchemas.delete,
        response: {
          200: playlistResponseSchemas.deleted,
          409: playlistResponseSchemas.mutationConflict,
        },
      },
    },
    async (request, reply) =>
      sendResult(
        reply,
        await boundary(request, service, (verified, signal) =>
          mutations.delete(verified, request.params.id, request.body, signal),
        ),
        200,
      ),
  );
}
