import type { FastifyInstance } from 'fastify';
import {
  musicQuerySchemas,
  musicResponseSchemas,
  type MusicRandomQuery,
} from '@musiclatte/contracts';
import { ApiError, type SessionService } from '../../auth/session-service.js';
import { integer, libraryRead } from '../../music/library-service.js';
export function registerRandomRoute(app: FastifyInstance, service: SessionService) {
  app.get<{ Querystring: MusicRandomQuery }>(
    '/api/v1/music/random',
    {
      schema: {
        querystring: musicQuerySchemas.random,
        response: { 200: musicResponseSchemas.random },
      },
    },
    async (request, reply) => {
      const query = request.query;
      const options = {
        size: integer(query.size, 50, 1, 500),
        ...(query.musicFolderId === undefined ? {} : { musicFolderId: query.musicFolderId }),
        ...(query.genre === undefined ? {} : { genre: query.genre }),
        ...(query.fromYear === undefined ? {} : { fromYear: integer(query.fromYear, 0, 0, 9999) }),
        ...(query.toYear === undefined ? {} : { toYear: integer(query.toYear, 0, 0, 9999) }),
      };
      if (
        options.fromYear !== undefined &&
        options.toYear !== undefined &&
        options.fromYear > options.toYear
      )
        throw new ApiError(400, 'invalid_request');
      return libraryRead(service, request, reply, async (upstream, signal) => ({
        schemaVersion: 1,
        songs: await upstream.random({ ...options, signal }),
      }));
    },
  );
}
