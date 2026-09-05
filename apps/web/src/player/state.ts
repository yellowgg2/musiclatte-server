import { createQueue, currentSong, type PlayerQueue } from './queue';
import type { MusicEntry } from '@musiclatte/contracts';

export type PlaybackStatus =
  'idle' | 'loading' | 'playing' | 'paused' | 'seeking' | 'ended' | 'error';
export type PlayerError = 'play_not_allowed' | 'media_unavailable' | null;
export type RandomStatus = 'idle' | 'loading' | 'empty' | 'error';

export interface PlayerState {
  status: PlaybackStatus;
  queue: PlayerQueue | null;
  current: MusicEntry | null;
  currentTime: number;
  duration: number;
  volume: number;
  error: PlayerError;
  randomStatus: RandomStatus;
}

export const initialPlayerState: PlayerState = {
  status: 'idle',
  queue: null,
  current: null,
  currentTime: 0,
  duration: 0,
  volume: 1,
  error: null,
  randomStatus: 'idle',
};

export type PlayerAction =
  | { type: 'activate'; songs: readonly MusicEntry[]; song: MusicEntry; source: string }
  | { type: 'queue'; queue: PlayerQueue; status?: PlaybackStatus }
  | { type: 'loading' }
  | { type: 'playing' }
  | { type: 'pause' }
  | { type: 'seeking' }
  | { type: 'seeked'; paused: boolean }
  | { type: 'time'; currentTime: number; duration: number }
  | { type: 'volume'; volume: number }
  | { type: 'play-rejected'; error: Exclude<PlayerError, null> }
  | { type: 'media-error'; error: Exclude<PlayerError, null> }
  | { type: 'ended' }
  | { type: 'random'; status: RandomStatus }
  | { type: 'clear' };

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function reducePlayerState(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case 'activate': {
      const queue = createQueue(action.songs, action.song.id, action.source);
      return {
        ...state,
        queue,
        current: currentSong(queue),
        status: 'loading',
        currentTime: 0,
        duration: finite(action.song.duration ?? 0),
        error: null,
        randomStatus: 'idle',
      };
    }
    case 'queue': {
      const current = currentSong(action.queue);
      const changed = current?.id !== state.current?.id;
      return {
        ...state,
        queue: action.queue,
        current,
        currentTime: changed ? 0 : state.currentTime,
        duration: changed ? finite(current?.duration ?? 0) : state.duration,
        status: action.status ?? state.status,
        error: null,
      };
    }
    case 'loading':
      return { ...state, status: 'loading', error: null };
    case 'playing':
      return { ...state, status: 'playing', error: null };
    case 'pause':
      return state.status === 'ended' ? state : { ...state, status: 'paused' };
    case 'seeking':
      return { ...state, status: 'seeking' };
    case 'seeked':
      return { ...state, status: action.paused ? 'paused' : 'playing' };
    case 'time': {
      const duration = finite(action.duration);
      return {
        ...state,
        duration,
        currentTime: Math.min(finite(action.currentTime), duration || Number.MAX_SAFE_INTEGER),
      };
    }
    case 'volume':
      return { ...state, volume: Math.min(1, finite(action.volume, state.volume)) };
    case 'play-rejected':
      return state.status === 'error' ? state : { ...state, status: 'paused', error: action.error };
    case 'media-error':
      return { ...state, status: 'error', error: action.error };
    case 'ended':
      return { ...state, status: 'ended', currentTime: state.duration };
    case 'random':
      return { ...state, randomStatus: action.status };
    case 'clear':
      return initialPlayerState;
  }
}
