import type { FastifyInstance, FastifyRequest } from 'fastify';
import { accessTokenRequestSchema, type AccessTokenRequest } from '@musiclatte/contracts';
import { ApiError, type SessionService } from '../auth/session-service.js';
import { createAccessTokenService } from '../auth/access-token-service.js';
import { requiredCredentials } from '../auth/guards.js';
import { cookieMutation, requireJSON } from '../auth/csrf.js';
export function registerAccessTokenRoutes(app: FastifyInstance, service: SessionService) {
  const tokens = service.options.automation
    ? createAccessTokenService(service, service.options.automation)
    : undefined;
  async function owner(request: FastifyRequest, mutation: boolean) {
    const auth = requiredCredentials(request, service);
    if (auth.token.startsWith('mlpat_') || !tokens) throw new ApiError(403, 'forbidden');
    if (mutation) {
      if (auth.scheme === 'cookie') cookieMutation(request, service, auth.token);
      else if (request.method !== 'DELETE') requireJSON(request);
    }
    return service.verify(auth.token, auth.scheme);
  }
  const empty = { type: 'object', additionalProperties: false, properties: {} } as const;
  app.get('/api/v1/access-tokens/options', { schema: { querystring: empty } }, async (request) => {
    const verified = await owner(request, false);
    return tokens!.creationOptions(verified);
  });
  app.post<{ Body: AccessTokenRequest }>(
    '/api/v1/access-tokens',
    { schema: { body: accessTokenRequestSchema, querystring: empty } },
    async (request, reply) => {
      const verified = await owner(request, true);
      const result = await tokens!.create(verified, request.body);
      return reply.code(201).send(result);
    },
  );
  app.get<{ Querystring: { cursor?: string; limit?: string } }>(
    '/api/v1/access-tokens',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: { type: 'string', minLength: 1, maxLength: 2048 },
            limit: { type: 'string', pattern: '^(?:[1-9]|[1-9][0-9]|100)$' },
          },
        },
      },
    },
    async (request) => {
      const verified = await owner(request, false);
      try {
        return {
          schemaVersion: 1,
          ...tokens!.repository.listOwned(verified.identity.username, {
            ...(request.query.cursor ? { cursor: request.query.cursor } : {}),
            ...(request.query.limit ? { limit: Number(request.query.limit) } : {}),
          }),
        };
      } catch (error) {
        if (
          error instanceof Error &&
          ['Invalid token cursor', 'Invalid token limit'].includes(error.message)
        )
          throw new ApiError(400, 'invalid_request');
        throw error;
      }
    },
  );
  app.delete<{ Params: { id: string } }>(
    '/api/v1/access-tokens/:id',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['id'],
          properties: { id: { type: 'string', maxLength: 36, minLength: 36 } },
        },
        querystring: empty,
      },
    },
    async (request, reply) => {
      const verified = await owner(request, true);
      if (!tokens!.repository.revokeOwned(verified.identity.username, request.params.id))
        throw new ApiError(404, 'not_found');
      return reply.code(204).send();
    },
  );
}
