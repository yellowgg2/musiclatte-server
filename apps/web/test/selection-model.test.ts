import { describe, expect, it, vi } from 'vitest';
import { initialSelectionState, selectionReducer, selectionScopeKey } from '../src/selection/model';
import {
  APPEND_BATCH_MAX_BYTES,
  appendSelectedSongs,
  appendRequestBytes,
  takeAppendBatch,
} from '../src/selection/batches';

describe('route-scoped song selection', () => {
  /** Search paging retains selection while query and folder identity changes clear it. */
  it('should retain page offsets inside one search scope and clear a changed search scope', () => {
    const key = selectionScopeKey({ kind: 'search', query: ' 밤 ', musicFolderId: '1' });
    let state = selectionReducer(initialSelectionState, { type: 'scope', key });
    state = selectionReducer(state, { type: 'enter' });
    state = selectionReducer(state, {
      type: 'toggle',
      item: { id: 'song-b', order: 21 },
    });

    expect(selectionReducer(state, { type: 'scope', key })).toEqual(state);
    expect(selectionReducer(state, { type: 'leave', key: 'search:1:old' })).toEqual(state);
    expect(selectionReducer(state, { type: 'leave', key })).toEqual(initialSelectionState);
    expect(
      selectionReducer(state, {
        type: 'scope',
        key: selectionScopeKey({ kind: 'search', query: '새 검색', musicFolderId: '1' }),
      }),
    ).toEqual({ ...initialSelectionState, scopeKey: 'search:1:\uC0C8 \uAC80\uC0C9' });
  });

  /** Duplicate source IDs are selected once and always emitted in source order. */
  it('should deduplicate selected IDs and preserve source order', () => {
    let state = selectionReducer(initialSelectionState, { type: 'scope', key: 'folder:one' });
    state = selectionReducer(state, { type: 'enter' });
    state = selectionReducer(state, { type: 'toggle', item: { id: 'B', order: 1 } });
    state = selectionReducer(state, { type: 'toggle', item: { id: 'A', order: 0 } });
    state = selectionReducer(state, {
      type: 'select-page',
      items: [
        { id: 'A', order: 2 },
        { id: 'C', order: 3 },
      ],
    });

    expect(state.items.map(({ id }) => id)).toEqual(['A', 'B', 'C']);
    expect(selectionReducer(state, { type: 'remove-applied', ids: ['A', 'B'] }).items).toEqual([
      { id: 'C', order: 3 },
    ]);
  });
});

describe('playlist append batching', () => {
  /** UTF-8 JSON bytes, including the operation envelope, determine the exact batch boundary. */
  it('should split by encoded request bytes instead of item count', () => {
    expect(APPEND_BATCH_MAX_BYTES).toBeLessThan(16 * 1024);
    const operationId = 'A'.repeat(22);
    const expectedRevision = 'R'.repeat(43);
    const firstOnly = appendRequestBytes(operationId, expectedRevision, ['\uBC24'.repeat(20)]);
    const batch = takeAppendBatch(
      ['\uBC24'.repeat(20), '\uD83C\uDFB5'.repeat(20)],
      expectedRevision,
      operationId,
      firstOnly,
    );

    expect(batch.songIds).toEqual(['\uBC24'.repeat(20)]);
    expect(batch.remaining).toEqual(['\uD83C\uDFB5'.repeat(20)]);
    expect(batch.encodedBytes).toBe(firstOnly);
  });

  /** Every successful batch supplies the next revision and receives a fresh operation ID. */
  it('should append sequential batches with revision chaining', async () => {
    const calls: Array<{ revision: string; ids: readonly string[]; operationId: string }> = [];
    const ids = ['a'.repeat(24), 'b'.repeat(24), 'c'.repeat(24)];
    let operation = 0;
    const result = await appendSelectedSongs({
      songIds: ids,
      expectedRevision: 'revision-0',
      maxBytes: appendRequestBytes('operation-0'.padEnd(22, 'x'), 'revision-0', [ids[0]!]),
      operationId: () => `operation-${operation++}`.padEnd(22, 'x'),
      append: async ({ expectedRevision, songIds, operationId }) => {
        calls.push({ revision: expectedRevision, ids: songIds, operationId });
        return { revision: `revision-${calls.length}` };
      },
    });

    expect(calls.map((call) => [call.revision, call.ids])).toEqual([
      ['revision-0', [ids[0]]],
      ['revision-1', [ids[1]]],
      ['revision-2', [ids[2]]],
    ]);
    expect(new Set(calls.map((call) => call.operationId)).size).toBe(3);
    expect(result).toMatchObject({ status: 'complete', appliedIds: ids, revision: 'revision-3' });
  });

  /** A failed batch stops immediately and retries only the retained songs with the same receipt ID. */
  it('should preserve failed and unattempted songs for a receipt-safe retry', async () => {
    const ids = ['a'.repeat(24), 'b'.repeat(24), 'c'.repeat(24)];
    const append = vi
      .fn()
      .mockResolvedValueOnce({ revision: 'revision-1' })
      .mockRejectedValueOnce(new Error('lost response'));
    const first = await appendSelectedSongs({
      songIds: ids,
      expectedRevision: 'revision-0',
      maxBytes: appendRequestBytes('A'.repeat(22), 'revision-0', [ids[0]!]),
      operationId: vi.fn().mockReturnValueOnce('A'.repeat(22)).mockReturnValueOnce('B'.repeat(22)),
      append,
    });

    expect(first.status).toBe('partial');
    expect(first.appliedIds).toEqual([ids[0]]);
    expect(first.remainingIds).toEqual(ids.slice(1));
    expect(first.failedIds).toEqual([ids[1]]);
    expect(first.unattemptedIds).toEqual([ids[2]]);
    expect(first.continuation).toEqual({
      operationId: 'B'.repeat(22),
      expectedRevision: 'revision-1',
    });
    expect(append).toHaveBeenCalledTimes(2);

    const retryAppend = vi.fn().mockResolvedValue({ revision: 'revision-2' });
    const continuation = first.continuation!;
    const retried = await appendSelectedSongs({
      songIds: first.remainingIds,
      expectedRevision: continuation.expectedRevision,
      continuation,
      maxBytes: 16 * 1024,
      operationId: () => 'C'.repeat(22),
      append: retryAppend,
    });
    expect(retryAppend.mock.calls[0]?.[0].operationId).toBe('B'.repeat(22));
    expect(retried.status).toBe('complete');
  });
});
