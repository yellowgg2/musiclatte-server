import type { FastifyInstance } from 'fastify';
import { artistInfoResponseSchema, musicIdSchema, musicQuerySchemas } from '@musiclatte/contracts';
import type { SessionService } from '../../auth/session-service.js';
import { libraryRead } from '../../music/library-service.js';
import { readArtistInfo } from '../../music/artist-info-service.js';

export function registerArtistInfoRoute(app: FastifyInstance, service: SessionService) {
  app.get<{ Params: { id: string } }>(
    '/api/v1/music/artists/:id/info',
    {
      schema: {
        params: musicIdSchema,
        querystring: musicQuerySchemas.empty,
        response: { 200: artistInfoResponseSchema },
      },
    },
    async (request, reply) =>
      libraryRead(service, request, reply, (upstream, signal) =>
        readArtistInfo(upstream, request.params.id, signal),
      ),
  );
}
