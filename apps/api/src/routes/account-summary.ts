import type { FastifyInstance } from 'fastify';
import {
  accountSummaryQuerySchema,
  accountSummaryResponseSchema,
  type AccountSummaryResponse,
} from '@musiclatte/contracts';
import type { SessionService } from '../auth/session-service.js';
import { libraryRead } from '../music/library-service.js';
import type { SubsonicClient } from '../subsonic/client.js';

async function readCounts(upstream: SubsonicClient, signal: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  try {
    const [favorites, playlists] = await Promise.all([
      upstream.getStarred2({ signal: controller.signal }),
      upstream.getPlaylists({ signal: controller.signal }),
    ]);
    return { favorites, playlists };
  } finally {
    signal.removeEventListener('abort', abort);
    controller.abort();
  }
}

export function registerAccountSummaryRoute(app: FastifyInstance, service: SessionService) {
  app.get<{ Reply: AccountSummaryResponse }>(
    '/api/v1/account/summary',
    {
      schema: {
        querystring: accountSummaryQuerySchema,
        response: { 200: accountSummaryResponseSchema },
      },
    },
    async (request, reply) =>
      libraryRead(service, request, reply, async (upstream, signal) => {
        const { favorites, playlists } = await readCounts(upstream, signal);
        return {
          schemaVersion: 1,
          favoriteSongCount: favorites.length,
          playlistCount: playlists.length,
        };
      }),
  );
}
