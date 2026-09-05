import type { FastifyInstance } from 'fastify';
import {
  sessionExchangeSchema,
  sessionResponseSchema,
  type SessionExchange,
} from '@musiclatte/contracts';
import { ApiError, type SessionService } from '../auth/session-service.js';
import { credentials, requiredCredentials } from '../auth/guards.js';
import { cookieMutation, requireJSON } from '../auth/csrf.js';
export function registerSessionRoutes(app: FastifyInstance, service: SessionService) {
  app.post<{ Body: SessionExchange }>(
    '/api/v1/session',
    { schema: { body: sessionExchangeSchema, response: { 201: sessionResponseSchema } } },
    async (request, reply) => {
      requireJSON(request);
      const native = request.headers['x-musiclatte-client'] === 'native';
      const scheme = native ? 'bearer' : 'cookie';
      const old = credentials(request, service, false);
      if (old && old.scheme !== scheme) throw new ApiError(400, 'invalid_request');
      if (native) {
        if (
          request.headers.origin !== undefined ||
          request.headers.cookie !== undefined ||
          request.headers['sec-fetch-site'] !== undefined
        )
          throw new ApiError(403, 'csrf_rejected');
      } else cookieMutation(request, service, old?.token);
      const result = await service.login(request.body, scheme, old?.token);
      if (scheme === 'cookie')
        reply.header('Set-Cookie', service.cookie(result.session.token, result.session.expiresAt));
      return reply.code(201).send(result.body);
    },
  );
  app.get(
    '/api/v1/session',
    { schema: { response: { 200: sessionResponseSchema } } },
    async (request) => {
      const auth = requiredCredentials(request, service);
      const { session } = await service.verify(auth.token, auth.scheme);
      return service.response(session);
    },
  );
  app.delete('/api/v1/session', async (request, reply) => {
    const auth = requiredCredentials(request, service);
    if (auth.scheme === 'cookie') cookieMutation(request, service, auth.token);
    service.logout(auth.token, auth.scheme);
    if (auth.scheme === 'cookie') reply.header('Set-Cookie', service.cookie(''));
    return reply.code(204).send();
  });
}
