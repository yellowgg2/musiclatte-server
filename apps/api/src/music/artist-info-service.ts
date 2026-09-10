import type { ArtistInfoResponse } from '@musiclatte/contracts';
import type { SubsonicClient } from '../subsonic/client.js';

function plainText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const text = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100_000);
  return text || undefined;
}

/** One current-account lookup with no persistent or cross-request cache. */
export async function readArtistInfo(
  upstream: SubsonicClient,
  artistId: string,
  signal: AbortSignal,
): Promise<ArtistInfoResponse> {
  const artist = await upstream.artist(artistId, { signal });
  const info = await upstream.artistInfo(artist.id, { signal });
  const biography = plainText(info.biography);
  const musicBrainzId = info.musicBrainzId?.trim() || undefined;
  const seen = new Set([artist.id]);
  const similarArtists = info.similarArtist.filter(({ id, name }) => {
    if (!id || !name.trim() || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const available = Boolean(biography || musicBrainzId || artist.coverArt || similarArtists.length);
  return {
    schemaVersion: 1,
    artistId: artist.id,
    state: available ? 'available' : 'empty',
    ...(biography ? { biography } : {}),
    ...(musicBrainzId ? { musicBrainzId } : {}),
    ...(artist.coverArt ? { coverArtId: artist.coverArt } : {}),
    similarArtists,
  };
}
