import type { FastifyInstance } from 'fastify';
import { musicIdSchema, musicQuerySchemas, musicResponseSchemas } from '@musiclatte/contracts';
import type { SessionService } from '../../auth/session-service.js';
import { libraryRead } from '../../music/library-service.js';
export function registerAlbumRoute(app: FastifyInstance, service: SessionService) {
  app.get<{ Params: { id: string } }>(
    '/api/v1/music/albums/:id',
    {
      schema: {
        params: musicIdSchema,
        querystring: musicQuerySchemas.empty,
        response: { 200: musicResponseSchemas.album },
      },
    },
    async (request, reply) =>
      libraryRead(service, request, reply, async (upstream, signal) => ({
        schemaVersion: 1,
        album: await upstream.album(request.params.id, { signal }),
      })),
  );
}
