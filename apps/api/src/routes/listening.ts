import type { FastifyInstance } from 'fastify';
import { parseMixJson } from '@musiclatte/contracts';
import { cookieMutation, requireJSON } from '../auth/csrf.js';
import { requiredCredentials } from '../auth/guards.js';
import { ApiError, type SessionService } from '../auth/session-service.js';
import { libraryRead } from '../music/library-service.js';
import { createListeningService, type ListeningQuery } from '../listening/service.js';
export function registerListeningRoutes(app: FastifyInstance, service: SessionService) {
  const listening = createListeningService(service);
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
    scope.post('/api/v1/listening/events', async (request, reply) => {
      const auth = requiredCredentials(request, service);
      requireJSON(request);
      if (auth.scheme === 'cookie') cookieMutation(request, service, auth.token);
      if (Object.keys(request.query as object).length) throw new ApiError(400, 'invalid_request');
      const result = await libraryRead(service, request, reply, async (_upstream, signal, v) =>
        listening.record(v, request.body, signal),
      );
      return reply.code(201).send(result);
    });
    for (const [suffix, purpose] of [
      ['history', 'history'],
      ['top-songs', 'top'],
    ] as const)
      scope.get<{ Querystring: ListeningQuery }>(
        `/api/v1/listening/${suffix}`,
        {
          attachValidation: true,
          schema: {
            querystring: {
              type: 'object',
              additionalProperties: false,
              properties: {
                from: { type: 'string', maxLength: 30 },
                to: { type: 'string', maxLength: 30 },
                limit: { type: 'string', pattern: '^[1-9][0-9]*$' },
                cursor: { type: 'string', maxLength: 4096 },
              },
            },
          },
        },
        async (request, reply) =>
          libraryRead(service, request, reply, async (_upstream, signal, v) => {
            if (request.validationError) throw new ApiError(400, 'invalid_request');
            return listening.list(v, purpose, request.query, signal);
          }),
      );
  });
}
