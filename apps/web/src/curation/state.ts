import type {
  ApiErrorCode,
  CurationList,
  CurationStatus,
  FieldStatus,
  OptionalCurationField,
} from '@musiclatte/contracts';
export interface CurationFilters {
  libraryId: string;
  format: '' | 'mp3' | 'unsupported';
  curationStatus: '' | CurationStatus;
  field: '' | OptionalCurationField;
  fieldStatus: '' | FieldStatus;
}
export const emptyCurationFilters: CurationFilters = {
  libraryId: '',
  format: '',
  curationStatus: '',
  field: '',
  fieldStatus: '',
};
export function curationQuery(filters: CurationFilters) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (
      value &&
      (!(key === 'field' || key === 'fieldStatus') || (filters.field && filters.fieldStatus))
    )
      query.set(key, value);
  }
  return query;
}
export interface CurationState {
  generation: number;
  data: CurationList | null;
  loading: boolean;
  error: ApiErrorCode | null;
}
export const initialCurationState: CurationState = {
  generation: 0,
  data: null,
  loading: true,
  error: null,
};
export function applyCurationResponse(
  state: CurationState,
  page: CurationList,
  generation: number,
  more: boolean,
): CurationState {
  if (generation !== state.generation) return state;
  if (
    more &&
    (!state.data ||
      state.data.snapshotId !== page.snapshotId ||
      state.data.total !== page.total ||
      state.data.asOf !== page.asOf ||
      state.data.expiresAt !== page.expiresAt)
  )
    return { ...state, loading: false, data: null, error: 'snapshot_scope_changed' };
  return {
    ...state,
    loading: false,
    error: null,
    data:
      more && state.data
        ? {
            ...page,
            tracks: [
              ...state.data.tracks,
              ...page.tracks.filter(
                (t) => !state.data!.tracks.some((old) => old.trackId === t.trackId),
              ),
            ],
          }
        : page,
  };
}
export function isCurationPath(path: string, base: string) {
  return path === `${base}music/curation` || path === `${base}music/curation/`;
}
