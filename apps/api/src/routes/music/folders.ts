import type { FastifyInstance } from 'fastify';
import { musicIdSchema, musicQuerySchemas, musicResponseSchemas } from '@musiclatte/contracts';
import type { SessionService } from '../../auth/session-service.js';
import { libraryRead } from '../../music/library-service.js';
export function registerFoldersRoutes(app: FastifyInstance, service: SessionService) {
  app.get<{ Querystring: { musicFolderId?: string } }>(
    '/api/v1/music/folders',
    {
      schema: {
        querystring: musicQuerySchemas.folders,
        response: { 200: musicResponseSchemas.folders },
      },
    },
    async (request, reply) =>
      libraryRead(service, request, reply, async (upstream, signal) =>
        request.query.musicFolderId === undefined
          ? { schemaVersion: 1, folders: await upstream.folders({ signal }) }
          : {
              schemaVersion: 1,
              indexes: await upstream.indexes(request.query.musicFolderId, { signal }),
            },
      ),
  );
  app.get<{ Params: { id: string } }>(
    '/api/v1/music/folders/:id',
    {
      schema: {
        params: musicIdSchema,
        querystring: musicQuerySchemas.empty,
        response: { 200: musicResponseSchemas.directory },
      },
    },
    async (request, reply) =>
      libraryRead(service, request, reply, async (upstream, signal) => ({
        schemaVersion: 1,
        directory: await upstream.directory(request.params.id, { signal }),
      })),
  );
}
