import type { FastifyInstance } from 'fastify';
import {
  createMixSchema,
  updateMixSchema,
  deleteMixSchema,
  parseMixJson,
} from '@musiclatte/contracts';
import { cookieMutation, requireJSON } from '../auth/csrf.js';
import { requiredCredentials } from '../auth/guards.js';
import { ApiError, type SessionService } from '../auth/session-service.js';
import { libraryRead } from '../music/library-service.js';
import { createMixService, type MixRequest } from '../mixes/service.js';
const empty = { type: 'object', additionalProperties: false, properties: {} } as const;
const params = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;
export function registerMixRoutes(app: FastifyInstance, service: SessionService) {
  const mixes = createMixService(service);
  app.register(async (scope) => {
    scope.removeContentTypeParser('application/json');
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'string' },
      (_request, body, done) => {
        try {
          done(null, parseMixJson(String(body)));
        } catch {
          done(new ApiError(400, 'invalid_request'));
        }
      },
    );
    scope.get<{ Querystring: { cursor?: string; limit?: string } }>(
      '/api/v1/mixes',
      {
        attachValidation: true,
        schema: {
          querystring: {
            type: 'object',
            additionalProperties: false,
            properties: {
              cursor: { type: 'string', maxLength: 2048 },
              limit: { type: 'string', pattern: '^[1-9][0-9]*$' },
            },
          },
        },
      },
      async (request, reply) =>
        libraryRead(service, request, reply, async (_upstream, _signal, verified) => {
          if (request.validationError) throw new ApiError(400, 'invalid_request');
          return mixes.list(verified, request.query);
        }),
    );
    for (const suffix of ['', '/songs'])
      scope.get<{ Params: { id: string } }>(
        `/api/v1/mixes/:id${suffix}`,
        { attachValidation: true, schema: { params, querystring: empty } },
        async (request, reply) =>
          libraryRead(service, request, reply, async (_upstream, signal, verified) => {
            if (request.validationError) throw new ApiError(400, 'invalid_request');
            return suffix
              ? mixes.songs(verified, request.params.id, signal)
              : mixes.get(verified, request.params.id);
          }),
      );
    for (const [method, kind, schema] of [
      ['POST', 'create', createMixSchema],
      ['PATCH', 'update', updateMixSchema],
      ['DELETE', 'delete', deleteMixSchema],
    ] as const)
      scope.route<{ Params: { id?: string }; Body: MixRequest }>({
        method,
        url: kind === 'create' ? '/api/v1/mixes' : '/api/v1/mixes/:id',
        attachValidation: true,
        schema: { body: schema, querystring: empty, ...(kind === 'create' ? {} : { params }) },
        async handler(request, reply) {
          const auth = requiredCredentials(request, service);
          requireJSON(request);
          if (auth.scheme === 'cookie') cookieMutation(request, service, auth.token);
          if (request.validationError) throw new ApiError(400, 'invalid_request');
          const result = await libraryRead(
            service,
            request,
            reply,
            async (_upstream, signal, verified) =>
              mixes.mutate(verified, kind, request.params.id, request.body, signal),
          );
          return reply.code(kind === 'create' ? 201 : 200).send(result);
        },
      });
    scope.get('/api/v1/music/genres', async (request, reply) =>
      libraryRead(service, request, reply, async (upstream, signal) => {
        if (!service.options.mixes) throw new ApiError(404, 'not_found');
        if (Object.keys(request.query as object).length) throw new ApiError(400, 'invalid_request');
        return { schemaVersion: 1, genres: await upstream.genres({ signal }) };
      }),
    );
  });
}
