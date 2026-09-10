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

Postflight reconciliation is `skipped(no_new_lesson)`: the implementation reused the planned
canonical reconstruction and allow-list boundaries without producing a distinct shared lesson.
