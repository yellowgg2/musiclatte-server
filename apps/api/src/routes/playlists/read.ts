import type { FastifyInstance } from 'fastify';
import {
  playlistIdSchema,
  playlistQuerySchemas,
  playlistResponseSchemas,
  type PlaylistDetailResponse,
  type PlaylistArtworkResponse,
  type PlaylistsResponse,
} from '@musiclatte/contracts';
import type { SessionService } from '../../auth/session-service.js';
import {
  firstPlaylistCover,
  playlistDetail,
  playlistSummary,
} from '../../collections/playlist-snapshot.js';
import { libraryRead } from '../../music/library-service.js';
import { ApiError } from '../../auth/session-service.js';

export function registerPlaylistReadRoutes(app: FastifyInstance, service: SessionService) {
  app.get<{ Params: { id: string }; Reply: PlaylistArtworkResponse }>(
    '/api/v1/playlists/:id/artwork',
    {
      schema: {
        params: playlistIdSchema,
        querystring: playlistQuerySchemas.empty,
        response: { 200: playlistResponseSchemas.artwork },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      return libraryRead(service, request, reply, async (upstream, signal) => {
        const playlist = await upstream.getPlaylist(request.params.id, { signal });
        if (playlist.id !== request.params.id) throw new ApiError(503, 'upstream_unavailable');
        const coverArt = firstPlaylistCover(playlist);
        return coverArt
          ? { schemaVersion: 1, playlistId: playlist.id, coverState: 'available', coverArt }
          : { schemaVersion: 1, playlistId: playlist.id, coverState: 'fallback' };
      });
    },
  );

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
