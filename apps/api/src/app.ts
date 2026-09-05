import { ApiError, createSessionService, type AuthOptions } from './auth/session-service.js';
import { registerSessionRoutes } from './routes/session.js';
import { registerDiscoveryRoute } from './routes/discovery.js';
import { registerCapabilitiesRoute } from './routes/capabilities.js';
import { registerScanRoute } from './routes/scan.js';
import Fastify from 'fastify';
import { isIP } from 'node:net';
import type { HealthResponse } from '@musiclatte/contracts';

export function readConfig(env: Record<string, string | undefined>) {
  const host = env.HOST ?? '127.0.0.1';
  const rawPort = env.PORT ?? '3000';
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!isIP(host) && host !== 'localhost') throw new Error('Invalid HOST');
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535)
    throw new Error('Invalid PORT');
  if (!['development', 'test', 'production'].includes(nodeEnv)) throw new Error('Invalid NODE_ENV');
  return { host, port: Number(rawPort), nodeEnv };
}

export function createApp(options?: AuthOptions) {
  const app = Fastify({
    logger: false,
    bodyLimit: 16_384,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } },
  });
  // Do not serialize request URLs, bodies, cookies, auth headers or raw upstream errors.
  let service: ReturnType<typeof createSessionService> | undefined;
  app.setErrorHandler((error, request, reply) => {
    const status =
      error &&
      typeof error === 'object' &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    const safe =
      error instanceof ApiError
        ? error
        : error instanceof Error && error.message === 'Storage unavailable'
          ? new ApiError(503, 'storage_unavailable')
          : status >= 400 && status < 500
            ? new ApiError(status, 'invalid_request')
            : new ApiError(500, 'internal_error');
    const activeService = service;
    if (
      safe.status === 401 &&
      activeService &&
      request.headers.cookie
        ?.split(';')
        .some((cookie) => cookie.trim().startsWith(`${activeService.cookieName}=`))
    )
      reply.header('Set-Cookie', activeService.cookie(''));
    reply
      .code(safe.status)
      .send({ schemaVersion: 1, error: { code: safe.code, retryable: safe.status >= 500 } });
  });
  app.setNotFoundHandler(async (_request, reply) =>
    reply.code(404).send({ schemaVersion: 1, error: { code: 'not_found', retryable: false } }),
  );
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (
      ['/api/v1/session', '/api/v1/capabilities', '/api/v1/scan'].includes(
        request.url.split('?')[0]!,
      ) &&
      request.url.includes('?')
    )
      throw new ApiError(400, 'invalid_request');
  });
  if (options) {
    service = createSessionService(options);
    registerSessionRoutes(app, service);
    registerDiscoveryRoute(app, service);
    registerCapabilitiesRoute(app, service);
    registerScanRoute(app, service);
  }
  app.get<{ Reply: HealthResponse }>('/health/live', async () => ({ status: 'ok' }));
  return app;
}
