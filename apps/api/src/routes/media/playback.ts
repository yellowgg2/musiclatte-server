import { musicIdSchema } from '@musiclatte/contracts';
import type { FastifyInstance } from 'fastify';
import { ApiError, type SessionService } from '../../auth/session-service.js';
import { libraryRead } from '../../music/library-service.js';
import { parseStreamQuery, playbackPlan } from '../../media/playback-plan.js';
export function registerPlaybackRoute(app: FastifyInstance, service: SessionService) {
  app.get<{ Params: { id: string } }>(
    '/api/v1/media/songs/:id/playback',
    { schema: { params: musicIdSchema } },
    async (request, reply) =>
      libraryRead(service, request, reply, async (upstream, signal) => {
        if (!service.options.streamQuality) throw new ApiError(404, 'not_found');
        const query = parseStreamQuery(request.query, true);
        return playbackPlan(upstream, request.params.id, query.quality!, signal);
      }),
  );
}
