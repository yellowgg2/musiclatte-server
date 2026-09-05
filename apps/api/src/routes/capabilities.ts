import type { FastifyInstance } from 'fastify';
import { capabilitiesSchema } from '@musiclatte/contracts';
import type { SessionService } from '../auth/session-service.js';
import { requiredCredentials } from '../auth/guards.js';
import { capabilities } from '../capabilities/registry.js';
export function registerCapabilitiesRoute(app: FastifyInstance, service: SessionService) {
  app.get(
    '/api/v1/capabilities',
    { schema: { response: { 200: capabilitiesSchema } } },
    async (request) => {
      const auth = requiredCredentials(request, service);
      return capabilities(service, await service.verify(auth.token, auth.scheme));
    },
  );
}
