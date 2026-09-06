import type { ApiErrorCode, MusicEntry } from '@musiclatte/contracts';
import { ApiError } from '../auth/client';
import type { FavoritesClient } from './client';

export interface FavoriteSongState {
  pending: boolean;
  error?: ApiErrorCode;
}

export interface FavoritesState {
  accountId?: string;
  enabled: boolean;
  loaded: boolean;
  loading: boolean;
  songs: MusicEntry[];
  error: ApiErrorCode | undefined;
  songStates: Readonly<Record<string, FavoriteSongState>>;
}

interface FailedIntent {
  song: MusicEntry;
  desired: boolean;
}

function codeOf(error: unknown): ApiErrorCode {
  if (error instanceof ApiError) return error.code;
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code as ApiErrorCode;
  }
  return 'upstream_unavailable';
}

export function createFavoritesStore({
  client,
  onUnauthenticated,
}: {
  client: Pick<FavoritesClient, 'read' | 'set'>;
  onUnauthenticated: () => void;
}) {
  let state: FavoritesState = {
    enabled: false,
    loaded: false,
    loading: false,
    songs: [],
    error: undefined,
    songStates: {},
  };
  let csrfToken = '';
  let lifecycle = 0;
  let refreshController: AbortController | undefined;
  let refreshGeneration = 0;
  let mutationGeneration = 0;
  const starredIds = new Set<string>();
  const mutations = new Map<
    string,
    { generation: number; lifecycle: number; desired: boolean; controller: AbortController }
  >();
  const failed = new Map<string, FailedIntent>();
  const listeners = new Set<() => void>();

  function emit(patch: Partial<FavoritesState>) {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  }

  function songStatesWith(id: string, value?: FavoriteSongState) {
    const songStates = { ...state.songStates };
    if (value) songStates[id] = value;
    else delete songStates[id];
    return songStates;
  }

  function isStarred(song: MusicEntry): boolean {
    const mutation = mutations.get(song.id);
    if (mutation) return mutation.desired;
    return state.loaded ? starredIds.has(song.id) : Boolean(song.starred);
  }

  function getSongState(id: string): FavoriteSongState {
    return state.songStates[id] ?? { pending: false };
  }

  async function refresh() {
    if (!state.enabled || !state.accountId) return;
    refreshController?.abort();
    const controller = new AbortController();
    refreshController = controller;
    const currentLifecycle = lifecycle;
    const generation = ++refreshGeneration;
    emit({ loading: true, error: undefined });
    try {
      const result = await client.read(controller.signal);
      if (
        controller.signal.aborted ||
        lifecycle !== currentLifecycle ||
        refreshGeneration !== generation
      )
        return;
      starredIds.clear();
      for (const song of result.songs) starredIds.add(song.id);
      emit({ songs: result.songs, loaded: true, loading: false, error: undefined });
    } catch (error) {
      if (
        controller.signal.aborted ||
        lifecycle !== currentLifecycle ||
        refreshGeneration !== generation
      )
        return;
      const code = codeOf(error);
      if (code === 'unauthenticated') onUnauthenticated();
      else emit({ loading: false, error: code });
    }
  }

  function mutate(song: MusicEntry, desired: boolean): boolean {
    if (!state.enabled || !state.accountId || mutations.has(song.id)) return false;
    failed.delete(song.id);
    const controller = new AbortController();
    const generation = ++mutationGeneration;
    const currentLifecycle = lifecycle;
    mutations.set(song.id, { generation, lifecycle: currentLifecycle, desired, controller });
    emit({ songStates: songStatesWith(song.id, { pending: true }) });
    void client.set(song.id, desired, { csrfToken, signal: controller.signal }).then(
      (result) => {
        const current = mutations.get(song.id);
        if (
          !current ||
          current.generation !== generation ||
          current.lifecycle !== lifecycle ||
          controller.signal.aborted
        )
          return;
        mutations.delete(song.id);
        if (result.starred) {
          starredIds.add(song.id);
          const songs = [result.song, ...state.songs.filter((entry) => entry.id !== song.id)];
          emit({ songs, songStates: songStatesWith(song.id) });
        } else {
          starredIds.delete(song.id);
          emit({
            songs: state.songs.filter((entry) => entry.id !== song.id),
            songStates: songStatesWith(song.id),
          });
        }
      },
      (error) => {
        const current = mutations.get(song.id);
        if (
          !current ||
          current.generation !== generation ||
          current.lifecycle !== lifecycle ||
          controller.signal.aborted
        )
          return;
        mutations.delete(song.id);
        const code = codeOf(error);
        if (code === 'unauthenticated') {
          emit({ songStates: songStatesWith(song.id) });
          onUnauthenticated();
          return;
        }
        failed.set(song.id, { song, desired });
        emit({ songStates: songStatesWith(song.id, { pending: false, error: code }) });
      },
    );
    return true;
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isStarred,
    getSongState,
    toggle(song: MusicEntry) {
      return mutate(song, !isStarred(song));
    },
    retry(id: string) {
      const intent = failed.get(id);
      return intent ? mutate(intent.song, intent.desired) : false;
    },
    refresh,
    async setScope({
      accountId,
      csrfToken: nextCsrfToken,
      enabled,
    }: {
      accountId: string;
      csrfToken: string;
      enabled: boolean;
    }) {
      if (state.accountId === accountId && csrfToken === nextCsrfToken && state.enabled === enabled)
        return;
      lifecycle++;
      refreshController?.abort();
      for (const mutation of mutations.values()) mutation.controller.abort();
      mutations.clear();
      failed.clear();
      starredIds.clear();
      csrfToken = nextCsrfToken;
      state = {
        accountId,
        enabled,
        loaded: false,
        loading: enabled,
        songs: [],
        error: undefined,
        songStates: {},
      };
      listeners.forEach((listener) => listener());
      if (enabled) await refresh();
    },
    dispose() {
      lifecycle++;
      refreshController?.abort();
      for (const mutation of mutations.values()) mutation.controller.abort();
      mutations.clear();
      failed.clear();
      listeners.clear();
    },
  };
}

export type FavoritesStore = ReturnType<typeof createFavoritesStore>;
