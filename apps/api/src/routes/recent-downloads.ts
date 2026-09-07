import type { FastifyInstance } from 'fastify';
import {
  recentQuerySchema,
  recentResponseSchema,
  type RecentDownloadQuery,
} from '@musiclatte/contracts';
import { requiredCredentials } from '../auth/guards.js';
import { ApiError, type SessionService } from '../auth/session-service.js';
import { createRecentService } from '../imports/recent-service.js';

export function registerRecentDownloadsRoute(app: FastifyInstance, service: SessionService) {
  const recent = createRecentService(service);
  app.get<{ Querystring: RecentDownloadQuery }>(
    '/api/v1/recent-downloads',
    {
      attachValidation: true,
      schema: { querystring: recentQuerySchema, response: { 200: recentResponseSchema } },
    },
    async (request, reply) => {
      const auth = requiredCredentials(request, service);
      if (request.validationError) throw new ApiError(400, 'invalid_request');
      const abort = new AbortController();
      const cancel = () => {
        if (!reply.raw.writableFinished) abort.abort();
      };
      reply.raw.on('close', cancel);
      try {
        const verified = await service.verify(auth.token, auth.scheme, { signal: abort.signal });
        const response = await recent.list(verified, request.query, abort.signal);
        await service.verify(auth.token, auth.scheme, { signal: abort.signal });
        return response;
      } finally {
        reply.raw.off('close', cancel);
      }
    },
  );
}
