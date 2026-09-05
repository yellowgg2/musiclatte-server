import type { FastifyInstance } from 'fastify';
import { ApiError, type SessionService } from '../auth/session-service.js';
import { requiredCredentials } from '../auth/guards.js';
import { cookieMutation, requireJSON } from '../auth/csrf.js';
export function registerScanRoute(app: FastifyInstance, service: SessionService) {
  app.post(
    '/api/v1/scan',
    { schema: { body: { type: 'object', properties: {}, additionalProperties: false } } },
    async (request) => {
      const auth = requiredCredentials(request, service);
      requireJSON(request);
      if (auth.scheme === 'cookie') cookieMutation(request, service, auth.token);
      const { session, identity, upstream } = await service.verify(auth.token, auth.scheme);
      if (!service.options.allowScan || identity.adminRole !== true)
        throw new ApiError(403, 'forbidden');
      try {
        await upstream.startScan();
        return { schemaVersion: 1, accepted: true };
      } catch (error) {
        return service.rejectUpstream(error, session.raw);
      }
    },
  );
}
