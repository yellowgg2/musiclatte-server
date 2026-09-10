# Phase 8 Step 04 verification

## Scope

Folder-origin searches now carry one canonical, UI-only `returnTo`. The music route helper owns
generation and strict validation; the auth guard delegates nested-origin approval to it. Search
submission, pagination, breadcrumb, and the secondary reset action consume the validated value.
The API, contracts, gonic behavior, selection scope, and shared component APIs did not change.

## RED and GREEN

Runtime: Node 24.20.0, npm 11.19.0, React 19.2.8, Vitest 5.0.0, Chrome 152.

- RED: the focused folder-to-search test failed because the old search URL had no `returnTo` and
  the result view had no searched-folder breadcrumb or reset action. Typecheck and build still
  passed in the RED state.
- GREEN: `npm run test:unit -- apps/web/test/library-ui.test.tsx
apps/web/test/login-shell.test.tsx` passed 41/41.
- The helper boundary covers `/latte/`, opaque Unicode/reserved-character IDs, one scope value,
  duplicate outer/nested values, unknown keys, external/protocol-relative URLs, repeated slash,
  backslash, hash/control characters, dot and repeatedly encoded dot segments, and overlong IDs.
- The UI regression covers folder → search, query replacement, independent artist/album/song
  pagination, exact reset, unsafe scoped fallback, locale change, and a signed-out login
  round-trip with nested `returnTo`.
- Every recorded BFF search spy call excluded `returnTo`.

## Localization

The resolved product locales remain `en` and `ko`. Both resources have matching, nonempty
`music.searchOrigin` and `music.searchReset` keys: `Searched folder`/`검색한 폴더` and
`Reset search`/`검색 초기화`. JSON parsing, TypeScript resource typing, and the focused KO switch
test passed.

## Browser functional evidence

The normal product Router used isolated loopback ports 3118/5188 with the real local API and a
synthetic upstream. `search-pages` supplied deterministic 20-song pages.

| Surface/state      | Observed result                                                                                                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop EN         | Starting at `/music/folders/folder-3?musicFolderId=0` produced one nested folder origin; `Searched folder` linked to the exact scoped source.                                                                                |
| Pagination/requery | `Next songs` changed `songOffset` to 20 without changing the origin; submitting `fresh query` removed the offset, rendered page 0, and preserved the origin.                                                                 |
| Reload/auth/reset  | A direct reload restored the query and searched-folder link. Restarting the isolated API redirected through login with the complete search URL and restored its nested origin. Reset returned to the exact folder and scope. |
| Browser request    | The real BFF request exposed only `albumCount`, `albumOffset`, `artistCount`, `artistOffset`, `musicFolderId`, `q`, `songCount`, and `songOffset`; `returnTo` was absent.                                                    |
| 320px EN/KO        | Field bounds were 16–304px in a 320px document; actions wrapped within bounds, reset stayed 44px high, and document `scrollWidth` equaled 320px. Both localized breadcrumb/action labels were exposed.                       |
| Keyboard           | Tabbing from Search focused Reset; `:focus-visible` was true with a solid 3px outline and 3px offset.                                                                                                                        |

No browser console error was observed. Automatic Chrome interaction and measurements do not
replace pending P8-UA-003 final visual approval or P8-UA-004 actual iPhone Safari review.

## Rulebook

The original Step postflight was `skipped(no_new_lesson)`: the implementation reused the planned
canonical reconstruction and allow-list boundaries without producing a distinct shared lesson.
The deployment follow-up candidate about retaining resolved ancestors had no exact match, but the
central prepare gate classified it as `related`; its outcome is `ambiguous`, with no canonical
write or Rulebook sync.

## Post-deployment music navigation follow-up

The first devserver review exposed two related presentation regressions. Folder traversal fetched
the complete parent chain with one rejecting promise; gonic's virtual-root lookup returns 400, so
the already resolved `jojo-music > … > current folder` ancestors were discarded. Other music
feature pages also owned partial two- or three-item navigation arrays and rendered those arrays
before their page heading, while All music owned the complete capability-derived set below its
heading.

- RED: a focused folder test failed to find the already resolved `Jazz` ancestor after the final
  synthetic root lookup failed. A Recent downloads test received only `All music, Recent downloads`
  instead of the seven available music destinations and found the navigation before the heading.
- GREEN: `loadFolderTrail` now retains every resolved ancestor and stops only the unavailable
  parent lookup; unauthenticated lookup still expires the session. `MusicSectionNav` is the single
  feature-local capability-derived navigation composite consumed by All music, Recent listening,
  Frequently played, Saved mixes, Music curation, Recent downloads and Favorites. Each feature
  heading precedes the tabs; mix detail routes retain a separate breadcrumb.
- Affected unit verification passed 63/63. Typecheck and the production build passed. The complete
  contract suite passed 219/219. The complete unit suite still has 11 pre-existing storage-schema
  expectation failures because those tests expect schema 19/20 while the current migration set
  opens schema 21; none are in the changed web surfaces.
- Normal-Router Chrome verification showed
  `All music > jojo-music > Jazz > Late night`, then clicking `Jazz` rendered the exact ancestor
  route. Recent downloads exposed the ordered seven-item navigation below the focused heading;
  `aria-current=page` was on Recent downloads. At 320×844 the same order remained, document width
  stayed 320px and browser console errors/warnings were empty.
- The devserver web image was rebuilt from the same local source and recreated at
  `http://192.168.129.119:18740`; live, ready and root probes returned 200. gonic remains bound at
  `http://192.168.129.119:4747`, and the existing Docker volumes were retained.
- The private devserver import policy now uses `relativeRoot: jojo-music`. The disposable test
  import ledger was cleared and the old `imports` directory was moved out of the music root to the
  recoverable deployment work area. A secret-free deployment template and contract test now keep
  `jojo-music` as the default for future private policies.
- A second presentation follow-up standardized every music feature page heading at `2rem`, matching
  Recent downloads. The root page now uses `All music`/`모든 음악` as both its document heading and
  title and shows the existing localized browsing description directly below it.
- A third presentation follow-up aligned the outer content inset on All music, Recent downloads and
  Favorites with Recent listening and Saved mixes: `--space-5` at desktop widths and `--space-4`
  through 30rem. A focused style-contract test covers all five page modules so the two groups cannot
  drift apart again.
