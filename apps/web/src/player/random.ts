import type { ApiErrorCode, MusicEntry, MusicRandomResponse } from '@musiclatte/contracts';

export class RandomSongsError extends Error {
  constructor(readonly code: ApiErrorCode) {
    super(code);
  }
}

function isSong(value: unknown): value is MusicEntry {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    typeof item.title === 'string' &&
    item.title.length > 0 &&
    item.isDir === false
  );
}

export async function fetchRandomSongs({
  fetcher,
  apiOrigin,
  signal,
  size = 50,
}: {
  fetcher: typeof fetch;
  apiOrigin: string;
  signal: AbortSignal;
  size?: number;
}): Promise<MusicEntry[]> {
  let response: Response;
  try {
    response = await fetcher(`${apiOrigin}/api/v1/music/random?size=${size}`, {
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
  } catch {
    throw new RandomSongsError('upstream_unavailable');
  }
  if (!response.ok)
    throw new RandomSongsError(
      response.status === 401 ? 'unauthenticated' : 'upstream_unavailable',
    );
  const value: unknown = await response.json();
  const random = value as Partial<MusicRandomResponse>;
  if (random.schemaVersion !== 1 || !Array.isArray(random.songs) || !random.songs.every(isSong))
    throw new RandomSongsError('internal_error');
  return random.songs;
}
