import type { ApiErrorResponse, RecentDownloadResponse } from '@musiclatte/contracts';

const empty: RecentDownloadResponse = {
  schemaVersion: 1,
  filter: { from: '2026-08-31T12:00:00.000Z', to: '2026-09-07T12:00:00.000Z' },
  asOf: '2026-09-07T12:00:00.000Z',
  items: [],
  nextCursor: null,
};
const event = { eventId: 'synthetic-event', downloadCompletedAt: '2026-09-07T11:00:00.000Z' };
/** Decoder examples only: the synthetic cursor is never accepted as an authenticated API token. */
export const recentFixtures = {
  empty,
  registering: { ...empty, items: [{ ...event, state: 'registering' }] },
  ready: {
    ...empty,
    items: [
      {
        ...event,
        registeredAt: '2026-09-07T11:01:00.000Z',
        state: 'ready',
        song: { id: 'synthetic-song', title: 'Synthetic song', isDir: false },
      },
    ],
  },
  missing: { ...empty, items: [{ ...event, state: 'missing' }] },
  cursor: {
    ...empty,
    items: [{ ...event, state: 'registering' }],
    nextCursor: 'synthetic-opaque-cursor',
  },
  date: { ...empty, filter: { from: '2026-09-05T15:00:00.000Z', to: '2026-09-06T15:00:00.000Z' } },
} satisfies Record<string, RecentDownloadResponse>;
export const recentErrorFixture = {
  schemaVersion: 1,
  error: { code: 'upstream_unavailable', retryable: true },
} satisfies ApiErrorResponse;
