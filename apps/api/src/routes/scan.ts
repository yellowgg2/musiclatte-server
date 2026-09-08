import type { ScanSettingsRequest } from '@musiclatte/contracts';
import { createScanScheduler } from '../scan/scheduler.js';
import type { FastifyRequest, FastifyInstance } from 'fastify';
import { ApiError, type SessionService } from '../auth/session-service.js';
import { requiredCredentials } from '../auth/guards.js';
import { cookieMutation, requireJSON } from '../auth/csrf.js';
export function registerScanRoute(app: FastifyInstance, service: SessionService) {
  registerSchedule(app, service);
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

/** Global schedule settings require the same freshly verified scan permission as manual scans. */
function registerSchedule(app: FastifyInstance, service: SessionService) {
  const scheduler = service.options.scan ? createScanScheduler(service.options.scan) : undefined;
  const authorize = async (request: FastifyRequest, mutation = false) => {
    if (request.url.includes('?')) throw new ApiError(400, 'invalid_request');
    const auth = requiredCredentials(request, service);
    if (mutation) {
      requireJSON(request);
      if (auth.scheme === 'cookie') cookieMutation(request, service, auth.token);
    }
    const verified = await service.verify(auth.token, auth.scheme);
    if (!service.options.allowScan || verified.identity.adminRole !== true)
      throw new ApiError(403, 'forbidden');
    return verified;
  };
  app.get('/api/v1/scan', async (request) => {
    const verified = await authorize(request);
    try {
      const status = await verified.upstream.getScanStatus();
      return { schemaVersion: 1, ...status };
    } catch (error) {
      return service.rejectUpstream(error, verified.session.raw);
    }
  });
  app.get('/api/v1/scan/schedule', async (request) => {
    await authorize(request);
    if (!scheduler) throw new ApiError(503, 'upstream_unavailable');
    return scheduler.read();
  });
  app.put<{ Body: ScanSettingsRequest }>(
    '/api/v1/scan/schedule',
    {
      schema: {
        body: {
          type: 'object',
          required: ['enabled', 'intervalMinutes'],
          additionalProperties: false,
          properties: {
            enabled: { type: 'boolean' },
            intervalMinutes: { type: 'integer', minimum: 15, maximum: 10080 },
          },
        },
      },
    },
    async (request) => {
      const verified = await authorize(request, true);
      if (!scheduler) throw new ApiError(503, 'upstream_unavailable');
      return scheduler.update(request.body, verified.session.proof);
    },
  );
  if (scheduler) {
    let timer: ReturnType<typeof setInterval> | undefined;
    app.addHook('onReady', async () => {
      timer = setInterval(() => {
        void scheduler.tick().catch(() => {});
      }, 15000);
      timer.unref();
      void scheduler.tick().catch(() => {});
    });
    app.addHook('preClose', async () => {
      clearInterval(timer);
      await scheduler.close();
    });
  }
}
