# Phase 4 Step 03 — MP3 tag and lyrics roundtrip

Implemented 2026-09-08 from `e3e5147` on
`yellowgg2/tdd/phase-4/step-03-mp3-tag-lyrics-helper`.

RED: four intended assertions failed because the helper implementation was absent.
GREEN: five real subprocess tests cover v2.3/v2.4, tagless and read-only v2.2,
Korean/multivalue tags, valid/invalid leap years, PNG replacement/removal and JPEG addition,
USLT selection, SYLT/source-ID/ReplayGain/other artwork preservation, raw unknown frame bytes,
ID3v1 bytes, malformed fields/images/corrupt tags and original-file immutability. Every successful
prepare checks real FFprobe audio packet hashes and full FFmpeg decode before/after.

Runtime: Node 24.20.0, npm 11.19.0, isolated Python 3.11.15, Mutagen 1.48.1 installed with
`--require-hashes --only-binary=:all:`. Local FFmpeg and FFprobe are 9.0.1-tessus x86_64,
executed through macOS Rosetta. Their executables remain outside Git at the project toolchain
cache. Host global runtimes were unchanged. This is local helper evidence; Step 07 owns the
Linux deployment image and records its distinct runtime versions.

Official FFmpeg download links identify [evermeet.cx](https://evermeet.cx/ffmpeg/) as a macOS
binary distributor. The exact 9.0.1 archives were downloaded from that distributor:

| Artifact           | SHA256                                                             |
| ------------------ | ------------------------------------------------------------------ |
| ffmpeg ZIP         | `8a8c9e549983409fe6604b9aa665648b7a5def9407fe814c39c8b2ea7f64a48f` |
| ffmpeg executable  | `e27de05e3a9f9c758f9766d15d1a069fddeed5f725e35d9ab28683be4740dad7` |
| ffprobe ZIP        | `d13f35db03456b7f65b7edb6437c86e23810fbfe91795e571f5b77211343b4f1` |
| ffprobe executable | `a1508faa028bfb8e20c9d182c3d41fcff29ee7584ae21b2d6c357472a3ecbc24` |

Both version probes and actual read/prepare/decode tests exited 0. Test fixture audio is a
lavfi sine tone; images are small solid colors and lyrics are original synthetic sentences.
Temporary files/processes are cleaned by the harness. No live music or remote service was used.

Validation after formatting: affected helper + file-boundary unit tests 12/12 passed in two
files, zero skips. Typecheck passed. Final contract/build/format results are recorded below.

No UI/locale/Gallery changes or review debt. Existing process-runner behavior is reused.
Rulebook lookup selected no compatible relevant rule; postflight `skipped(no_new_lesson)`.
No central writes or sync. Vault status is maintained outside repository commits.

Final gates: metadata-schema + production-exclusion contract 10/10 passed, zero skips;
`npm run typecheck`, `npm run build` and `npm run format:check` each exited 0.
