# Phase 7 S09 — quality-aware player

Node24.20.0/npm11.19.0; basefadbf47. Implementation complete.

- RED:2 real PlayerProvider integration tests failed with legacy-only audio and immediate queue
  replacement. GREEN:30 unit tests across quality player, listening tracker/provider, existing
  player UI and metadata sync;13 contract tests across strict plan client and quality API.
- Offset90 + media15 reports105 with full duration180.75 seconds before seek plus15 actual new
  seconds qualifies exactly one listening event; replaying the same interval does not duplicate it.
- Pending plan preserves old source/queue/37-second position; unmount discards late response.
  Preference change leaves load count unchanged until next occurrence. Rapid seeks retain play
  intent. Stream error keeps37 seconds; explicit original retry restores it on the same song.
- Unknown metadata does not assign an original source automatically.401 after stream error invokes
  auth expiration. MediaSession receives absolute105/180; premature ended does not skip a track.
  Existing failed-resource reload/concrete-media-error and metadata-refresh regressions pass.
- Typecheck/build/format:check exit0. Headless media-event integration is this Step's contract;
  actual Chrome controls and settings are S10. No new UI/shared component or Gallery surface.
- Rulebook failed-audio retry safeguard applied; no new eligible lesson, postflight skipped.
  Final P7-UA-003/007 acceptance remains pending.
