import type { FastifyInstance } from 'fastify';
import {
  playlistIdSchema,
  playlistQuerySchemas,
  playlistResponseSchemas,
  type PlaylistDetailResponse,
  type PlaylistsResponse,
} from '@musiclatte/contracts';
import type { SessionService } from '../../auth/session-service.js';
import { playlistDetail, playlistSummary } from '../../collections/playlist-snapshot.js';
import { libraryRead } from '../../music/library-service.js';

export function registerPlaylistReadRoutes(app: FastifyInstance, service: SessionService) {
  app.get<{ Reply: PlaylistsResponse }>(
    '/api/v1/playlists',
    {
      schema: {
        querystring: playlistQuerySchemas.empty,
        response: { 200: playlistResponseSchemas.list },
      },
    },
    async (request, reply) =>
      libraryRead(service, request, reply, async (upstream, signal, verified) => ({
        schemaVersion: 1,
        playlists: (await upstream.getPlaylists({ signal })).map((playlist) =>
          playlistSummary(
            service,
            { instanceId: verified.session.instanceId, username: verified.identity.username },
            playlist,
          ),
        ),
      })),
  );

  app.get<{ Params: { id: string }; Reply: PlaylistDetailResponse }>(
    '/api/v1/playlists/:id',
    {
      schema: {
        params: playlistIdSchema,
        querystring: playlistQuerySchemas.empty,
        response: { 200: playlistResponseSchemas.detail },
      },
    },
    async (request, reply) =>
      libraryRead(service, request, reply, async (upstream, signal, verified) => ({
        schemaVersion: 1,
        playlist: playlistDetail(
          service,
          { instanceId: verified.session.instanceId, username: verified.identity.username },
          await upstream.getPlaylist(request.params.id, { signal }),
        ),
      })),
  );
}
