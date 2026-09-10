import { fetchPlaybackPlan } from './playback-plan';
import {
  initialQualityState,
  offsetTarget,
  type QualityState,
  type QualitySelection,
} from './quality';
import type { PlaybackPlan, PlaybackQuality } from '@musiclatte/contracts';
import { createListeningTracker } from '../listening/tracker';
import {
  createListeningSender,
  initialListeningObserver,
  type ListeningObserverState,
} from '../listening/client';
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
import { mediaRoutes, type MusicEntry } from '@musiclatte/contracts';
import { connectMediaSession } from './media-session';
import {
  appendQueue,
  advanceQueue,
  createQueue,
  currentSong,
  nextRepeatMode,
  replaceWithRandom,
  setRepeat,
  setShuffle,
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
  readonly playbackRate?: number;
  readonly seeking?: boolean;
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
  quality: QualityState;
  retryOriginal: () => void;
  listening: ListeningObserverState;
  activate: SongActivation;
  appendSongs: (songs: readonly MusicEntry[]) => void;
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

export function PlayerProvider({
  children,
  fetcher,
  apiOrigin,
  audioFactory = () => new Audio(),
  onUnauthenticated,
  listening,
  quality,
}: {
  quality?: QualitySelection;
  listening?: { enabled: boolean; scope: string; csrfToken: string };
  children: ReactNode;
  fetcher: typeof fetch;
  apiOrigin: string;
  audioFactory?: () => PlayerAudio;
  onUnauthenticated: () => void;
}) {
  const [audio] = useState(audioFactory);
  const [qualityState, setQualityState] = useState(initialQualityState);
  const activeSource = useRef<{
    plan: PlaybackPlan | null;
    offset: number;
    ready: boolean;
    restore: number | null;
  }>({ plan: null, offset: 0, ready: true, restore: null });
  const selection = useRef(quality);
  selection.current = quality;
  const wantsPlayback = useRef(false);
  const streamProbe = useRef<AbortController | null>(null);
  const planRequest = useRef<AbortController | null>(null);
  const requestGeneration = useRef(0);
  const recovery = useRef<{
    song: MusicEntry;
    action?: PlayerAction;
    newInstance: boolean;
    position: number;
  } | null>(null);
  const logicalTime = useCallback(() => activeSource.current.offset + audio.currentTime, [audio]);
  const logicalDuration = useCallback(
    () => activeSource.current.plan?.durationSeconds ?? audio.duration,
    [audio],
  );
  const [listeningState, setListeningState] = useState(initialListeningObserver);
  const sender = useRef<ReturnType<typeof createListeningSender> | null>(null);
  const [tracker] = useState(() =>
    createListeningTracker({ emit: (event) => sender.current?.enqueue(event) }),
  );
  const observeListening = useCallback(
    (type: string) =>
      tracker.observe(type, {
        time: logicalTime(),
        duration: logicalDuration(),
        rate: audio.playbackRate ?? 1,
        paused: audio.paused,
        seeking: audio.seeking ?? false,
      }),
    [audio, tracker, logicalTime, logicalDuration],
  );
  useEffect(() => {
    tracker.clear();
    setListeningState(initialListeningObserver);
    if (!listening?.enabled) return;
    const owned = createListeningSender({
      fetcher,
      apiOrigin,
      csrfToken: listening.csrfToken,
      onUnauthenticated,
      onChange: setListeningState,
      onRecorded: () => window.dispatchEvent(new Event('musiclatte:listening-recorded')),
    });
    sender.current = owned;
    return () => {
      owned.dispose();
      if (sender.current === owned) sender.current = null;
      tracker.clear();
    };
  }, [
    listening?.enabled,
    listening?.scope,
    listening?.csrfToken,
    fetcher,
    apiOrigin,
    onUnauthenticated,
    tracker,
  ]);
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
    const next = reducePlayerState(stateRef.current, action);
    stateRef.current = next;
    setState(next);
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

  const loadSource = useCallback(
    (
      song: MusicEntry,
      plan: PlaybackPlan | null,
      position: number,
      newInstance: boolean,
      action?: PlayerAction,
      autoplay = true,
    ) => {
      observeListening('seeking');
      streamProbe.current?.abort();
      wantsPlayback.current = autoplay;
      const generation = ++playGeneration.current;
      audio.pause();
      const offset =
        plan?.seekMode === 'offset' ? offsetTarget(position, plan.durationSeconds!) : 0;
      activeSource.current = {
        plan,
        offset,
        ready: false,
        restore: plan?.seekMode === 'offset' ? null : position,
      };
      if (action) commit(action);
      if (newInstance && sender.current)
        tracker.start(song.id, plan?.durationSeconds ?? song.duration);
      const route = plan
        ? plan.seekMode === 'offset' && position > 0
          ? mediaRoutes.songStream(song.id, plan.effectiveQuality, offset)
          : plan.streamPath
        : mediaRoutes.songStream(song.id);
      audio.src = apiOrigin + route;
      audio.load();
      try {
        audio.currentTime = plan?.seekMode === 'offset' ? 0 : position;
      } catch {
        /* Restore after metadata. */
      }
      commit({
        type: 'time',
        currentTime: plan?.seekMode === 'offset' ? offset : position,
        duration: plan?.durationSeconds ?? song.duration ?? 0,
      });
      commit({ type: autoplay ? 'loading' : 'pause' });
      setQualityState({
        active: plan,
        resolving: false,
        reason: plan?.reason ?? null,
        error: false,
        canRetryOriginal: false,
      });
      if (autoplay)
        void audio.play().catch(() => {
          if (generation === playGeneration.current)
            commit({ type: 'play-rejected', error: 'play_not_allowed' });
        });
    },
    [apiOrigin, audio, commit, tracker, observeListening],
  );

  const startSong = useCallback(
    (
      song: MusicEntry,
      action?: PlayerAction,
      newInstance = true,
      forced?: PlaybackQuality,
      position = 0,
    ) => {
      planRequest.current?.abort();
      const generation = ++requestGeneration.current;
      recovery.current = { song, ...(action ? { action } : {}), newInstance, position };
      if (!selection.current?.enabled && !forced) {
        loadSource(song, null, position, newInstance, action);
        return;
      }
      const controller = new AbortController();
      planRequest.current = controller;
      const requested = forced ?? selection.current!.value;
      setQualityState((p) => ({
        ...p,
        resolving: true,
        error: false,
        reason: null,
        canRetryOriginal: false,
      }));
      void fetchPlaybackPlan(fetcher, apiOrigin, song.id, requested, controller.signal)
        .then((plan) => {
          if (controller.signal.aborted || generation !== requestGeneration.current) return;
          if (plan.reason && plan.reason !== 'already_small') {
            setQualityState((p) => ({
              ...p,
              resolving: false,
              reason: plan.reason!,
              canRetryOriginal: true,
            }));
            return;
          }
          recovery.current = null;
          loadSource(song, plan, position, newInstance, action);
        })
        .catch((error) => {
          if (controller.signal.aborted || generation !== requestGeneration.current) return;
          if (error instanceof ApiError && error.code === 'unauthenticated') {
            onUnauthenticated();
            return;
          }
          setQualityState((p) => ({
            ...p,
            resolving: false,
            error: true,
            canRetryOriginal: requested === 'economy',
          }));
        });
    },
    [apiOrigin, fetcher, loadSource, onUnauthenticated],
  );

  const startQueue = useCallback(
    (queue: NonNullable<PlayerState['queue']>) => {
      const song = currentSong(queue);
      if (song) startSong(song, { type: 'queue', queue, status: 'loading' });
    },
    [startSong],
  );
  const activate = useCallback<SongActivation>(
    ({ song, songs, source, position }) => {
      const queue = createQueue(songs, song.id, source, position);
      startSong(currentSong(queue)!, {
        type: 'activate',
        song,
        songs,
        source,
        ...(position === undefined ? {} : { position }),
      });
    },
    [startSong],
  );
  const retryOriginal = useCallback(() => {
    const pending = recovery.current;
    const current = stateRef.current.current;
    if (pending)
      startSong(pending.song, pending.action, pending.newInstance, 'original', pending.position);
    else if (current)
      startSong(current, undefined, false, 'original', stateRef.current.currentTime);
  }, [startSong]);

  const appendSongs = useCallback(
    (songs: readonly MusicEntry[]) => {
      const current = stateRef.current;
      const queue = appendQueue(current.queue, songs);
      if (queue && queue !== current.queue)
        commit({ type: 'queue', queue, ...(current.queue ? {} : { status: 'paused' }) });
    },
    [commit],
  );
  const pause = useCallback(() => {
    wantsPlayback.current = false;
    audio.pause();
  }, [audio]);
  const resume = useCallback(() => {
    if (!stateRef.current.current) return;
    if (!audio.src || audio.ended || stateRef.current.status === 'ended') {
      startSong(stateRef.current.current);
      return;
    }
    wantsPlayback.current = true;
    const shouldReload = stateRef.current.status === 'error';
    const generation = ++playGeneration.current;
    commit({ type: 'loading' });
    if (shouldReload && activeSource.current.plan) {
      loadSource(
        stateRef.current.current,
        activeSource.current.plan,
        stateRef.current.currentTime,
        false,
      );
      return;
    }
    if (shouldReload) audio.load();
    void audio.play().catch(() => {
      if (generation === playGeneration.current)
        commit({ type: 'play-rejected', error: 'play_not_allowed' });
    });
  }, [audio, commit, startSong, loadSource]);

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
  const seek = useCallback(
    (seconds: number) => {
      if (!Number.isFinite(seconds) || !stateRef.current.current) return;
      planRequest.current?.abort();
      requestGeneration.current++;
      recovery.current = null;
      const plan = activeSource.current.plan;
      if (plan?.seekMode === 'offset') {
        loadSource(
          stateRef.current.current,
          plan,
          seconds,
          false,
          undefined,
          wantsPlayback.current,
        );
        return;
      }
      observeListening('seeking');
      const duration = logicalDuration();
      audio.currentTime = Math.min(Math.max(0, seconds), duration || Number.MAX_SAFE_INTEGER);
      commit({ type: 'time', currentTime: audio.currentTime, duration });
      commit({ type: 'seeking' });
    },
    [audio, commit, observeListening, logicalDuration, loadSource],
  );
  const previous = useCallback(() => {
    if (stateRef.current.currentTime > 3) seek(0);
    else move('previous');
  }, [move, seek]);
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
    if (queue) commit({ type: 'queue', queue: setRepeat(queue, nextRepeatMode(queue.repeat)) });
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
      [
        'loadedmetadata',
        () => {
          if (activeSource.current.restore !== null) {
            try {
              audio.currentTime = activeSource.current.restore;
              activeSource.current.restore = null;
            } catch {
              /* Native seek unavailable. */
            }
          }
          activeSource.current.ready = true;
        },
      ],
      [
        'playing',
        () => {
          activeSource.current.ready = true;
          commit({ type: 'playing' });
        },
      ],
      ['pause', () => commit({ type: 'pause' })],
      ['waiting', () => commit({ type: 'loading' })],
      ['stalled', () => commit({ type: 'loading' })],
      ['seeking', () => commit({ type: 'seeking' })],
      ['seeked', () => commit({ type: 'seeked', paused: audio.paused })],
      [
        'timeupdate',
        () => {
          if (activeSource.current.ready)
            commit({ type: 'time', currentTime: logicalTime(), duration: logicalDuration() });
        },
      ],
      [
        'durationchange',
        () => {
          if (activeSource.current.ready)
            commit({ type: 'time', currentTime: logicalTime(), duration: logicalDuration() });
        },
      ],
      ['volumechange', () => commit({ type: 'volume', volume: audio.volume })],
      [
        'ended',
        () => {
          observeListening('ended');
          if (
            activeSource.current.plan?.seekMode === 'offset' &&
            logicalTime() < logicalDuration() - 1
          ) {
            commit({ type: 'media-error', error: 'media_unavailable' });
            setQualityState((p) => ({ ...p, error: true, canRetryOriginal: true }));
          } else move('next', true);
        },
      ],
      [
        'error',
        () => {
          commit({ type: 'media-error', error: 'media_unavailable' });
          const song = stateRef.current.current;
          const plan = activeSource.current.plan;
          if (song && plan) {
            const generation = playGeneration.current;
            streamProbe.current?.abort();
            const controller = new AbortController();
            streamProbe.current = controller;
            void fetchPlaybackPlan(
              fetcher,
              apiOrigin,
              song.id,
              plan.effectiveQuality,
              controller.signal,
            )
              .then((fresh) => {
                if (
                  !controller.signal.aborted &&
                  generation === playGeneration.current &&
                  fresh.reason
                )
                  setQualityState((p) => ({
                    ...p,
                    reason: fresh.reason!,
                    error: true,
                    canRetryOriginal: true,
                  }));
              })
              .catch((error) => {
                if (
                  !controller.signal.aborted &&
                  generation === playGeneration.current &&
                  error instanceof ApiError &&
                  error.code === 'unauthenticated'
                )
                  onUnauthenticated();
              });
          }
          if (activeSource.current.plan?.effectiveQuality === 'economy')
            setQualityState((p) => ({ ...p, error: true, canRetryOriginal: true }));
        },
      ],
    ];
    const trackedEvents = [
      'playing',
      'pause',
      'waiting',
      'stalled',
      'seeking',
      'seeked',
      'timeupdate',
      'durationchange',
      'error',
      'loadstart',
      'emptied',
      'ratechange',
    ].map((type) => [type, () => observeListening(type)] as const);
    for (const [type, listener] of trackedEvents) audio.addEventListener(type, listener);
    for (const [type, listener] of events) audio.addEventListener(type, listener);
    return () => {
      for (const [type, listener] of events) audio.removeEventListener(type, listener);
      for (const [type, listener] of trackedEvents) audio.removeEventListener(type, listener);
    };
  }, [
    audio,
    commit,
    move,
    observeListening,
    logicalTime,
    logicalDuration,
    fetcher,
    apiOrigin,
    onUnauthenticated,
  ]);

  useEffect(
    () => () => {
      planRequest.current?.abort();
      requestGeneration.current++;
    },
    [quality?.scope],
  );
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.setPositionState(
        state.duration > 0
          ? {
              duration: state.duration,
              position: Math.min(state.currentTime, state.duration),
              playbackRate: audio.playbackRate ?? 1,
            }
          : undefined,
      );
    } catch {
      /* Partial browser implementation. */
    }
  }, [state.currentTime, state.duration, audio]);

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
      planRequest.current?.abort();
      streamProbe.current?.abort();
      requestGeneration.current++;
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
      quality: qualityState,
      retryOriginal,
      listening: listeningState,
      activate,
      appendSongs,
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
      listeningState,
      qualityState,
      retryOriginal,
      state,
      activate,
      appendSongs,
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
