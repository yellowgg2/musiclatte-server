import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  metadataRequestSchemas as schemas,
  metadataResponseSchemas as responses,
  type MetadataJobRequest,
} from '@musiclatte/contracts';
import { cookieMutation, cookieOriginMutation } from '../auth/csrf.js';
import { requiredCredentials } from '../auth/guards.js';
import { ApiError, type SessionService } from '../auth/session-service.js';
import { createMetadataService, type MetadataService } from '../metadata/service.js';
import { metadataErrors } from '../metadata/provider.js';
import { createMetadataChangesService } from '../metadata/changes-service.js';
import { proxyMedia } from '../media/proxy.js';
import type { VerifiedMetadataSession } from '../metadata/resolver.js';
import {
  verifyMetadataPrincipal,
  revalidateMetadataPrincipal,
  isTokenPrincipal,
} from '../auth/metadata-principal.js';

export function registerMetadataRoutes(app: FastifyInstance, service: SessionService) {
  let metadata: MetadataService | undefined;
  const getService = () => (metadata ??= createMetadataService(service));
  app.post<{ Params: { id: string }; Body: { operationId: string; itemIds: string[] } }>(
    '/api/v1/metadata-jobs/:id/rechecks',
    {
      attachValidation: true,
      schema: {
        params: schemas.params,
        querystring: schemas.empty,
        body: schemas.recheck,
        response: { 202: responses.detail },
      },
    },
    async (request, reply) =>
      reply
        .code(202)
        .send(
          await boundary(request, true, (m, v) => m.recheck(v, request.params.id, request.body)),
        ),
  );
  app.get<{ Querystring: { cursor?: string; limit?: string } }>(
    '/api/v1/metadata-changes',
    {
      attachValidation: true,
      schema: { querystring: schemas.list, response: { 200: responses.changes } },
    },
    (request) =>
      boundary(request, false, (m, v) =>
        createMetadataChangesService(service, m.provider).list(v, request.query),
      ),
  );
  app.get<{ Params: { id: string; revision: string } }>(
    '/api/v1/media/cover/:id/revisions/:revision',
    {
      exposeHeadRoute: true,
      attachValidation: true,
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'revision'],
          properties: {
            id: schemas.trackParams.properties.id,
            revision: schemas.params.properties.id,
          },
        },
        querystring: schemas.empty,
      },
    },
    async (request, reply) => {
      if (request.validationError) throw new ApiError(400, 'invalid_request');
      return proxyMedia(service, request, reply, 'cover', request.params.id, {
        freshCover: true,
        authorize: (v) =>
          metadataErrors(() =>
            createMetadataChangesService(service, getService().provider).authorizeCover(
              v,
              request.params.id,
              request.params.revision,
            ),
          ),
      });
    },
  );
  async function boundary<T>(
    request: FastifyRequest,
    mutation: boolean,
    work: (metadata: MetadataService, verified: VerifiedMetadataSession) => Promise<T>,
  ): Promise<T> {
    const auth = requiredCredentials(request, service);
    if (mutation) {
      if (auth.scheme !== 'cookie') throw new ApiError(403, 'forbidden');
      cookieMutation(request, service, auth.token);
    }
    if (request.validationError) throw new ApiError(400, 'invalid_request');
    const verified = await verifyMetadataPrincipal(request, service);
    if (isTokenPrincipal(verified) && request.url.split('?')[0]!.endsWith('/restore-preview'))
      throw new ApiError(403, 'forbidden');
    const result = await metadataErrors(() => work(getService(), verified));
    await revalidateMetadataPrincipal(service, verified);
    return result;
  }
  app.get<{ Params: { id: string } }>(
    '/api/v1/tracks/:id/metadata',
    {
      attachValidation: true,
      schema: {
        params: schemas.trackParams,
        querystring: schemas.empty,
        response: { 200: responses.snapshot },
      },
    },
    (request) => boundary(request, false, (m, v) => m.read(v, request.params.id)),
  );
  app.get<{ Params: { id: string; frameId: string } }>(
    '/api/v1/tracks/:id/metadata/cover/:frameId',
    { attachValidation: true, schema: { params: schemas.frameParams, querystring: schemas.empty } },
    async (request, reply) => {
      const image = await boundary(request, false, (m, v) =>
        m.frame(v, request.params.id, request.params.frameId),
      );
      return reply
        .header('Cache-Control', 'private, no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .type(image.mimeType)
        .send(image.data);
    },
  );
  app.post<{ Body: Pick<MetadataJobRequest, 'targets' | 'patch'> }>(
    '/api/v1/metadata-previews',
    {
      attachValidation: true,
      bodyLimit: 1024 * 1024,
      schema: {
        querystring: schemas.empty,
        body: schemas.preview,
        response: { 200: responses.preview },
      },
    },
    (request) => boundary(request, true, (m, v) => m.preview(v, request.body)),
  );
  app.get<{ Params: { id: string; itemId: string } }>(
    '/api/v1/metadata-jobs/:id/items/:itemId/intent',
    {
      attachValidation: true,
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'itemId'],
          properties: { id: schemas.params.properties.id, itemId: schemas.params.properties.id },
        },
        querystring: schemas.empty,
        response: { 200: schemas.preview },
      },
    },
    (request) =>
      boundary(request, false, (m, v) => m.intent(v, request.params.id, request.params.itemId)),
  );
  app.get<{ Params: { id: string; itemId: string } }>(
    '/api/v1/metadata-jobs/:id/items/:itemId/restore-preview',
    {
      attachValidation: true,
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'itemId'],
          properties: { id: schemas.params.properties.id, itemId: schemas.params.properties.id },
        },
        querystring: schemas.empty,
      },
    },
    (request) =>
      boundary(request, false, (m, v) =>
        m.restorePreview(v, request.params.id, request.params.itemId),
      ),
  );
  app.post<{ Body: MetadataJobRequest }>(
    '/api/v1/metadata-jobs',
    {
      attachValidation: true,
      bodyLimit: 1024 * 1024,
      schema: {
        querystring: schemas.empty,
        body: schemas.create,
        response: { 202: responses.detail },
      },
    },
    async (request, reply) =>
      reply.code(202).send(await boundary(request, true, (m, v) => m.submit(v, request.body))),
  );
  app.get<{ Querystring: { cursor?: string; limit?: string } }>(
    '/api/v1/metadata-jobs',
    {
      attachValidation: true,
      schema: { querystring: schemas.list, response: { 200: responses.list } },
    },
    (request) => boundary(request, false, (m, v) => m.list(v, request.query)),
  );
  app.get<{ Params: { id: string } }>(
    '/api/v1/metadata-jobs/:id',
    {
      attachValidation: true,
      schema: {
        params: schemas.params,
        querystring: schemas.empty,
        response: { 200: responses.detail },
      },
    },
    (request) => boundary(request, false, (m, v) => m.detail(v, request.params.id)),
  );
  app.post<{
    Params: { id: string };
    Body: { operationId: string; items: { itemId: string; expectedRevision: string }[] };
  }>(
    '/api/v1/metadata-jobs/:id/retries',
    {
      attachValidation: true,
      bodyLimit: 1024 * 1024,
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
        .send(await boundary(request, true, (m, v) => m.retry(v, request.params.id, request.body))),
  );
  app.post<{
    Params: { id: string };
    Body: { operationId: string; itemId: string; currentExpectedRevision: string };
  }>(
    '/api/v1/metadata-jobs/:id/restores',
    {
      attachValidation: true,
      schema: {
        params: schemas.params,
        querystring: schemas.empty,
        body: schemas.restore,
        response: { 202: responses.detail },
      },
    },
    async (request, reply) =>
      reply
        .code(202)
        .send(
          await boundary(request, true, (m, v) => m.restore(v, request.params.id, request.body)),
        ),
  );
  app.get<{ Params: { id: string } }>(
    '/api/v1/metadata-covers/:id',
    { attachValidation: true, schema: { params: schemas.params, querystring: schemas.empty } },
    async (request, reply) => {
      const image = await boundary(request, false, (m, v) => m.covers.read(v, request.params.id));
      return reply
        .header('Cache-Control', 'private, no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .type(image.mimeType)
        .send(image.data);
    },
  );
  app.register(async (scope) => {
    scope.addContentTypeParser(
      ['image/png', 'image/jpeg'],
      { parseAs: 'buffer', bodyLimit: 8 * 1024 * 1024 },
      (_request, body, done) => done(null, body),
    );
    scope.post<{ Body: Buffer }>(
      '/api/v1/metadata-covers',
      {
        attachValidation: true,
        bodyLimit: 8 * 1024 * 1024,
        schema: { querystring: schemas.empty, response: { 201: responses.upload } },
      },
      async (request, reply) => {
        const auth = requiredCredentials(request, service);
        const pat = auth.token.startsWith('mlpat_');
        if (auth.scheme !== 'cookie' && !pat) throw new ApiError(403, 'forbidden');
        // Raw image uploads use the identical cookie/Origin/CSRF guard, with an explicit media-type gate.
        const mime = request.headers['content-type'];
        if (!['image/jpeg', 'image/png'].includes(String(mime)) || !Buffer.isBuffer(request.body))
          throw new ApiError(415, 'invalid_request');
        if (!pat) cookieOriginMutation(request, service, auth.token);
        else await verifyMetadataPrincipal(request, service, ['metadata:read', 'metadata:write']);
        const operation = request.headers['x-operation-id'];
        const library = request.headers['x-metadata-library-id'];
        if (request.validationError || typeof operation !== 'string' || typeof library !== 'string')
          throw new ApiError(400, 'invalid_request');
        const result = await boundary(request, false, (m, v) =>
          m.covers.upload(v, library, operation, String(mime), request.body),
        );
        return reply.code(201).send(result);
      },
    );
  });
}
