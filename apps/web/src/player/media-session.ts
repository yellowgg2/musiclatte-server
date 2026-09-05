import { mediaRoutes, type MusicEntry } from '@musiclatte/contracts';

export interface MediaSessionControls {
  play: () => void;
  pause: () => void;
  previous: () => void;
  next: () => void;
  seek: (seconds: number) => void;
  currentTime: () => number;
}

export function connectMediaSession(
  song: MusicEntry | null,
  controls: MediaSessionControls,
): () => void {
  if (
    typeof navigator === 'undefined' ||
    typeof window === 'undefined' ||
    !('mediaSession' in navigator)
  )
    return () => undefined;
  const session = navigator.mediaSession;
  if (song && 'MediaMetadata' in window) {
    session.metadata = new MediaMetadata({
      title: song.title,
      ...(song.artist ? { artist: song.artist } : {}),
      ...(song.album ? { album: song.album } : {}),
      artwork: song.coverArt
        ? [{ src: mediaRoutes.cover(song.coverArt), sizes: '512x512', type: 'image/jpeg' }]
        : [],
    });
  } else session.metadata = null;
  const actions: [MediaSessionAction, MediaSessionActionHandler | null][] = [
    ['play', controls.play],
    ['pause', controls.pause],
    ['previoustrack', controls.previous],
    ['nexttrack', controls.next],
    [
      'seekto',
      (details) => {
        if (details.seekTime !== undefined) controls.seek(details.seekTime);
      },
    ],
    [
      'seekbackward',
      (details) => controls.seek(Math.max(0, controls.currentTime() - (details.seekOffset ?? 10))),
    ],
    [
      'seekforward',
      (details) => controls.seek(controls.currentTime() + (details.seekOffset ?? 10)),
    ],
  ];
  for (const [action, handler] of actions) {
    try {
      session.setActionHandler(action, handler);
    } catch {
      /* The browser may expose Media Session without every action. */
    }
  }
  return () => {
    for (const [action] of actions) {
      try {
        session.setActionHandler(action, null);
      } catch {
        /* Keep cleanup best-effort on partial implementations. */
      }
    }
    session.metadata = null;
  };
}
