import { musicIdSchema, musicQuerySchemas } from '@musiclatte/contracts';
import type { FastifyInstance } from 'fastify';
import type { SessionService } from '../../auth/session-service.js';
import { proxyMedia } from '../../media/proxy.js';

export function registerStreamRoute(app: FastifyInstance, service: SessionService) {
  app.get<{ Params: { id: string } }>(
    '/api/v1/media/songs/:id/stream',
    {
      exposeHeadRoute: true,
      schema: { params: musicIdSchema, querystring: musicQuerySchemas.empty },
    },
    async (request, reply) => proxyMedia(service, request, reply, 'audio', request.params.id),
  );
}
