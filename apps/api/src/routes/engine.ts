import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  engineActionSchema,
  engineEmptySchema,
  engineStatusSchema,
  type EngineActionRequest,
} from '@musiclatte/contracts';
import { cookieMutation } from '../auth/csrf.js';
import { requiredCredentials } from '../auth/guards.js';
import { ApiError, type SessionService } from '../auth/session-service.js';
import { createEngineService } from '../engine/engine-service.js';

export function registerEngineRoutes(app: FastifyInstance, service: SessionService) {
  const engine = createEngineService(service);
  const boundary = async (request: FastifyRequest, mutation: boolean) => {
    const auth = requiredCredentials(request, service);
    if (mutation) {
      if (auth.scheme !== 'cookie') throw new ApiError(403, 'forbidden');
      cookieMutation(request, service, auth.token);
    }
    if (
      request.validationError ||
      request.url.includes('?') ||
      (!mutation && request.body !== undefined)
    )
      throw new ApiError(400, 'invalid_request');
    // Re-read the role after the first network boundary; no await follows final admission.
    await service.verify(auth.token, auth.scheme);
    return service.verify(auth.token, auth.scheme);
  };
  app.get(
    '/api/v1/engine',
    {
      attachValidation: true,
      schema: { querystring: engineEmptySchema, response: { 200: engineStatusSchema } },
    },
    async (request) => engine.get(await boundary(request, false)),
  );
  app.post<{ Body: EngineActionRequest }>(
    '/api/v1/engine',
    {
      attachValidation: true,
      schema: {
        querystring: engineEmptySchema,
        body: engineActionSchema,
        response: { 202: engineStatusSchema },
      },
    },
    async (request, reply) =>
      reply.code(202).send(engine.request(await boundary(request, true), request.body)),
  );
}
