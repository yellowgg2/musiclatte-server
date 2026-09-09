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
  let query: ReturnType<typeof createCurationQueryService> | undefined;
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
