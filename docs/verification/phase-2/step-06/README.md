# Phase 2 Step 06 verification — playlist read UI and playback

Date: 2026-09-05. Runtime: Node 24.20.0, npm 11.19.0, Google Chrome 152.0.7977.82.
Work branch: `yellowgg2/tdd/phase-2/step-06-playlist`.

## Delivered behavior

- Added strict query-free `/playlists` and opaque-ID `/playlists/:id` consumers with abort,
  generation discard, safe direct-entry auth return and normalized 401/403/404/503 handling.
- Enabled only the `playlists.read` web feature and connected desktop/mobile navigation and route
  guards to the same server capability. Playlist write and favorite controls remain absent.
- Added a feature-local PlaylistCard and detail header. The views reuse approved Action,
  StatusSurface, Artwork and MusicRow symbols; no shared symbol, global token or Gallery baseline
  changed.
- Preserved ordered duplicate occurrences with position-based React identity and player activation.
  Whole-playlist and individual-row activation share the route-persistent P1 PlayerProvider and a
  source snapshot containing the opaque playlist ID and revision.
- List summaries never fetch details for artwork. Missing or failed covers use stable fallback
  geometry. Loading, empty, unavailable, denied and missing states do not clear existing audio or
  queue state.
- Added matching nonempty KO/EN copy and compact responsive layouts for desktop, mobile and narrow
  screens.

## RED → GREEN evidence

The first focused React run collected four new tests and all four failed on missing playlist UI
behavior. The first producer-consumer contract collected one test and failed because the web
`playlists.read` feature was still false. Typecheck and production build passed during RED, so the
failure was not caused by imports, syntax, test collection or the local toolchain.

Focused GREEN passed the playlist, player and library React suites (25 tests) and the playlist UI,
playlist API and production-exclusion contract suites (10 tests). Tests cover exact opaque IDs,
query-free list/detail reads, no summary N+1, A→B→A occurrence identity, row and whole-list
activation, stale response discard, 401 deep-link recovery, capability denial, cover/empty/error
queue preservation and KO/EN rendering.

## Chrome full review

Connected Chrome exercised the real Vite UI and BFF with a deterministic synthetic upstream and
generated short WAV resources. The top-level desktop capture was 1800×919; the same session also
used 390×844 and 320×844 viewport emulation and native Chrome 200% zoom.

- Both locales rendered list/detail long names, fallback artwork, song counts and recovery copy.
  Chrome review found an oversized/misaligned narrow detail heading and duplicated Korean count
  noun; responsive typography/alignment and the locale-specific section count were corrected and
  re-reviewed at 390px and 320px.
- The detail rendered A, B, A in source order. Row activation, next, full-list activation and Queue
  preserved position order while playing actual BFF media URLs.
- Keyboard Tab/Enter expanded MusicRow with a visible focus state. Pointer activation worked at
  desktop/mobile target sizes. At 320px the final row remained fully reachable above mini-player
  and bottom navigation; at 200% zoom the header, list, player and controls retained readable
  reflow without horizontal loss.
- Loading, empty list, empty detail, 404, 403, temporary error with successful retry and cover HTTP
  failure showed distinct localized states. The pre-existing Now playing queue remained present in
  every failure state.
- The playlist feature adds no animation. Reused controls inherit the approved reduced-motion
  token and the existing player defensive reduced-motion rule. Browser warning/error logs were
  empty after the complete state matrix.

CRITICAL/full result after fixes: FATAL 0, MAJOR 0, deferred UI debt 0. S05 Gallery baseline
reapproval was not required because the implementation only reused existing shared symbols and
added feature-local composition.

## Final gates

All verification used the pinned runtime by prepending the project-local Node toolchain to `PATH`.

```text
npm run format
npm run test:unit -- apps/web/test/playlist-read-ui.test.tsx apps/web/test/player-ui.test.tsx apps/web/test/library-ui.test.tsx
npm run test:contract -- tests/contract/playlist-ui.test.ts tests/contract/playlist-api.test.ts tests/contract/production-exclusion.test.ts
npm run test:unit
npm run test:contract
npm run typecheck
npm run build
npm run format:check
git diff --check
```

Final result: unit 254/254 across 22 files and contract 109/109 across 13 files passed. Root
typecheck, production build, `format:check` and `git diff --check` also passed.

## Boundaries

No playlist create/rename/delete, song selection/add, occurrence edit or favorite UI was added.
No gonic, iOS or bot tree changed. No live devserver data, personal metadata, commit, push,
deployment or DNS change was involved. The browser fixture and control file contain synthetic data
only and are removed or stopped after review.

## Agent Rulebook postflight

Result: `skipped(no_new_lesson)`. The narrow-screen title/count findings were direct visual review
corrections with low debugging and recurrence cost. The preview-only synthetic session clock was a
local harness setup correction and did not meet the shared 3×HIGH capture threshold. No central or
project-local rule was written, so exact candidate search, canonical sync and re-search were not
applicable.
