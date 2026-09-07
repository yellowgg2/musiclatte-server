# Phase 4 S09 — Single-song metadata editor and job history

Status: complete. CRITICAL/full review passed; final UI approved by the user. Git runs as a separate handoff after the TDD cycle.

Branch: `yellowgg2/tdd/phase-4/step-09-single-metadata-editor`, based on S08 `60d444f`. Session-local Node 24.20.0 / npm 11.19.0; host toolchains unchanged.

## Implemented behavior

Lazy per-resource MetadataAction uses existing MusicRow slots in folder/search/album, favorites, recent downloads and playlists. MetadataEditor edits actual values with dirty-only patches, explicit clears, individual array inputs, selected cover frames and USLT selectors. Preview precedes a stable-operation submission; uncertain retries preserve that operation. Accepted jobs detach into persistent history/detail routes. File save and verified library reflection have separate labels. Metadata and lyrics client consumers are enabled; bulk and recovery actions remain owned by S10/S11.

Approved Action, IconAction, TextField, StatusSurface, Artwork and MusicRow are reused. Editor, focus hook and job views are feature-local; shared-new=0 and global baseline changes=0. KO/EN strings and accessible labels accompany each feature.

## Automated verification

- RED assertions preceded editor, lazy action, status and route implementation. Focus fallback, absent-field undo and capability-scope history initialization regressions failed before their corrections.
- Final web/workspace unit: **168 tests / 22 files passed**. Final metadata UI/production-exclusion contracts: **10 tests / 2 files passed**. Earlier broader affected contracts: 51 tests / 7 files passed. No skips or zero-test filters.
- Typecheck, production build, format check and diff check passed. Legacy jsdom media/scroll warnings do not replace browser verification.
- History scope activation now occurs before child passive reads. Cover cancellation clears both its pending object URL and native file-input value. Both corrections were verified in Chrome.

## Actual private runtime

An isolated Compose project used a generated 180-second MP3, separate music directory, loopback ports and owned volumes. Existing gonic demo, actual user music and host runtime were preserved. Gonic 0.22.0 and the previously verified metadata worker performed actual writes. The HTTP loopback API ran in test mode; production HTTPS policy was unchanged.

`runtime.json` contains sanitized boolean results only: title and USLT verification, duplicate-operation job identity, current-song ID preservation, cover save/read/verified generation and unchanged audio payload after both writes. Chrome displayed the indexed updated title and loaded the versioned cover image. Private credentials, music, queries and file paths are excluded from committed evidence.

A subsequent Chrome-initiated title edit completed through the real worker and gonic; the private probe confirmed unchanged audio payload. The known warmed gonic cover-cache mismatch limitation remains unchanged.

## UI verification

[Browser observations](browser.md) records normal-entry real file save, history reentry, complete required state coverage, KO/EN, 1800/390/320 widths, actual 200% zoom, long content, keyboard/focus and continuous playback on final source: passed(automation).

The user confirmed that the remaining reduced-motion and touch conditions worked after manual testing: passed(user/manual). These checks stay owned and completed in S09; they are not deferred to S11. Final CRITICAL UI approval: approved(user). Full review: FATAL0/MAJOR0, review debt0. Existing Gallery approval remains unchanged. S11 still owns its distinct real-device/client end-to-end scenarios.

## Postflight and cleanup

Rulebook: skipped(no_new_lesson). No eligible new recurring lesson; no canonical writes or project lesson files. Reused safeguards: `typescript-reload-failed-html-audio-resources-and-preserve-concrete-media-errors-001` and `typescript-bound-popup-split-panes-and-own-overflow-at-the-content-region-001`.

Owned remote containers, network, eight volumes, S09 image and synthetic-music directory removed; existing gonic demo and reused S07 images preserved. Owned local 18489/18490/18491 harnesses and 18090 tunnel stopped. Final test tab closed; user gonic tab preserved. Browser zoom restored and viewport override reset. No private media or credentials are committed.
