import type { FastifyInstance } from 'fastify';
import { discoverySchema, type DiscoveryResponse } from '@musiclatte/contracts';
import type { SessionService } from '../auth/session-service.js';
export function registerDiscoveryRoute(app: FastifyInstance, service: SessionService) {
  app.get<{ Reply: DiscoveryResponse }>(
    '/.well-known/musiclatte-server',
    { schema: { response: { 200: discoverySchema } } },
    async () => ({
      protocol: 'musiclatte-server',
      schemaVersion: 1,
      instanceId: service.options.instances.get().id,
      apiBase: '/api/v1',
      authSchemes: ['cookie', 'bearer'],
    }),
  );
}
