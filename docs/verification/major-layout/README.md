# Music page MAJOR layout fixes

2026-09-08. User-approved scope: fixed desktop sidebar, compact music heading/navigation,
smaller content gutters, inline single-library entry, and wider player seek with visible times.
Implementation complete; final visual/VoiceOver acceptance remains pending in Obsidian
`specific-plan/phase-1/ui-acceptance.md` (P1-UA-001–003).

## Behavior

- AppShell keeps a 15rem viewport-fixed sidebar, with overflow only when its own content exceeds
  the viewport. Main content retains window scrolling and existing history restoration. Mobile
  bottom navigation remains unchanged. Desktop content starts 32px after the sidebar.
- MusicPage removes the centered 68rem limit, uses a 2rem heading, groups navigation and random
  playback horizontally, and places language/history utilities beside the heading. Redundant
  introductory copy and root breadcrumb are removed; detail breadcrumbs remain available.
- A sole library is read inline without a redirect or history entry. Its scope survives folder
  links and search. Empty/multiple libraries, explicit scopes, reload/back and retry remain valid.
- DesktopPlayer groups transport above a flexible seek bar and reveals elapsed/total time.
  Options move to another row at intermediate desktop widths with matching content and selection-bar clearance.
  Seeking updates the controlled slider/time immediately before asynchronous media events.
- The synthetic browser preview now serves byte ranges to support meaningful native seek testing.
  No real music or private metadata was used.

## Validation

Repository cwd: `/Users/incredibleyoung/Documents/code/musiclatte-server`.
Node v24.20.0 / npm 11.19.0 from the session-local pinned toolchain.

| Command                                                                                                                                                                                     | Result               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `npm run test:unit -- apps/web/test/library-ui.test.tsx apps/web/test/player-ui.test.tsx apps/web/test/login-shell.test.tsx apps/web/test/player-state.test.ts apps/web/test/queue.test.ts` | 52 passed            |
| `npm run test:unit -- apps/web/test`                                                                                                                                                        | 184 passed, 23 files |
| `npm run test:contract -- tests/contract/library-ui.test.ts tests/contract/login-shell.test.ts tests/contract/production-exclusion.test.ts`                                                 | 13 passed            |
| `npm run typecheck`                                                                                                                                                                         | passed               |
| `npm run build`                                                                                                                                                                             | passed               |
| `npm run format`, `npm run format:check`                                                                                                                                                    | passed               |

RED: sole-library content was absent without clicking the intermediate library; paused seek
changed the audio time but left the controlled slider at 0 instead of 42. Both regressions pass
with the implementation. Existing metadata-login navigation test now uses two libraries so it
continues to verify the explicit library-selection interaction. jsdom emits its existing native
media/window-scroll not-implemented notices; native behavior was also exercised in Chrome.
Full API unit/contract suites were not rerun; no API or native client implementation changed.

## Connected Chrome runtime

Used CUA / connected Chrome with the existing synthetic `tests/support/library-preview.ts`
(upstream → real API → ordinary Vite app entry), not a screenshot-only mock.

- Sign in → `/music` shows `Daylight folder` directly, retaining `/music`.
- Folder entry preserves `musicFolderId=0`; browser Back returns to the root.
- At 1800×952, body scrollY=151 leaves sidebar top=0; sidebar width=240. Music content left=272;
  seek input width≈668px. Elapsed/total spans have normal layout, while only the seek label is hidden.
- Random playback → pause → keyboard seek: slider 0→1 and text 0:01 / 0:02. KO→EN retains the
  same song and position. The original synthetic audio is two seconds long.
- 1000×800: player options wrap to the lower row; sidebar remains fixed.
- 390×844: mobile navigation and mini-player present; open expanded player → keyboard seek
  updates time to 0:01 / 0:02 → close restores mini-player.
- 390px and 320px: document scrollWidth matches viewport width, with no horizontal overflow.
- Browser viewport override reset, test tab closed, and session-created API/Vite processes stopped.

[Desktop](desktop.png) · [Mobile](mobile.png)

## Completion boundaries

Existing Action/TextField/LanguagePicker/IconAction/Artwork/MusicRow reused; shared-new=0 and
no global token/primitive changes. S05 approved Gallery baseline remains intact. Feature-local
consumer presentation requires final acceptance; no new user approval is claimed.
KO/EN resources remain unchanged; matching/nonempty key verification passed.
Ad-hoc feedback task: no branch creation, commit, push or deployment. Existing untracked
`docs/verification/phase-5/` preserved. Obsidian files remain outside repository Git scope.

Rulebook lookup returned no directly applicable rule for this change: popup overflow, deployment
runtime alignment and media-error retry rules were not applied. Postflight:
`skipped(no_new_lesson)`; no canonical write or data-repository sync.
