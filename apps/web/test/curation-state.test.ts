import { expect, it } from 'vitest';
import { applyCurationResponse, curationQuery, initialCurationState } from '../src/curation/state';
import type { CurationList } from '@musiclatte/contracts';
const page: CurationList = {
  schemaVersion: 1,
  snapshotId: 's1',
  asOf: 1,
  expiresAt: 100,
  total: 0,
  nextCursor: null,
  coverage: [],
  tracks: [],
};
it('discards responses from obsolete account/filter generations and mismatched snapshots', () => {
  const state = { ...initialCurationState, generation: 2 };
  expect(applyCurationResponse(state, page, 1, false)).toBe(state);
  const accepted = applyCurationResponse(state, page, 2, false);
  expect(accepted.data).toBe(page);
  expect(applyCurationResponse(accepted, { ...page, snapshotId: 's2' }, 2, true)).toMatchObject({
    loading: false,
    data: null,
    error: 'snapshot_scope_changed',
  });
});
it('keeps completed and optional field filters independent and excludes empty filters', () => {
  expect(
    curationQuery({
      curationStatus: 'completed',
      field: 'lyrics',
      fieldStatus: 'missing',
      libraryId: '',
      format: '',
    }).toString(),
  ).toBe('curationStatus=completed&field=lyrics&fieldStatus=missing');
});
it('stops pagination with a recoverable error if a snapshot changes its frozen count', () => {
  const state = { ...initialCurationState, generation: 2, data: page };
  expect(applyCurationResponse(state, { ...page, total: 99 }, 2, true)).toMatchObject({
    loading: false,
    data: null,
    error: 'snapshot_scope_changed',
  });
});
