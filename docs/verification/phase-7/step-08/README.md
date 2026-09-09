# Phase 7 S08 — playback quality API

Node24.20.0/npm11.19.0; base00269e2. Implementation complete.

- RED:3 failed/8 passed before implementation: missing playback route, rejected quality query,
  missing authenticated route behavior. GREEN:31 unit tests and8 contract tests passed, including
  existing media proxy and gateway parity consumers. Typecheck, build and format:check exit0.
- Strict input, flag-off legacy behavior, frozen upstream formats, metadata revalidation,
  already-small and unknown metadata, offset bounds, auth, representation validator isolation,
  warm200/206/304/416 and HEAD are covered. Existing proxy abort/backpressure regressions retained.
- SSH isolated gonic v0.22.0 image
  `sha256:516fd9645614ba3a596d86174216c3e944808b9ec970c581678713be4c8b1d49`, own loopback18527,
  owned cache/data and original synthetic noise assets. No existing service/cache/music touched.
- Actual transcodeOffset v1 read.90s64kbps MP3 resolves native/original;256kbps MP3 and933kbps
  FLAC resolve offset/economy. All raw HEAD200,Range206,conditional304,invalidRange416.
  Both high-bitrate cold requests200/chunked audio/mpeg; warm Range206. Offset30 returned200
  and960514 bytes. Independent ffprobe measured MP3/128000bps/60.029375s for both offset files.
  Abort propagated and no ffmpeg process remained after the probe.
- Real gonic sends Last-Modified without ETag for these originals. Added representation ETag
  mapping to preserve304 while blocking validator reuse across quality/offset; reran live probe.
- `tests/support/stream-quality-live.ts` consumes only0600 config file, emits sanitized facts.
  Live results are separate from synthetic HTTP contract fixture assertions.
- No UI/shared component change. Web uses legacy URL untilS09. Final quality/device acceptance
  remains owned by ui-acceptance. Rulebook postflight skipped(no_new_lesson), no canonical writes.
