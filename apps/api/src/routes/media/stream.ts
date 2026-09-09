import { musicIdSchema } from '@musiclatte/contracts';
import type { FastifyInstance } from 'fastify';
import { ApiError, type SessionService } from '../../auth/session-service.js';
import { proxyMedia } from '../../media/proxy.js';
import { parseStreamQuery, playbackPlan } from '../../media/playback-plan.js';
export function registerStreamRoute(app: FastifyInstance, service: SessionService) {
  app.get<{ Params: { id: string } }>(
    '/api/v1/media/songs/:id/stream',
    { exposeHeadRoute: true, schema: { params: musicIdSchema } },
    async (request, reply) =>
      proxyMedia(service, request, reply, 'audio', request.params.id, {
        streamOptions: async (verified, signal) => {
          const query = parseStreamQuery(request.query);
          if (!query.quality) return {};
          if (!service.options.streamQuality) throw new ApiError(404, 'not_found');
          if (query.quality === 'economy') {
            const plan = await playbackPlan(
              verified.upstream,
              request.params.id,
              query.quality,
              signal,
            );
            if (plan.effectiveQuality !== 'economy')
              throw new ApiError(409, 'playback_plan_changed');
            if (query.offset !== undefined && Number(query.offset) >= plan.durationSeconds!)
              throw new ApiError(400, 'invalid_request');
          }
          return {
            quality: query.quality,
            ...(query.offset === undefined ? {} : { offset: Number(query.offset) }),
          };
        },
      }),
  );
}
