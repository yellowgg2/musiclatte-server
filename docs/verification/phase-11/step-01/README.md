# Phase 11 Step 01 verification

## Result

- Music folder/search-song, Favorites, and Recent downloads render one inactive `SelectionBar` entry inside `SongViewHeading.actions`, before the shared List/Tiles toggle.
- Artist and album detail routes retain their existing non-selection scope. Favorites play/refresh and Recent refresh/play remain in their original top control panels.
- The active bar is fixed at every breakpoint and consumes AppShell-owned inline, bottom, block-size, and content-clearance variables. Player, mobile navigation, and safe-area presence change those variables without page-local offsets.
- Recent pagination uses the same shell clearance as `scroll-margin-block-end`, so its retained Load more focus remains visible above contextual chrome.
- Selection state, picker focus/Escape return, metadata bulk, partial retry, and Playlist detail behavior are unchanged.

## TDD evidence

RED was observed before production edits:

- `npm run test:unit -- apps/web/test/library-ui.test.tsx apps/web/test/favorites-ui.test.tsx apps/web/test/recent-ui.test.tsx apps/web/test/player-ui.test.tsx`
- 4 intended failures: three entry buttons were outside shared heading tools and the desktop bar was sticky without shell variables.
- A later 320px browser run exposed Load more below the fixed bar; the focused Recent test then failed until the target adopted shell-owned scroll margin.

GREEN:

- focused selection/page/player set: 6 files, 75 tests passed before the pagination regression was added
- Recent pagination regression: 15 tests passed
- contract set: 4 files, 9 tests passed
- typecheck: passed
- production build: passed; the existing non-blocking 500 kB chunk-size warning remained
- format check and `git diff --check`: passed

## Chrome measurements

Deterministic normal routes were exercised with the library, Favorites, and Recent preview harnesses.

| Viewport/state                   | Bar result                                          | Separation/content result                                      |
| -------------------------------- | --------------------------------------------------- | -------------------------------------------------------------- |
| 1440×900, no player              | fixed, left 272, right 1408, bottom 16, height 74.8 | no horizontal overflow; main bottom padding 140                |
| 1440×900, desktop player         | fixed bottom 128                                    | 7px real gap above player; no intersection; selection retained |
| 1024×768, no player              | fixed bottom 16, left 272, right 992                | no horizontal overflow; main bottom padding 176                |
| 1024×768, wrapped desktop player | bar bottom 592, player top 610.2                    | 18.2px real gap; no intersection                               |
| 390×844, no player               | bar bottom 758.4, nav top 764.2                     | 5.8px real gap; no intersection; no overflow                   |
| 390×844, mini player             | bar bottom 686.4, player top 702.4                  | 16px real gap; no intersection; no overflow                    |
| 320×844, mini player             | bar height 218.8, client/scroll content 217         | no internal clipping; 16px player gap; no horizontal overflow  |

At 320×844 the last Music row could scroll 62px above the bar. On Recent, Load more initially reproduced below the bar; after `scroll-margin-block-end` was linked to `--selection-content-clearance`, its bottom was 21.1px above the bar while focus remained on the button. Playlist picker Escape returned focus to Add to playlist and preserved active selection.

Music, Favorites, and Recent each reported one entry, `Select songsListTiles` heading tool order, and zero horizontal overflow. The Recent top controls and Favorites top actions contained no duplicate selection trigger.

## Compatibility and scope

- Applied central rule: `typescript-bound-popup-split-panes-and-own-overflow-at-the-content-region-001`; the existing playlist picker keeps one bounded target scroller while its heading/actions stay fixed.
- Postflight rule reconciliation: skipped (`no_new_lesson`); the discovered fixed-target scroll-margin case was required by this Step's existing acceptance contract and is covered by its regression test/evidence.
- No API, contract schema, database, deployment, native, iOS, bot, or Compose files changed.
- Actual 200% zoom, reduced-motion visual review, and Safari/iPhone checks remain with the deferred Phase 11 UI acceptance IDs; implementation evidence does not mark them passed.
