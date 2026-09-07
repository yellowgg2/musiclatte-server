import type { MusicEntry } from './subsonic.js';
import { musicEntrySchema } from './music.js';

export interface RecentDownloadFilter {
  from: string;
  to: string;
}
interface RecentEvent {
  eventId: string;
  downloadCompletedAt: string;
  registeredAt?: string;
}
export type RecentDownloadItem =
  | (RecentEvent & { state: 'ready'; song: MusicEntry })
  | (RecentEvent & { state: 'registering' | 'missing'; song?: never });
export interface RecentDownloadResponse {
  schemaVersion: 1;
  filter: RecentDownloadFilter;
  asOf: string;
  items: RecentDownloadItem[];
  nextCursor: string | null;
}
export interface RecentDownloadQuery {
  from?: string;
  to?: string;
  cursor?: string;
  limit?: string;
}
const object = <T>(required: string[], properties: T) =>
  ({ type: 'object', additionalProperties: false, required, properties }) as const;
/** UTC RFC3339 instants at the millisecond precision of the management ledger. */
export const recentInstantSchema = {
  type: 'string',
  pattern:
    '^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,3})?Z$',
} as const;
const id = { type: 'string', minLength: 1, maxLength: 1024 } as const;
const cursor = { type: 'string', minLength: 1, maxLength: 4096 } as const;
const event = {
  eventId: id,
  downloadCompletedAt: recentInstantSchema,
  registeredAt: recentInstantSchema,
};
export const recentQuerySchema = {
  ...object([], {
    from: recentInstantSchema,
    to: recentInstantSchema,
    cursor,
    limit: { type: 'string', pattern: '^(?:[1-9]|[1-9][0-9]|100)$' },
  }),
  dependencies: { from: ['to'], to: ['from'] },
} as const;
export const recentItemSchema = {
  anyOf: [
    object(['eventId', 'downloadCompletedAt', 'registeredAt', 'state', 'song'], {
      ...event,
      state: { const: 'ready' },
      song: {
        ...musicEntrySchema,
        properties: { ...musicEntrySchema.properties, isDir: { const: false } },
      },
    }),
    object(['eventId', 'downloadCompletedAt', 'state'], {
      ...event,
      state: { enum: ['registering', 'missing'] },
    }),
  ],
} as const;
export const recentResponseSchema = object(
  ['schemaVersion', 'filter', 'asOf', 'items', 'nextCursor'],
  {
    schemaVersion: { const: 1 },
    filter: object(['from', 'to'], { from: recentInstantSchema, to: recentInstantSchema }),
    asOf: recentInstantSchema,
    items: { type: 'array', maxItems: 100, items: recentItemSchema },
    nextCursor: { anyOf: [cursor, { type: 'null' }] },
  },
);
