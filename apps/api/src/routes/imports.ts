import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  importRequestSchemas as schemas,
  importResponseSchemas as responses,
  type ImportCreateRequest,
  type ImportRetryRequest,
  type ImportListQuery,
} from '@musiclatte/contracts';
import { cookieMutation } from '../auth/csrf.js';
import { requiredCredentials } from '../auth/guards.js';
import { ApiError, type SessionService } from '../auth/session-service.js';
import { createImportService } from '../imports/import-service.js';

export function registerImportRoutes(app: FastifyInstance, service: SessionService) {
  app.register(async (scope) => {
    const parseJSON = scope.getDefaultJsonParser('error', 'error');
    scope.removeContentTypeParser('application/json');
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
      if (request.method === 'DELETE' && body === '') return done(null, undefined);
      parseJSON(request, String(body), done);
    });
    registerRoutes(scope, service);
  });
}
function registerRoutes(app: FastifyInstance, service: SessionService) {
  const imports = createImportService(service);
  async function boundary<T>(
    request: FastifyRequest,
    mutation: boolean,
    work: (verified: Awaited<ReturnType<SessionService['verify']>>) => T,
  ): Promise<T> {
    const auth = requiredCredentials(request, service);
    if (mutation) {
      if (auth.scheme !== 'cookie') throw new ApiError(403, 'forbidden');
      cookieMutation(request, service, auth.token);
    }
    if (
      request.validationError ||
      (request.method === 'DELETE' && request.body !== undefined) ||
      (request.url.split('?')[0] !== '/api/v1/imports' && request.url.includes('?')) ||
      (request.method === 'POST' && request.url.includes('?'))
    )
      throw new ApiError(400, 'invalid_request');
    const verified = await service.verify(auth.token, auth.scheme);
    const result = work(verified);
    await service.verify(auth.token, auth.scheme);
    return result;
  }
  app.get<{ Querystring: ImportListQuery }>(
    '/api/v1/imports',
    {
      attachValidation: true,
      schema: { querystring: schemas.list, response: { 200: responses.list } },
    },
    (request) => boundary(request, false, (v) => imports.list(v, request.query)),
  );
  app.get<{ Params: { id: string } }>(
    '/api/v1/imports/:id',
    {
      attachValidation: true,
      schema: {
        params: schemas.params,
        querystring: schemas.empty,
        response: { 200: responses.detail },
      },
    },
    (request) => boundary(request, false, (v) => imports.detail(v, request.params.id)),
  );
  app.post<{ Body: ImportCreateRequest }>(
    '/api/v1/imports',
    {
      attachValidation: true,
      schema: {
        querystring: schemas.empty,
        body: schemas.create,
        response: { 202: responses.detail },
      },
    },
    async (request, reply) =>
      reply.code(202).send(await boundary(request, true, (v) => imports.create(v, request.body))),
  );
  app.post<{ Params: { id: string }; Body: ImportRetryRequest }>(
    '/api/v1/imports/:id/retries',
    {
      attachValidation: true,
      schema: {
        params: schemas.params,
        querystring: schemas.empty,
        body: schemas.retry,
        response: { 202: responses.detail },
      },
    },
    async (request, reply) =>
      reply
        .code(202)
        .send(
          await boundary(request, true, (v) => imports.retry(v, request.params.id, request.body)),
        ),
  );
  app.delete<{ Params: { id: string } }>(
    '/api/v1/imports/:id',
    {
      attachValidation: true,
      schema: {
        params: schemas.params,
        querystring: schemas.empty,
        response: { 200: responses.detail },
      },
    },
    (request) => boundary(request, true, (v) => imports.cancel(v, request.params.id)),
  );
}
