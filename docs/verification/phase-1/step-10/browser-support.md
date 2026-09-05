# S10 browser playback support

- Playback uses one route-persistent `HTMLAudioElement`. A user activation is still required when a
  browser blocks autoplay; the UI never reports playing until the media element emits `playing`.
- Chrome 152 passed product-path playback, seek, queue, Shuffle, Repeat All/One, random replacement,
  error recovery and Media Session best-effort wiring with a generated two-second WAV.
- The responsive UI provides a desktop player and queue, plus a mobile mini-player and modal sheet.
  The sheet contains keyboard focus, Escape restores the opener, and the queue owns its named
  focusable scroll region.
- Media Session metadata/actions are installed only when supported. Unsupported actions are ignored
  and normal HTML audio remains available.
- Browser/OS background suspension, lock-screen policy, gapless playback, Bluetooth routing and
  native-grade uninterrupted playback are not promised. Physical iPhone Safari play/seek,
  orientation, lock and return remain the required user-owned check.
- Logout/account teardown aborts random work, pauses audio, clears its source and discards the queue.
  Route and locale changes intentionally do not.
