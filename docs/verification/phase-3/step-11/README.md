# Phase 3 Step 11 — Recent downloads UI

Completed 2026-09-07 on `yellowgg2/tdd/phase-3/step-11-recent-ui`. No project commit/push.

## Implementation and compatibility

- `recent/routes.ts`, `auth/guards.ts`, Router and MusicPage: canonical base-aware `/music/recent`; query-free safe returnTo; only supported/allowed/available producers expose the Music entry. Capability loading is distinct from unsupported. Temporary unavailability retains the mounted snapshot/selection; denied/unsupported routes provide recovery.
- `recent/client.ts`: strict public DTO keys, states, UTC instants, ready song schema, cursors and pagination limit. API origin stays independent of SPA base; cookie/no-store/redirect-error/15-second abortable requests. 401 expires the session; 403 and 503 produce scoped recovery.
- `recent/model.ts`: local calendar midnight to inclusive-from/exclusive-to UTC conversion, including DST; event-ID append deduplication without sorting; mismatched snapshot/filter pages are rejected. Default 7×24-hour calculation remains server-owned.
- RecentDownloadsPage: server filter/asOf display, custom dates, loaded-ready selection, page append, manual refresh and visible-page 30-second/focus new-event probe. New items do not mutate the active snapshot until refreshed. Refresh preserves selected song IDs and rebases their positions; off-page selections retain identity/order. Successful explicit period/account replacement clears selection. Late responses are fenced by abort and mount lifetime.
- P2 SelectionProvider/SelectionBar/playlist picker and byte-bounded append continuation are reused. Ready items alone have song/checkbox/play payloads; registering/missing events have state explanation and recovery. P1 player/queue uses `recent:{asOf}` and loaded API order. Music/playlist/favorites behavior remains intact.
- Browser playback exposed Fastify's default 100-character path parameter limit below the existing 2,048-character opaque-ID contract. `apps/api/src/app.ts` now sets the router limit to 2,048; the existing strict route schemas and authentication still apply. A real media-proxy regression proves a 487-character recent song ID streams unchanged. No gonic, iOS, bot, real media, service or volume was modified.
- Reuse: Action, Artwork, TextField, StatusSurface, MusicRow, SelectionBar/picker and player. Feature-local: period form, recent history states, dates and list presentation. Shared-new 0; Gallery fixture/token/global primitive changes 0; baseline remains approved/user-approved.

## TDD and gates

Cwd is the repository root. Session-local **Node 24.20.0 / npm 11.19.0** match AGENTS, `.nvmrc`, `.node-version`, manifest and lockfile. Dependencies unchanged.

| Check                  | Evidence                                                                                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RED                    | Initial recent unit: 8 failing assertions / 3 passing; consumer contract: 4 failing / 1 passing. Test fixture type issues were fixed separately.                                                      |
| Additional RED → GREEN | Capability outage selection, final-page focus, refreshed selection order, direct-load/new-notice heading focus, empty-date accessible error and long-ID media routing each failed before their fixes. |
| Focused unit           | 53 passed across recent UI/model, selection model, playlist add, player and media proxy.                                                                                                              |
| Final full unit        | `npm run test:unit -- --maxWorkers=2`: **540 passed**, 41 files, exit 0.                                                                                                                              |
| Full contract          | `npm run test:contract`: **127 passed**, 19 files, exit 0. Includes real recent producer/consumer, playlist and production exclusions.                                                                |
| Typecheck / build      | `npm run typecheck`, `npm run build`: all workspaces passed, exit 0.                                                                                                                                  |
| Locale                 | KO/EN: 34 new recent keys, 372 total each; missing, empty and placeholder mismatches 0. Dates/counts use Intl; music metadata stays untranslated.                                                     |
| Format / whitespace    | `npm run format`, `npm run format:check`, `git diff --check`: pass.                                                                                                                                   |

Default-parallel broader runs intermittently failed existing short-deadline gonic registration/favorites timeout tests under load. Gonic's focused 23 tests passed; the identical complete suite with two workers passed without changing those tests or production timing. Existing JSDOM suites retain unimplemented media/scroll notices. Browser failures intentionally induced by the fixture are not counted as application regressions.

```sh
npm run test:unit -- apps/web/test/recent-ui.test.tsx apps/web/test/recent-selection.test.ts apps/web/test/selection-model.test.ts apps/web/test/playlist-add-ui.test.tsx apps/web/test/player-ui.test.tsx apps/api/test/media-proxy.test.ts
npm run test:contract -- tests/contract/recent-ui.test.ts tests/contract/recent-downloads-api.test.ts tests/contract/playlist-ui.test.ts tests/contract/production-exclusion.test.ts
```

BRANCH_SETUP, PROJECT_DOC_CONTEXT, RED, GREEN, UI_DESIGN_REVIEW, UI_TEST, LOCALIZATION, DOC_SYNC and GATE_CHECK complete. REFACTOR complete for response fencing, selection position rebase and stable final-page focus. `update_plan` is unavailable; this ledger tracks the gates. No user-only scenario or approval remains.

LESSONS_CONTEXT: one project search succeeded; four results dropped as unrelated to this change's safeguards (identity-light bulk pairing, runtime-image alignment, HTML audio resource retry, split-pane overflow). `yk-rulebook-reconcile` postflight: **skipped(no_new_lesson)**; fixes were localized and did not meet high debugging/token-cost capture eligibility. Canonical write/reindex/Rulebook data repo sync: not applicable. No project lesson file was read or written.

## Chrome full review and functional evidence

Connected **Chrome 152**, extension via `cua_repl`; normal login → Music → Recent downloads. Synthetic API in `tests/support/recent-preview.ts`, real P2 BFF writes/receipts and P1 synthetic media transport. No standalone browser or product-only test route. The local control file is excluded from production.

**STRUCTURAL/full; checkpoint and coverage: Step 11.** Light theme; KO/EN; 1800×863, 390×844, 320×844; actual Chrome **200%** zoom (900×431 CSS viewport); reduced-motion query true and motion token 0ms. Core, lists, forms and navigation packs reviewed; no web platform pack exists.

| Flow / state                             | Observed result                                                                                                                                                                                  | Evidence                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Music entry / default                    | Capability-gated link, exact server seven-day window, heading focus; compact list hierarchy                                                                                                      | `ko-desktop-music-entry.png`, `ko-desktop.png`, `ko-320-default.png`                      |
| Multiple pages / unavailable events      | 41 events, 39 ready checkboxes; registering/missing have no activation; final button remains focused and above selection bar/nav                                                                 | `ko-320-last-page.png`                                                                    |
| New item                                 | Visible-page probe announces arrival; refreshed first page keeps original checked song ID and leaves the new song unchecked                                                                      | `new-event-selection.txt`                                                                 |
| Playlist partial retry                   | 39 selected → 16 applied, 16 failed, 7 unattempted; 23 remain; recovery adds only the remaining 23; playlist 3 → 42                                                                              | `en-390-playlist-partial.png`, `playlist-retry-result.txt`                                |
| Unknown write boundary                   | Existing P2 receipt fence is preserved; partial retry fixture fails before second BFF write, without pretending an uncertain write is safely repeatable                                          | Existing playlist contract/unit tests                                                     |
| Player                                   | Real audio progresses through long-ID queue entries without error; pause, selection, locale, period and 503 keep the current song                                                                | `error-player-selection.txt`, `en-390-error-player.png`, media-proxy regression           |
| Calendar input                           | Native segmented year/month/day keyboard input; reversed date focuses Through; empty start has linked invalid state; valid local day displays midnight → following midnight and resets selection | `en-320-date-error.png`, `empty-date-accessibility.json`, `en-320-custom-player.png`      |
| Loading / empty                          | Correct domain copy and recovery; existing player persists                                                                                                                                       | `en-390-loading.png`, `en-390-empty.png`                                                  |
| 403 / denied / unsupported / unavailable | Safe Music/settings links; entry absent when denied; unavailable retry restores the page                                                                                                         | `en-390-api-denied.png`, `en-390-denied.png`, `unsupported.txt`, `en-390-unavailable.png` |
| 401                                      | Login with `/login?returnTo=%2Fmusic%2Frecent`; normal login restores recent                                                                                                                     | `expired-session.txt`                                                                     |
| Reflow / motion                          | 320px scrollWidth equals viewport; 200% keeps controls accessible; reduced motion resolves to 0ms                                                                                                | `en-desktop-200-percent.png`, `reduced-motion.json`                                       |
| Identity / API trace                     | Account response fencing and snapshot cursor tests; recent client performs only recent reads, no full library/folder/tag scan                                                                    | Recent UI/model and actual producer-consumer tests                                        |

Corrected findings: **CORE-009 / LIST-005** (mobile final action hidden by fixed selection bar), **CORE-008** (date/metadata width at 320px), **FORM-002** (empty-start error association), and project keyboard focus contracts (direct reload / last page / selection entry). Feature-local padding and scroll-padding make the final target reachable; explicit post-append scrolling keeps its retained focus visible. Screen/DOM rechecks and regressions verify fixes. **FATAL 0, MAJOR 0, MINOR 0, review debt 0**. Gallery reapproval: not applicable.

## Documentation and cleanup

Obsidian Step 11, Phase 3 overview and component catalog synchronized separately from this repository. The Step 14 real worker/import/iPhone responsibility remains unchanged. Preview API/Vite processes and task tab are stopped/closed; viewport, zoom and reduced-motion overrides restored; temporary control removed. No existing user tab/process/data was cleaned up.

## Optional metadata decoder regression — 2026-09-11

- A real devserver import completed as `ready`, but `/music/recent` showed the generic refresh
  failure even though the API response was HTTP 200. The downloaded file carried a valid `genre`
  tag; the shared server `MusicEntry` schema and Subsonic decoder permit and preserve it, while the
  recent web client's strict optional-key allowlist omitted only `genre`.
- RED added a producer-consumer contract covering every optional public song field. The focused
  contract failed 1/4 with `decodeRecent` `internal_error`. GREEN adds `genre` to the string-field
  allowlist; the same contract passes 4/4.
- The existing devserver web image was rebuilt without replacing API, worker, gonic, or their
  volumes. Connected Chrome loaded both actual recent downloads, refresh retained the list with no
  alert, and the newly imported song started playback. Playback was paused and the task tab closed;
  the user-requested downloaded music remains in the library.
- Final verification under Node 24.20.0/npm 11.19.0 passed affected unit 17/17, contract 6/6,
  typecheck, production build, format check, and diff check. The production bundle is
  `index-BZyC51Gv.js`.
- No rendered structure, shared component, Gallery state, locale resource, API, schema, or server
  behavior changed. Existing Phase 3 UI acceptance remains valid; no new user-only check is needed.
- Rulebook postflight classified the verified strict-decoder/schema-drift lesson as `related`, so
  the outcome is `ambiguous`; no canonical write or Rulebook data-repository sync occurred.
