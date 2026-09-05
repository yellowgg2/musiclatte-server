import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  favoriteIdSchema,
  favoriteRequestSchemas,
  favoriteResponseSchemas,
  type FavoriteSongResponse,
  type FavoriteSongSetRequest,
  type FavoriteSongsResponse,
} from '@musiclatte/contracts';
import { cookieMutation, requireJSON } from '../../auth/csrf.js';
import { requiredCredentials } from '../../auth/guards.js';
import type { SessionService } from '../../auth/session-service.js';
import { createFavoritesService } from '../../collections/favorites-service.js';
import { libraryRead } from '../../music/library-service.js';

async function favoriteMutation<T>(
  request: FastifyRequest,
  service: SessionService,
  work: (
    verified: Awaited<ReturnType<SessionService['verify']>>,
    signal: AbortSignal,
  ) => Promise<T>,
): Promise<T> {
  const auth = requiredCredentials(request, service);
  requireJSON(request);
  if (auth.scheme === 'cookie') cookieMutation(request, service, auth.token);
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.raw.once('aborted', abort);
  if (request.raw.destroyed) abort();
  try {
    const verified = await service.verify(auth.token, auth.scheme, { signal: controller.signal });
    const result = await work(verified, controller.signal);
    service.find(auth.token, auth.scheme);
    return result;
  } finally {
    request.raw.off('aborted', abort);
  }
}

export function registerFavoriteSongRoutes(app: FastifyInstance, service: SessionService) {
  const favorites = createFavoritesService(service);

  app.get<{ Reply: FavoriteSongsResponse }>(
    '/api/v1/favorites/songs',
    {
      schema: {
        querystring: favoriteRequestSchemas.empty,
        response: { 200: favoriteResponseSchemas.list },
      },
    },
    async (request, reply) =>
      libraryRead(service, request, reply, (_upstream, signal, verified) =>
        favorites.read(verified, signal),
      ),
  );

  app.put<{ Params: { id: string }; Body: FavoriteSongSetRequest; Reply: FavoriteSongResponse }>(
    '/api/v1/favorites/songs/:id',
    {
      schema: {
        params: favoriteIdSchema,
        querystring: favoriteRequestSchemas.empty,
        body: favoriteRequestSchemas.set,
        response: { 200: favoriteResponseSchemas.set },
      },
    },
    async (request) =>
      favoriteMutation(request, service, (verified, signal) =>
        favorites.set(verified, request.params.id, request.body, signal),
      ),
  );
}
