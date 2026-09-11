import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  organizationRequestSchemas as requests,
  organizationResponseSchemas as responses,
  type OrganizationJobRequest,
  type OrganizationPreviewRequest,
} from '@musiclatte/contracts';
import { requiredCredentials } from '../auth/guards.js';
import { requireJSON } from '../auth/csrf.js';
import { ApiError, type SessionService } from '../auth/session-service.js';
import { verifyAccessTokenPrincipal } from '../auth/metadata-principal.js';
import { createOrganizationService } from '../metadata/organization-service.js';

export function registerMetadataOrganizationRoutes(
  app: FastifyInstance,
  sessionService: SessionService,
) {
  let organization: ReturnType<typeof createOrganizationService> | undefined;
  const getService = () => (organization ??= createOrganizationService(sessionService));
  const boundary = async <T>(
    request: FastifyRequest,
    mutation: boolean,
    work: (principal: Awaited<ReturnType<typeof verifyAccessTokenPrincipal>>) => Promise<T> | T,
  ) => {
    if (request.validationError) throw new ApiError(400, 'invalid_request');
    const credentials = requiredCredentials(request, sessionService);
    if (
      credentials.scheme !== 'bearer' ||
      !credentials.token.startsWith('mlpat_') ||
      new URL(request.url, sessionService.options.origin).searchParams.has('token')
    )
      throw new ApiError(403, 'forbidden');
    if (mutation) requireJSON(request);
    const principal = await verifyAccessTokenPrincipal(sessionService, credentials.token, [
      'metadata:read',
      'metadata:write',
      'media:organize',
    ]);
    return work(principal);
  };
  app.get<{ Querystring: { title: string; libraryId?: string; limit?: string } }>(
    '/api/v1/metadata-organization/candidates',
    {
      attachValidation: true,
      schema: {
        querystring: requests.candidates,
        response: { 200: responses.candidates },
      },
    },
    (request) =>
      boundary(request, false, (principal) => getService().candidateList(principal, request.query)),
  );
  app.post<{ Body: OrganizationPreviewRequest }>(
    '/api/v1/metadata-organization/previews',
    {
      attachValidation: true,
      schema: {
        querystring: requests.empty,
        body: requests.preview,
        response: { 200: responses.preview },
      },
    },
    (request) =>
      boundary(request, true, (principal) => getService().preview(principal, request.body)),
  );
  app.post<{ Body: OrganizationJobRequest }>(
    '/api/v1/metadata-organization-jobs',
    {
      attachValidation: true,
      bodyLimit: 65536,
      schema: {
        querystring: requests.empty,
        body: requests.create,
        response: { 202: responses.job },
      },
    },
    async (request, reply) =>
      reply
        .code(202)
        .send(
          await boundary(request, true, (principal) =>
            getService().submit(principal, request.body),
          ),
        ),
  );
  app.get<{ Params: { id: string } }>(
    '/api/v1/metadata-organization-jobs/:id',
    {
      attachValidation: true,
      schema: {
        params: requests.params,
        querystring: requests.empty,
        response: { 200: responses.job },
      },
    },
    (request) =>
      boundary(request, false, (principal) => getService().detail(principal, request.params.id)),
  );
  app.post<{ Params: { id: string }; Body: { operationId: string } }>(
    '/api/v1/metadata-organization-jobs/:id/retries',
    {
      attachValidation: true,
      schema: {
        params: requests.params,
        querystring: requests.empty,
        body: requests.retry,
        response: { 202: responses.job },
      },
    },
    async (request, reply) =>
      reply
        .code(202)
        .send(
          await boundary(request, true, (principal) =>
            getService().retry(principal, request.params.id, request.body),
          ),
        ),
  );
}
