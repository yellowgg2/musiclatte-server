import type { FastifyInstance } from 'fastify';
import {
  musicQuerySchemas,
  musicResponseSchemas,
  type MusicSearchQuery,
} from '@musiclatte/contracts';
import type { SessionService } from '../../auth/session-service.js';
import { integer, libraryRead } from '../../music/library-service.js';
export function registerSearchRoute(app: FastifyInstance, service: SessionService) {
  app.get<{ Querystring: MusicSearchQuery }>(
    '/api/v1/music/search',
    {
      schema: {
        querystring: musicQuerySchemas.search,
        response: { 200: musicResponseSchemas.search },
      },
    },
    async (request, reply) => {
      const query = request.query;
      const options = {
        ...(query.musicFolderId === undefined ? {} : { musicFolderId: query.musicFolderId }),
        artistCount: integer(query.artistCount, 20, 0, 500),
        artistOffset: integer(query.artistOffset, 0),
        albumCount: integer(query.albumCount, 20, 0, 500),
        albumOffset: integer(query.albumOffset, 0),
        songCount: integer(query.songCount, 20, 0, 500),
        songOffset: integer(query.songOffset, 0),
      };
      return libraryRead(service, request, reply, async (upstream, signal) => ({
        schemaVersion: 1,
        result: await upstream.search(query.q, { ...options, signal }),
      }));
    },
  );
}
