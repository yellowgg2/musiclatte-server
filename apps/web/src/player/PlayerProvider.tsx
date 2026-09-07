import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { mediaRoutes } from '@musiclatte/contracts';
import { connectMediaSession } from './media-session';
import {
  advanceQueue,
  createQueue,
  currentSong,
  replaceWithRandom,
  setRepeat,
  setShuffle,
  type RepeatMode,
} from './queue';
import {
  initialPlayerState,
  reducePlayerState,
  type PlayerAction,
  type PlayerState,
} from './state';
import { fetchRandomSongs, RandomSongsError } from './random';
import type { SongActivation } from '../music/activation';
import { createMusicClient } from '../music/client';
import { useMetadataSync } from '../metadata/MetadataSyncProvider';
import { ApiError } from '../auth/client';

export interface PlayerAudio extends EventTarget {
  src: string;
  currentTime: number;
  readonly duration: number;
  volume: number;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly error: MediaError | null;
  load(): void;
  play(): Promise<void>;
  pause(): void;
}

interface PlayerContextValue {
  state: PlayerState;
  activate: SongActivation;
  pause: () => void;
  resume: () => void;
  previous: () => void;
  next: () => void;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  selectQueueSong: (position: number) => void;
  playRandom: () => Promise<void>;
  coverUrl: (id: string) => string;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

function repeatAfter(mode: RepeatMode): RepeatMode {
  return mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off';
}

export function PlayerProvider({
  children,
  fetcher,
  apiOrigin,
  audioFactory = () => new Audio(),
  onUnauthenticated,
}: {
  children: ReactNode;
  fetcher: typeof fetch;
  apiOrigin: string;
  audioFactory?: () => PlayerAudio;
  onUnauthenticated: () => void;
}) {
  const [audio] = useState(audioFactory);
  const [state, setState] = useState(initialPlayerState);
  const stateRef = useRef(state);
  const playGeneration = useRef(0);
  const randomRequest = useRef<AbortController | null>(null);
  const metadata = useMetadataSync();
  const musicClient = useMemo(
    () => createMusicClient({ fetcher, apiOrigin }),
    [fetcher, apiOrigin],
  );
  const refreshKey = JSON.stringify(
    [...new Set(state.queue?.items.map((song) => song.id) ?? [])].flatMap((id) =>
      metadata.state.trackVersions.has(id) ? [[id, metadata.state.trackVersions.get(id)]] : [],
    ),
  );

  const commit = useCallback((action: PlayerAction) => {
    setState((previous) => {
      const next = reducePlayerState(previous, action);
      stateRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    const ids = (JSON.parse(refreshKey) as [string, number][]).map(([id]) => id);
    if (!ids.length) return;
    const controller = new AbortController();
    let next = 0;
    const refresh = async () => {
      while (next < ids.length && !controller.signal.aborted) {
        const id = ids[next++]!;
        try {
          const song = await musicClient.song(id, controller.signal);
          if (!controller.signal.aborted) commit({ type: 'refreshMetadata', songs: [song] });
        } catch (error) {
          if (
            !controller.signal.aborted &&
            error instanceof ApiError &&
            error.code === 'unauthenticated'
          )
            onUnauthenticated();
          // A missing/conflicting song never replaces the active queue occurrence.
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, ids.length) }, refresh));
    return () => controller.abort();
  }, [refreshKey, musicClient, commit, onUnauthenticated, metadata.client]);

  const startSong = useCallback(
    (songId: string) => {
      const generation = ++playGeneration.current;
      const route = mediaRoutes.songStream(songId);
      audio.src = apiOrigin ? `${apiOrigin}${route}` : route;
      audio.currentTime = 0;
      audio.load();
      void audio.play().catch(() => {
        if (generation === playGeneration.current)
          commit({ type: 'play-rejected', error: 'play_not_allowed' });
      });
    },
    [apiOrigin, audio, commit],
  );

  const startQueue = useCallback(
    (queue: NonNullable<PlayerState['queue']>) => {
      const song = currentSong(queue);
      if (!song) return;
      commit({ type: 'queue', queue, status: 'loading' });
      startSong(song.id);
    },
    [commit, startSong],
  );

  const activate = useCallback<SongActivation>(
    ({ song, songs, source, position }) => {
      const queue = createQueue(songs, song.id, source, position);
      commit({
        type: 'activate',
        song,
        songs,
        source,
        ...(position === undefined ? {} : { position }),
      });
      startSong(currentSong(queue)!.id);
    },
    [commit, startSong],
  );

  const pause = useCallback(() => audio.pause(), [audio]);
  const resume = useCallback(() => {
    if (!stateRef.current.current) return;
    const shouldReload = stateRef.current.status === 'error';
    const generation = ++playGeneration.current;
    commit({ type: 'loading' });
    if (shouldReload) audio.load();
    void audio.play().catch(() => {
      if (generation === playGeneration.current)
        commit({ type: 'play-rejected', error: 'play_not_allowed' });
    });
  }, [audio, commit]);

  const move = useCallback(
    (direction: 'next' | 'previous', ended = false) => {
      const queue = stateRef.current.queue;
      if (!queue) return;
      const moved = advanceQueue(queue, direction, ended);
      if (moved) startQueue(moved);
      else {
        audio.pause();
        if (ended) commit({ type: 'ended' });
        else {
          audio.currentTime = 0;
          commit({ type: 'time', currentTime: 0, duration: audio.duration });
        }
      }
    },
    [audio, commit, startQueue],
  );
  const next = useCallback(() => move('next'), [move]);
  const previous = useCallback(() => {
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      commit({ type: 'time', currentTime: 0, duration: audio.duration });
    } else move('previous');
  }, [audio, commit, move]);
  const seek = useCallback(
    (seconds: number) => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : stateRef.current.duration;
      audio.currentTime = Math.min(Math.max(0, seconds), duration || Number.MAX_SAFE_INTEGER);
      commit({ type: 'seeking' });
    },
    [audio, commit],
  );
  const setVolume = useCallback(
    (volume: number) => {
      audio.volume = Math.min(1, Math.max(0, volume));
      commit({ type: 'volume', volume: audio.volume });
    },
    [audio, commit],
  );
  const toggleShuffle = useCallback(() => {
    const queue = stateRef.current.queue;
    if (queue) commit({ type: 'queue', queue: setShuffle(queue, !queue.shuffled) });
  }, [commit]);
  const cycleRepeat = useCallback(() => {
    const queue = stateRef.current.queue;
    if (queue) commit({ type: 'queue', queue: setRepeat(queue, repeatAfter(queue.repeat)) });
  }, [commit]);
  const selectQueueSong = useCallback(
    (position: number) => {
      const queue = stateRef.current.queue;
      if (!queue || !Number.isInteger(position) || queue.order[position] === undefined) return;
      startQueue({ ...queue, position });
    },
    [startQueue],
  );

  const playRandom = useCallback(async () => {
    randomRequest.current?.abort();
    const controller = new AbortController();
    randomRequest.current = controller;
    commit({ type: 'random', status: 'loading' });
    try {
      const songs = await fetchRandomSongs({ fetcher, apiOrigin, signal: controller.signal });
      if (controller.signal.aborted) return;
      const queue = replaceWithRandom(stateRef.current.queue, songs);
      if (!queue || songs.length === 0) commit({ type: 'random', status: 'empty' });
      else {
        commit({ type: 'random', status: 'idle' });
        startQueue(queue);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof RandomSongsError && error.code === 'unauthenticated') {
        onUnauthenticated();
        return;
      }
      commit({ type: 'random', status: 'error' });
    }
  }, [apiOrigin, commit, fetcher, onUnauthenticated, startQueue]);

  useEffect(() => {
    const events: [string, EventListener][] = [
      ['playing', () => commit({ type: 'playing' })],
      ['pause', () => commit({ type: 'pause' })],
      ['waiting', () => commit({ type: 'loading' })],
      ['stalled', () => commit({ type: 'loading' })],
      ['seeking', () => commit({ type: 'seeking' })],
      ['seeked', () => commit({ type: 'seeked', paused: audio.paused })],
      [
        'timeupdate',
        () => commit({ type: 'time', currentTime: audio.currentTime, duration: audio.duration }),
      ],
      [
        'durationchange',
        () => commit({ type: 'time', currentTime: audio.currentTime, duration: audio.duration }),
      ],
      ['volumechange', () => commit({ type: 'volume', volume: audio.volume })],
      ['ended', () => move('next', true)],
      ['error', () => commit({ type: 'media-error', error: 'media_unavailable' })],
    ];
    for (const [type, listener] of events) audio.addEventListener(type, listener);
    return () => {
      for (const [type, listener] of events) audio.removeEventListener(type, listener);
    };
  }, [audio, commit, move]);

  const coverUrl = useCallback(
    (id: string) => {
      if (metadata.client) return metadata.coverUrl(id);
      return `${apiOrigin}${mediaRoutes.cover(id)}`;
    },
    [apiOrigin, metadata.client, metadata.coverUrl],
  );
  useEffect(
    () =>
      connectMediaSession(
        state.current,
        {
          play: resume,
          pause,
          previous,
          next,
          seek,
          currentTime: () => stateRef.current.currentTime,
        },
        coverUrl,
      ),
    [state.current, resume, pause, previous, next, seek, coverUrl],
  );

  useEffect(
    () => () => {
      randomRequest.current?.abort();
      playGeneration.current++;
      audio.pause();
      audio.src = '';
      audio.load();
      stateRef.current = initialPlayerState;
    },
    [audio],
  );

  const value = useMemo<PlayerContextValue>(
    () => ({
      state,
      activate,
      pause,
      resume,
      previous,
      next,
      seek,
      setVolume,
      toggleShuffle,
      cycleRepeat,
      selectQueueSong,
      playRandom,
      coverUrl,
    }),
    [
      state,
      activate,
      pause,
      resume,
      previous,
      next,
      seek,
      setVolume,
      toggleShuffle,
      cycleRepeat,
      selectQueueSong,
      playRandom,
      apiOrigin,
      metadata.coverUrl,
      metadata.client,
      coverUrl,
    ],
  );
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerContextValue {
  const player = useContext(PlayerContext);
  if (!player) throw new Error('PlayerProvider is missing');
  return player;
}
