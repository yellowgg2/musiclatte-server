export interface AccountSummaryResponse {
  schemaVersion: 1;
  favoriteSongCount: number;
  playlistCount: number;
}

const nonNegativeInteger = { type: 'integer', minimum: 0 } as const;

export const accountSummaryQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {},
} as const;

export const accountSummaryResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'favoriteSongCount', 'playlistCount'],
  properties: {
    schemaVersion: { const: 1 },
    favoriteSongCount: nonNegativeInteger,
    playlistCount: nonNegativeInteger,
  },
} as const;
