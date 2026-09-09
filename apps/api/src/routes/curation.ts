import { createCurationCompletionService } from '../curation/completion-service.js';
import {
  curationCompletionSchema,
  curationReopenSchema,
  type CurationCompletionRequest,
  type CurationReopenRequest,
} from '@musiclatte/contracts';
import { createAutomationService } from '../curation/automation-service.js';
import { metadataAttemptRequestSchema, type MetadataAttemptRequest } from '@musiclatte/contracts';
import { createCurationClaimService } from '../curation/claim-service.js';
import { requiredCredentials } from '../auth/guards.js';
import { cookieMutation, requireJSON } from '../auth/csrf.js';
import { metadataRequestSchemas, type CurationClaimRequest } from '@musiclatte/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { curationFields } from '@musiclatte/contracts';
import { ApiError, type SessionService } from '../auth/session-service.js';
import { verifyMetadataPrincipal } from '../auth/metadata-principal.js';
import { createCurationQueryService } from '../curation/query-service.js';
import type { CurationFilter, CurationScope } from '../storage/curation-repository.js';
export const curationPagingSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'string', pattern: '^(?:[1-9]|[1-9][0-9]|100)$' },
    cursor: { type: 'string', minLength: 1, maxLength: 2048 },
  },
} as const;
export const curationTrackParams = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 2048 } },
} as const;
export function registerCurationRoutes(app: FastifyInstance, service: SessionService) {
  let completion: ReturnType<typeof createCurationCompletionService> | undefined;
  let automation: ReturnType<typeof createAutomationService> | undefined;
  let query: ReturnType<typeof createCurationQueryService> | undefined;
  let claims: ReturnType<typeof createCurationClaimService> | undefined;
  async function mutation(request: FastifyRequest) {
    const auth = requiredCredentials(request, service);
    if (auth.scheme === 'cookie') cookieMutation(request, service, auth.token);
    else if (request.method !== 'DELETE') requireJSON(request);
    const principal = await verifyMetadataPrincipal(request, service);
    if (request.validationError) throw new ApiError(400, 'invalid_request');
    return { principal, claims: (claims ??= createCurationClaimService(service)) };
  }
  app.post<{ Params: { id: string }; Body: CurationCompletionRequest }>(
    '/api/v1/tracks/:id/curation/complete',
    {
      attachValidation: true,
      schema: {
        params: curationTrackParams,
        querystring: metadataRequestSchemas.empty,
        body: curationCompletionSchema,
      },
    },
    async (request) => {
      const m = await mutation(request);
      return (completion ??= createCurationCompletionService(service)).completeTrack(
        m.principal,
        request.params.id,
        request.body,
      );
    },
  );
  app.post<{ Params: { id: string }; Body: CurationReopenRequest }>(
    '/api/v1/tracks/:id/curation/reopen',
    {
      attachValidation: true,
      schema: {
        params: curationTrackParams,
        querystring: metadataRequestSchemas.empty,
        body: curationReopenSchema,
      },
    },
    async (request) => {
      const m = await mutation(request);
      return (completion ??= createCurationCompletionService(service)).reopenTrack(
        m.principal,
        request.params.id,
        request.body,
      );
    },
  );
  app.post<{ Params: { id: string }; Body: MetadataAttemptRequest }>(
    '/api/v1/tracks/:id/metadata-attempts',
    {
      attachValidation: true,
      schema: {
        params: curationTrackParams,
        querystring: metadataRequestSchemas.empty,
        body: metadataAttemptRequestSchema,
      },
    },
    async (request) => {
      const m = await mutation(request);
      return (automation ??= createAutomationService(service)).recordMetadataAttempt(
        m.principal,
        request.params.id,
        request.body,
      );
    },
  );
  app.post<{ Body: CurationClaimRequest }>(
    '/api/v1/curation-claims',
    {
      attachValidation: true,
      schema: {
        querystring: metadataRequestSchemas.empty,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['operationId', 'purpose', 'fields', 'targets'],
          properties: {
            operationId: metadataRequestSchemas.create.properties.operationId,
            purpose: { enum: ['required_review', 'optional_enrichment'] },
            fields: {
              type: 'array',
              minItems: 1,
              maxItems: 5,
              uniqueItems: true,
              items: { enum: curationFields },
            },
            targets: metadataRequestSchemas.create.properties.targets,
          },
        },
      },
    },
    async (request) => {
      const m = await mutation(request);
      return m.claims.claimTracks(m.principal, request.body);
    },
  );
  app.post<{ Params: { id: string }; Body: { operationId: string; expectedGeneration: number } }>(
    '/api/v1/curation-claims/:id/renew',
    {
      attachValidation: true,
      schema: {
        querystring: metadataRequestSchemas.empty,
        params: curationTrackParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['operationId', 'expectedGeneration'],
          properties: {
            operationId: metadataRequestSchemas.create.properties.operationId,
            expectedGeneration: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async (request) => {
      const m = await mutation(request);
      return m.claims.renewClaim(m.principal, request.params.id, request.body);
    },
  );
  app.delete<{ Params: { id: string } }>(
    '/api/v1/curation-claims/:id',
    {
      attachValidation: true,
      schema: { querystring: metadataRequestSchemas.empty, params: curationTrackParams },
    },
    async (request, reply) => {
      const m = await mutation(request);
      await m.claims.releaseClaim(m.principal, request.params.id);
      return reply.code(204).send();
    },
  );

  async function boundary<T>(
    request: FastifyRequest,
    work: (q: ReturnType<typeof createCurationQueryService>, scope: CurationScope) => T,
  ): Promise<T> {
    const principal = await verifyMetadataPrincipal(request, service);
    if (request.validationError) throw new ApiError(400, 'invalid_request');
    const q = (query ??= createCurationQueryService(service));
    const before = await q.scope(principal);
    const result = work(q, before);
    const after = await q.scope(await verifyMetadataPrincipal(request, service));
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new ApiError(409, 'snapshot_scope_changed');
    return result;
  }
  app.get(
    '/api/v1/metadata-policy',
    {
      attachValidation: true,
      schema: { querystring: { type: 'object', additionalProperties: false, properties: {} } },
    },
    (request) => boundary(request, (q) => q.policy()),
  );
  app.get<{ Querystring: CurationFilter & { cursor?: string; limit?: string } }>(
    '/api/v1/tracks',
    {
      attachValidation: true,
      schema: {
        querystring: {
          ...curationPagingSchema,
          properties: {
            ...curationPagingSchema.properties,
            curationStatus: { enum: ['unreviewed', 'needs_review', 'in_progress', 'completed'] },
            missingField: { enum: curationFields },
            field: { enum: ['album', 'cover', 'lyrics'] },
            fieldStatus: {
              enum: ['unknown', 'missing', 'present', 'unavailable', 'not_applicable'],
            },
            format: { enum: ['mp3', 'unsupported'] },
            libraryId: { type: 'string', minLength: 1, maxLength: 128 },
          },
        },
      },
    },
    (request) => boundary(request, (q, scope) => q.list(scope, request.query)),
  );
  app.get<{ Params: { id: string }; Querystring: { cursor?: string; limit?: string } }>(
    '/api/v1/tracks/:id/curation',
    {
      attachValidation: true,
      schema: { params: curationTrackParams, querystring: curationPagingSchema },
    },
    (request) => boundary(request, (q, scope) => q.detail(scope, request.params.id, request.query)),
  );
}
