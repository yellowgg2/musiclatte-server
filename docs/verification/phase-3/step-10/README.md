# Phase 3 Step 10 — Imports UI

Completed 2026-09-07. Branch `yellowgg2/tdd/phase-3/step-10-imports-ui`. No project commit/push.

## Implementation

- `imports/routes.ts`, `auth/guards.ts`, Router/AppShell: strict base-aware route and supported/allowed/available intersection. Denied/unavailable direct routes offer scoped recovery. Only the imports consumer is newly enabled.
- `imports/client.ts`: strict DTO keys/IDs/stages/failures and ready media links; separate API origin, cookie/CSRF, body-only source input, 15-second timeout and caller abort. DELETE has no body/query. Existing server account/forged-request checks pass.
- `imports/state.ts`: account/session/instance/route lifetime; 2-second active polling including registering; blur/hidden/offline pause; late-response fencing; retained success data; bounded three-failure retry (4/8-second backoff) then manual recovery. Older loaded active jobs use detail reads; pagination and original retry parents remain available.
- Mutations retain exact operation bodies for uncertain-response replay. Failed-item retry creates a child; success remains visible. Cancellation accepted differs from cancelled. Player/provider ownership stays above the router.
- ImportPage/ImportJobItem/ObservedStage are feature-local. Reuse Action, StatusSurface, existing TextField CSS and approved shell/focus/motion tokens. Shared-new 0, Gallery changes 0, baseline approval unchanged.

## TDD and verification

Cwd: repository root. Session-local Node **24.20.0**, npm **11.19.0** agree with manifest/version files. No dependencies changed.

| Check                                     | Result                                                                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Initial RED                               | Consumer/decoder contract 3 assertions failed; UI expectations failed before implementation. Fixture schema/type issues were corrected.  |
| Regression RED                            | Wrong document title, completion focus loss, capability recovery focus and missing off-page retry parent each failed before their fixes. |
| Focused unit                              | 48 passed across imports UI/state, login-shell, player-ui and real import API tests before the additional player regression.             |
| Final `npm run test:unit`                 | **523 passed**, 39 files, exit 0.                                                                                                        |
| `npm run test:contract`                   | **124 passed**, 18 files, exit 0.                                                                                                        |
| `npm run typecheck` / `npm run build`     | Both pass, all workspaces, exit 0.                                                                                                       |
| `npm run format` / `npm run format:check` | Applied / pass.                                                                                                                          |
| `git diff --check`                        | Pass.                                                                                                                                    |
| KO/EN                                     | 67 new imports keys, 338 total per locale; missing/empty/placeholder mismatch 0.                                                         |

```sh
npm run test:unit -- apps/web/test/import-ui.test.tsx apps/web/test/import-state.test.ts apps/web/test/login-shell.test.tsx apps/web/test/player-ui.test.tsx apps/api/test/import-api.test.ts
npm run test:contract -- tests/contract/import-ui.test.ts tests/contract/import-api.test.ts tests/contract/login-shell.test.ts tests/contract/production-exclusion.test.ts
```

Production contracts exclude preview sentinel/control source. Existing JSDOM suites retain their unimplemented media/scroll notices; Chrome application warning/error entries are 0.

## Chrome full review

Connected Chrome 152 extension through `cua_repl`; normal login → `/imports`, synthetic local API and music BFF. Light theme; dimensions below are CSS pixels. No standalone browser, real metadata, credential or downloader.

| Coverage                        | Observed result                                                           | Evidence                                            |
| ------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------- |
| KO 1800×863 empty/form          | Rights/field/destination/submit hierarchy and sidebar                     | `ko-desktop-empty.png`                              |
| EN desktop loading              | Import-specific copy, submit disabled until destination loads             | `en-desktop-loading.png`                            |
| Multiple links                  | Accepted/queued distinct from ready; result heading focus                 | `en-desktop-queued.png`                             |
| Partial → child retry → cancel  | Original success retained; original anchor; requested before cancelled    | `en-mobile-cancellation.png`, `ko-320-history.png`  |
| 390px registering               | Icon/label and saved-but-not-ready explanation; Escape restores trigger   | `en-mobile-registering.png`                         |
| KO/EN long title/channel, 320px | Wraps fully; scrollWidth 320; last retry accessible                       | `ko-320-long-copy.png`                              |
| Player + 320px navigation       | Current song retained; last action reachable above fixed controls         | `en-320-player.png`                                 |
| Short 320×480 viewport          | Focused input, inline error and submit accessible above player/nav        | `en-320-short-viewport-input-error.png`             |
| Denied/unavailable, 390px       | Hidden nav; scoped recovery and heading focus                             | `en-mobile-denied.png`, `en-mobile-unavailable.png` |
| Actual Chrome zoom 200%         | Popup confirmed 200%; 900×431 CSS viewport, scrollWidth 900               | `en-desktop-200-percent.png`                        |
| Reduced motion                  | Media query true; token 0ms; Ready/Failed text retained                   | `reduced-motion-dom.json`                           |
| Reload/completion               | Same job ID survives reload; history transition preserves focused heading | Chrome DOM + regression tests                       |
| Accessibility/runtime           | Named controls, linked errors, keyboard submit/Escape, locale, console 0  | `accessible-state.txt`, `console.json`              |

Short viewport emulates available layout space, not a physical mobile keyboard. All Step 10 flows are browser-automatable; real worker restarts/downloads and iPhone remain Step 14.

**CRITICAL/full**, checkpoint/covers **Step 10**. Core/forms/lists/navigation packs reviewed; no web platform pack exists. Automatically fixed findings: browser title (NAV-002), completion/recovery focus (project accessibility contract), session-specific loading copy (CORE-006). Screenshots, DOM and regressions verify fixes. **FATAL 0, MAJOR 0, MINOR 0, debt 0**.

## Gates and cleanup

BRANCH_SETUP, PROJECT_DOC_CONTEXT, RED, GREEN, UI_DESIGN_REVIEW, UI_TEST, LOCALIZATION, DOC_SYNC and GATE_CHECK complete. Component index synchronized without Gallery changes. REFACTOR completed for stable keyed rendering/history preservation. No user-only test/approval remains. `update_plan` is unavailable; this ledger records gates.

LESSONS_CONTEXT: one Rulebook project search succeeded; three results dropped as not directly applicable (runtime-image alignment, HTML audio retry, identity-light bulk pairing). `yk-rulebook-reconcile` postflight: `skipped(no_new_lesson)`; small verified fixes did not meet debugging/token cost eligibility. Canonical write/reindex/Rulebook sync not applicable.

Obsidian Step/overview/catalog synchronized separately. Existing gonic/bot/iOS, real media, services and volumes untouched. Preview API/Vite processes stopped, task Chrome tab closed, viewport/zoom/motion restored and temporary control removed. Only review evidence remains.

## S14 owner regression — 2026-09-07

S14-B02: bodyless browser cancellation now sends required JSON Content-Type. Production client→API RED1/12→GREEN27, contract6, typecheck/build. Actual queued cancel: cancelled, attempt0; reload confirmed.

See [S14 evidence](../step-14/README.md) for completed live/device verification and cleanup. No commit/push during TDD.
