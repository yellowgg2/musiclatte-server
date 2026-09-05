# S08 — Library UI verification

2026-09-05. Branch `yellowgg2/tdd/phase-1/step-08-library-ui`; cwd is the musiclatte-server repository. Node **24.20.0**, npm **11.19.0**, session-local toolchain. No dependency, global runtime, commit, push or production deployment changes.

## Result and ownership

Normal login now enters Music when browsing is available. Root libraries, scoped indexes, folders, search and artist/album detail use the authenticated S07 API. URL query/scope/independent offsets survive history/reload, and asynchronous results are guarded by cancellation plus current-generation ownership. Scoped failures keep search and navigation available; 401 returns through normal reauthentication.

`MusicPage.tsx` owns the five route presentations in one orchestrator, rather than adding the five separate page files proposed in the plan. `music/client.ts` validates typed responses; `queries.ts` owns route/opaque-ID/query handling; `navigation.ts` saves scroll positions. `SongActivation` defines the future S10 selection boundary without enabling play/random actions. S07 gonic IDs/order/count/offset, native/bot behavior and the separate SPA base/API origin are preserved. No full-library recency scan, media transport or cover fetching was introduced.

- **Reuse:** approved Action, TextField, StatusSurface and Artwork.
- **Shared-new:** actual MusicRow in folder/search/album and `Gallery#music-row`, with focused tests and synthetic long/missing fixtures.
- **Feature-local:** MusicPage, FolderRow and navigation/layout. Global foundation/primitive contracts remain unchanged; S05 approval remains valid. MusicRow is automated-reviewed, not marked user-approved.
- **Localization:** KO/EN each have 147 matching, nonempty keys, including 44 music keys. Original metadata is never translated.

## Automated evidence

Commands ran from the repo with the pinned toolchain; all final commands exited 0.

| Command                                                                                                                                     | Result                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `npm run test:unit -- apps/web/test/library-ui.test.tsx apps/web/test/login-shell.test.tsx apps/web/test/design-foundation.test.tsx`        | 33 tests / 3 files                               |
| `npm run test:contract -- tests/contract/library-ui.test.ts tests/contract/library-api.test.ts tests/contract/production-exclusion.test.ts` | 17 tests / 3 files                               |
| `npm run test:unit`                                                                                                                         | 170 tests / 13 files                             |
| `npm run test:contract`                                                                                                                     | 88 tests / 9 files                               |
| `npm run typecheck`                                                                                                                         | pass                                             |
| `npm run build`                                                                                                                             | API/contracts/test-support + production web pass |
| `npm run format`, `npm run format:check`                                                                                                    | pass                                             |

RED: after removing collection/type errors, two focused assertions failed for the missing Music entry/search form. Added Gallery, encoded traversal and scroll regressions failed before their fixes. User-requested compact details produced two further intentional failures for repeated title/missing metadata presentation; the final library file has 13 passing tests. One intermediate focused command used an incorrect foundation filename and only selected 27 tests; the corrected explicit command above selected all 33. Zero/missing selection was not accepted as evidence.

## Chrome review and interaction

**CRITICAL / full**, checkpoint S08 covers S08 only; FATAL 0, MAJOR 0, unresolved review debt 0. Connected **Chrome 152.0.7977.82** through CUA browser automation, normal `http://127.0.0.1:5173/login` entry, real local S03/S07 API. Light theme at 1800×863, 390×844, 320×844; native 200% zoom produced a 900px CSS viewport. Screenshots contain synthetic metadata only.

| Check                                         | Evidence                                                                                                                                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Folder desktop/mobile + KO/EN                 | [desktop](folder-en-desktop.jpg), [mobile](folder-ko-mobile.jpg)                                                                                                                                |
| Search, long title, mobile last row           | [search](search-en-mobile.jpg), [320px](search-ko-320.jpg), [last row](last-row-ko-320.jpg)                                                                                                     |
| Artist/album drill-in                         | [artist](artist-ko-mobile.jpg), [album](album-ko-mobile.jpg)                                                                                                                                    |
| Loading/error/retry recovery                  | [loading](loading-en-desktop.jpg), [error](error-en-desktop.jpg), [recovery](recovered-en-desktop.jpg)                                                                                          |
| Empty search/folder and missing ID            | [search](empty-en-desktop.jpg), [folder](empty-folder-en.jpg), [missing](missing-ko-320.jpg)                                                                                                    |
| Late response, history and reload             | [sanitized DOM](race-en-dom.txt); new query remains after old response opportunity                                                                                                              |
| Native keyboard/name-role-state, zoom, motion | [AX/DOM](gallery-row-ko-dom.txt), [200%](zoom-200-ko.jpg), [reduced motion](reduced-motion.json)                                                                                                |
| **Final song detail after user feedback**     | [desktop spacing](music-row-padding-desktop.jpg), [keyboard focus](music-row-focus-desktop.jpg), [KO 320px](music-row-padding-ko-320.jpg), [EN mobile/missing](music-row-padding-en-mobile.jpg) |

Golden path: login → library → folder → song disclosure → artist → album → back → search change → deep-link reload. Also exercised Enter submission, locale changes, no-result query, missing ID, error→loading→retry recovery and delayed old/new responses followed by back/forward/reload. At 320px document width equals scroll width; the last row clears the mobile navigation. Reduced-motion computed transition duration was 0ms and restored to 140ms.

Review corrections: dense full-row disclosures reduced redundant list height; mobile search stacks only when necessary; empty pagination containers were removed. User feedback identified duplicate titles and oversized expanded details, then insufficient separation. Final details show the title once, compact artist/album links, full long-title wrapping and localized missing information. Header-to-link gap is **12px**, bottom padding **16px**, and keyboard summary outline offset **−3px** keeps focus inside the header. Typical expanded desktop height is about **147px**. Earlier route screenshots document flow states before these final local detail refinements; the final-row captures are the current presentation.

## Existing upstream, privacy and cleanup

Checked the existing Linux demo/container and port before opening an owned loopback SSH tunnel. A separate disposable local API connected to it; no remote files, services, volumes or music were modified. Normal browser login exposed one library. Folder drill-in reached a list with 301 folders and returned correct empty states for two selected folders. Actual search returned 20 songs plus 40 artist/album links; searching one displayed title returned exactly one matching song. Its detail exposed two links, artist detail returned two albums and the selected album returned 13 songs. Reload/history were checked. Only these counts/outcomes were retained, without personal metadata or credentials.

Owned preview API, live-test API, Vite, tunnel, control/script and tabs were cleaned up; viewport/zoom/motion overrides reset. See [reproduction scenarios](../../../../tests/browser/library-scenarios.md).

## Gate audit

Branch/doc context, RED/GREEN, refactor, Gallery/catalog sync, full UI review, automated browser flow, localization and document sync completed. Project setup was unnecessary; no USER_ONLY_REQUIRED flow, baseline reapproval or deferred UI review applies. Obsidian Step/overview/spec/user stories/contracts/design system/catalog reflect actual S08 ownership; future audio/media AC remain with S09/S10. Vault files are outside repository commits.

Central Rulebook project search returned no applicable lesson. Postflight `yk-rulebook-reconcile`: `skipped(no_new_lesson)`; no candidate met all three HIGH eligibility thresholds, canonical write and separate data-repo sync are not applicable. No project lesson fallback was created.
