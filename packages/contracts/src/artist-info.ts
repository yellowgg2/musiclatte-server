export interface SimilarArtist {
  id: string;
  name: string;
}

export interface ArtistInfoResponse {
  schemaVersion: 1;
  artistId: string;
  state: 'available' | 'empty';
  biography?: string;
  musicBrainzId?: string;
  coverArtId?: string;
  similarArtists: SimilarArtist[];
}

const text = { type: 'string', minLength: 1, maxLength: 100_000 } as const;
const id = { type: 'string', minLength: 1, maxLength: 2048 } as const;
export const artistInfoResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'artistId', 'state', 'similarArtists'],
  properties: {
    schemaVersion: { const: 1 },
    artistId: id,
    state: { enum: ['available', 'empty'] },
    biography: text,
    musicBrainzId: id,
    coverArtId: id,
    similarArtists: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name'],
        properties: { id, name: text },
      },
    },
  },
} as const;
