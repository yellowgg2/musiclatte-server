import { describe, expect, it } from 'vitest';
async function makeSUT() {
  const path = '../src/recent/model.ts';
  const module = await import(path).catch(() => null);
  expect(module, 'recent date and snapshot model exists').not.toBeNull();
  return module!;
}
describe('recent scope and dates', () => {
  /** Calendar days use local midnight including the 23-hour DST day. */
  it('should convert inclusive local dates to exclusive UTC boundaries across DST', async () => {
    const { localDateRange } = await makeSUT();
    const previous = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      expect(localDateRange('2026-03-08', '2026-03-08')).toEqual({
        from: '2026-03-08T05:00:00.000Z',
        to: '2026-03-09T04:00:00.000Z',
      });
      expect(localDateRange('2026-11-01', '2026-11-01')).toEqual({
        from: '2026-11-01T04:00:00.000Z',
        to: '2026-11-02T05:00:00.000Z',
      });
      for (const dates of [
        ['2026-02-30', '2026-03-01'],
        ['2026-09-08', '2026-09-07'],
        ['', '2026-09-07'],
      ])
        expect(() => localDateRange(...dates)).toThrow();
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
  /** Event identity deduplication preserves transport order rather than re-sorting song IDs. */
  it('should append stable event pages and reject a changed snapshot', async () => {
    const { appendRecent } = await makeSUT();
    const first = {
      schemaVersion: 1,
      filter: { from: '2026-09-01T00:00:00Z', to: '2026-09-08T00:00:00Z' },
      asOf: '2026-09-07T00:00:00Z',
      items: [{ eventId: 'b' }, { eventId: 'a' }],
      nextCursor: 'next',
    };
    const next = { ...first, items: [{ eventId: 'a' }, { eventId: 'c' }], nextCursor: null };
    expect(appendRecent(first, next).items.map((i: { eventId: string }) => i.eventId)).toEqual([
      'b',
      'a',
      'c',
    ]);
    expect(() => appendRecent(first, { ...next, asOf: '2026-09-08T00:00:00Z' })).toThrow();
  });
});

/** Refreshed page ordering changes positions without changing the selected identities. */
it('should rebase selected IDs to current API order and retain off-page selections', async () => {
  const { selectionReducer } = await import('../src/selection/model');
  const state = {
    scopeKey: 'old',
    active: true,
    items: [
      { id: 'old-first', order: 0 },
      { id: 'off-page', order: 20 },
    ],
  };
  const action = {
    type: 'rebase' as const,
    key: 'new',
    order: [
      { id: 'new', order: 0 },
      { id: 'old-first', order: 1 },
    ],
  };
  const rebased = selectionReducer(state, action);
  const selected = selectionReducer(rebased, { type: 'toggle', item: { id: 'new', order: 0 } });
  expect(selected.items.map((item) => item.id)).toEqual(['new', 'old-first', 'off-page']);
});
