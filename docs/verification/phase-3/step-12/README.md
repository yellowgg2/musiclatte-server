# Phase 3 Step 12 — Engine settings

Implemented the manager-only engine panel below the existing account/language sections. The first
`engine.manage` web consumer is now enabled. `EngineStatusPanel` is feature-local and consumes the
approved Action, StatusSurface and settings tokens; Gallery/shared primitives are unchanged.

## Implementation and boundaries

- Strict closed DTO decoder validates all nine fields, channel/schema, versions, public statuses,
  recoverability and safe integer timestamps. GET requires HTTP 200 and POST acknowledgement 202.
  Cookie/CSRF/JSON, `no-store`, no redirects, 15-second request timeout, separate API origin.
- Visibility requires client implementation, supported server and allowed account. Unknown, denied
  and unsupported never render a panel. Known temporary unavailability retains state and retry.
  Recovery can remain available during failed checks; every action is still authorized by the API.
- Only `check_now` and `restore_previous` are submitted. An acknowledgement never replaces observed
  status. Sequential reads poll every two seconds after the preceding read settles; hidden tabs skip
  background reads. Nothing triggers an update through GET.
- Check requests settle only after observed progress; restore watches the previous active pointer.
  An unchanged projection cannot prove completion, including a coalesced daily request. After 30
  seconds without observable completion, show unknown outcome and require explicit refresh, without
  retrying the mutation. A slow/failed worker is not a playback failure.
- Read generation fences and effect aborts invalidate old results when instance, capability revision/
  permission/availability, username or session changes. Locale does not remount the engine or player.
- Current version/status precede check timestamps and candidate/previous. Candidate help explains
  source validation; restore applies to the next import and preserves running imports/saved playback.
  Raw executable paths, hash/argv/stderr and authentication data never become visible copy.
- KO/EN each add 37 matching nonempty keys. Dates use the selected locale and browser timezone;
  unrepresentable schema-valid dates show a safe localized fallback.

## Validation

Repository cwd: `/Users/incredibleyoung/Documents/code/musiclatte-server`.
Runtime: session-local Node **24.20.0**, npm **11.19.0**; host global runtime unchanged.

| Gate / command                                                           | Result                                                                                               |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Branch setup                                                             | Clean `main` → `yellowgg2/tdd/phase-3/step-12-engine-settings-ui`                                    |
| Initial RED: `npm run test:contract -- tests/contract/engine-ui.test.ts` | 4 intended failures: disabled consumer and missing strict client                                     |
| Initial UI fixture correction                                            | Required `music.browse` capability was missing; invalid fixture run is not counted as behavioral RED |
| Focus / unknown-outcome RED                                              | 2 intended assertion failures; fixed and reverified                                                  |
| Slow initial read RED                                                    | 1 intended assertion failure: two outstanding reads instead of one                                   |
| `npm run test:unit -- apps/web/test/engine-settings-ui.test.tsx`         | 22 passed, exit 0                                                                                    |
| Affected login/import/recent/engine UI scope                             | 58 passed before the additional slow-read regression                                                 |
| Affected engine/API/login/production-exclusion contracts                 | 16 passed                                                                                            |
| Full unit / contract                                                     | 562 unit / 131 contract passed, exit 0                                                               |
| `npm run typecheck`, `npm run build`                                     | Passed, exit 0                                                                                       |
| `npm run format`, `npm run format:check`, `git diff --check`             | Passed, exit 0                                                                                       |
| Project setup                                                            | Existing pinned dependencies and synthetic harness reused                                            |
| Refactor                                                                 | Decoder reconstructs validated typed fields; polling and focus stay local                            |
| Manual UI gate                                                           | Not required; all Step 12 scenarios are automation-capable                                           |

The real engine producer contract uses authenticated Fastify injection with SQLite and current
upstream role checks. GET has no side effect, mutations send exact bodies and enforce CSRF. Full
regressions include the existing API lifecycle, auth, import, recent, playlist and player contracts.
jsdom's existing HTMLMediaElement load/pause diagnostics are from unrelated harnesses; browser
playback was separately verified. No gonic/iOS/bot tree or live devserver data was changed.

## Chrome review and interaction evidence

Surface: connected **Chrome 152.0.7977.83**, extension browser via CUA REPL. Normal
`http://127.0.0.1:5173/` login → Music/Settings, using `tests/support/engine-preview.ts` and the
external `PREVIEW_CONTROL` file. No test-only app route or production state injection.

Class/action: **STRUCTURAL / full**, checkpoint and coverage **Step 12 only**. Review debt **0**.
Baseline: approved S05; reuse Action/StatusSurface/settings foundation, shared-new **0**,
feature-local EngineStatusPanel. Baseline reapproval not applicable.

| Scenario                           | Observed result / evidence                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Desktop KO/EN 1800×863             | Account/language before engine, matching surface alignment, label/value hierarchy. `ko-desktop.jpg`, `en-desktop-player.jpg`                                                                                 |
| All public states KO/EN at 320×844 | Correct text, previous enablement, candidate scope; every observed `scrollWidth === innerWidth === 320`. `en-320-*.jpg` and KO/EN state `.txt` snapshots                                                     |
| 390×844                            | Checking, recovery and long text maintain reachable controls. `en-390-checking.jpg`, `en-390-reduced-motion.jpg`, `ko-390-reduced-motion.jpg`                                                                |
| Long KO/EN copy/version            | Valid long versions wrap; all actions reachable by scrolling. `ko-320-long.jpg`, `en-320-validation_failed.jpg`                                                                                              |
| Hidden states                      | Unsupported/denied/unknown panel count 0, no placeholder. `hidden.jpg`                                                                                                                                       |
| Check and restore                  | Enter/click → sending/accepted → checking/observed result; restored active pointer and initiating focus return. `en-320-restore-pending-player.jpg`, `restore-complete-player.txt`                           |
| Candidate/failure                  | Pending-source copy, failed candidate keeps active; real check-failure preview retained active and player. `update-failure-player.txt`                                                                       |
| Busy focus                         | Visible action group keeps focus when native buttons disable; return to initiating action without stealing user-moved focus                                                                                  |
| Actual Chrome 200% zoom            | Chrome toolbar reported 200%; 1800-pixel override produced 900 CSS px with no overflow. KO/EN captured; focused group inside viewport. `ko-200zoom.jpg`, `en-200zoom.jpg`                                    |
| Reduced motion                     | DevTools emulation matched `reduce`, computed motion token `0ms`; localized status/progress remained visible. KO/EN 390 screenshots                                                                          |
| Account switch late response       | Delayed mutation 401 followed by sign-out/new synthetic account login; new account and panel remained. `account-switch.txt` plus unit late-success/error fencing                                             |
| Playback and locale                | Repeat-One synthetic audio kept the same track and visible Pause control across KO/EN, check failure, restore and 503/retry. `en-desktop-player.jpg`, `restore-complete-player.txt`, `en-320-503-player.jpg` |
| Console                            | Final captured warning/error log list empty; no runtime UI errors observed                                                                                                                                   |

One MAJOR focus finding was corrected: native disabled buttons lost focus in Chrome. The first
heading fallback could sit outside the viewport, so the final fix focuses the visible action group.
Relevant failure axis: project keyboard/focus contract and **CORE-009**. Browser 320/390/200% and the
focused regression confirmed the correction. No remaining FATAL, MAJOR or MINOR findings; debt 0.
Core, forms and cards rule packs were reviewed; no web platform pack exists in the configured index.

Screenshots taken with `fullPage` include the fixed navigation/player at the original viewport
position. Those are capture artifacts, not permanent content obstruction; scrolled viewport captures
and keyboard interactions verified that the final controls remain reachable.

## Documentation, Rulebook and cleanup

Selected Step, Phase 3 overview, relevant spec/US/media contract and component catalog are synced in
the external Obsidian vault. Phase 3 live import/nightly/iPhone acceptance remains Step 14-owned.
No unverified live acceptance checkbox is marked complete.

Rulebook lookup succeeded with four results, all dropped as unrelated or incompatible with this
specific change. Postflight `yk-rulebook-reconcile`: `skipped(no_new_lesson)`; fixture/type and focus/
poll fixes were bounded, low-cost corrections, with no eligible new high-cost reusable lesson.
Canonical write, index/re-search and Rulebook data repo sync: not applicable. No local lesson file.
`update_plan` is not exposed in this session; this gate table tracks the equivalent checklist.

Final cleanup/result record follows.

## Final gate — 2026-09-07

- Required gates complete: BRANCH_SETUP, PROJECT_DOC_CONTEXT, RED/GREEN, COMPONENT_GALLERY_SYNC
  (consumer index only), STRUCTURAL/full UI_DESIGN_REVIEW, UI_TEST, REFACTOR, LOCALIZATION, DOC_SYNC.
- LESSONS_CONTEXT skipped(no relevant match), LESSONS_LEARNED skipped(no_new_lesson); no central
  writes/sync. PROJECT_SETUP reused existing tools; MANUAL_UI_TEST and baseline approval not required.
- Focused22, full unit562/contract131, typecheck/build passed. Final `npm run format:check` and `git diff --check` passed (exit 0).
- Final 320×844 screenshot `ko-320-final-focus.jpg` and `final-ui.json`: action-group focus rect
  x41–279/y471–571 lies inside the viewport, scrollWidth320, reduced-motion override off; completion
  returned focus to Check now. Console `console.json` contains no captured errors/warnings.
- Cleanup: all session-created preview processes stopped, loopback3000/5173 released, external control
  file deleted, test tab closed, viewport override reset, Chrome zoom100% and DevTools emulation reset.
  User's existing tab and all existing services/data preserved.
- Project commit/push not run. External vault files remain outside the application Git changes.

Browser screenshot bytes were JPEG; file extensions match the returned format. Raster export dimensions can differ from CSS viewport dimensions at browser zoom; the actual 200% setting and 900 CSS-pixel reflow were verified independently.

## S14 owner regression — 2026-09-07

S14-B03: daily coalesced check uses an independent status read without inventing a fresh update or timeout failure. RED1/23→GREEN33, contract6, typecheck/build. Final Chrome verification in S14.

See [S14 evidence](../step-14/README.md) for completed live/device verification and cleanup. No commit/push during TDD.

Repeated already-restored pointer regression: RED1/24→GREEN; check and restore coalescence preserve the observed active pointer without a false30s failure. Final S14 full unit574/contract131, typecheck/build pass. MICRO sanity; no presentation/copy/Gallery changes.
