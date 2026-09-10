# Phase 8 Step 01 verification

## Scope

The mobile expanded player now has a fixed header and one shrink-safe scroll body containing the
artwork, metadata, seek and transport controls, optional quality feedback, and the full queue.
The queue list's independent scroller is disabled only inside the mobile sheet. Desktop queue
markup and scrolling remain unchanged.

- Component classification: feature-local `ExpandedPlayer`/player CSS; existing `IconAction`,
  `Artwork`, `FavoriteAction`, `QualityFeedback`, and `QueueView` are reused.
- Gallery/catalog: no shared symbol, token, API, state, or Gallery baseline change.
- Compatibility: SPA/API origins, desktop persistent player, focus trap, and media behavior are
  preserved.

## RED and GREEN

Runtime: Node 24.20.0, npm 11.19.0, React 19.2.8, Vitest 5.0.0, Chrome 152.

- RED: `npm run test:unit -- apps/web/test/player-ui.test.tsx -t "should contain a long queue in the expanded player scroll body"` collected one target test and failed because
  `expanded-player-scroll-body` did not exist. Typecheck and build passed, excluding a collection
  or compile failure.
- GREEN: the same target test passed (1 passed, 10 skipped). The Step focused run
  `npm run test:unit -- apps/web/test/player-ui.test.tsx apps/web/test/stream-quality-player.test.tsx`
  passed 17/17.
- `npm run typecheck` and `npm run build` passed. Vite reported only its existing bundle-size
  advisory.

## Browser functional evidence

The connected Chrome session used the normal product Router through
`tests/support/library-preview.ts` on isolated loopback ports 3118/5188. The fixture supplied 25
synthetic songs, long KO/EN titles, visible/hidden quality feedback, and exact 390×844, 320×844,
and 1440×900 iframe viewports.

| State                    | Observed result                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 390×844, quality hidden  | dialog bottom 844; body 676px client / 2780px scroll; `overflow-y:auto`; queue `overflow-y:visible`; document/body horizontal overflow 0                |
| 390×844, scrolled end    | final row bottom 816.12 within body bottom 820; keyboard Enter set `aria-current=true`                                                                  |
| 390×844, quality visible | feedback present; dialog bottom 844; final row bottom 816.12 within body bottom 820; horizontal overflow 0                                              |
| 320×844, quality hidden  | dialog bottom 844; body 676px client / 2795px scroll; final row bottom 816.22 within body bottom 820; horizontal overflow 0; keyboard activation passed |
| Keyboard/modal           | last row → Tab focused Close; Shift+Tab returned to the last row; Escape removed the dialog and restored the opener                                     |
| Desktop 1440×900         | queue popover remained bounded above the player; named list retained `overflow-y:auto`, 468px client / 2352px scroll, keyboard End reached the last row |

No browser console failure was observed during the measured flow. The session-created tab,
loopback servers, and control file are cleanup-owned by this run.

## Post-deployment desktop queue follow-up

A later devserver screenshot identified that the remaining overflow was the desktop queue popover,
not the mobile expanded player. The popover capped its border box at `min(60vh, 32rem)`, while the
child queue inherited that full limit inside the popover padding and could therefore spill by the
padding budget. The popover now clips its own border box and the child queue subtracts both padding
edges and borders from its scroll-height budget. `QueueView` also identifies the current occurrence
by queue position and centers that row once whenever either queue surface mounts.

- RED: the desktop CSS contract failed because the popover did not own clipping and had no
  padding-adjusted child height budget.
- GREEN: the desktop containment and mount-centering tests passed alongside the mobile definite
  height regression.
- Chrome 1440×900 with a 25-song queue showed song 10 centered on open, one exact
  `aria-current=true` row, a visible inner scrollbar, and song 20 wholly inside the popover above
  the persistent player after scrolling to the end.

## Deferred acceptance

Implementation evidence satisfies the automatic dependency for P8-UA-001 and the S01 portion of
P8-UA-004. Final visual/200% zoom/reduced-motion matrix and actual iPhone Safari touch feel remain
pending in the Phase 8 `ui-acceptance.md`; this implementation result is not recorded as final UI
approval.

## Rulebook

| Source           | Rule                                                                            | Applied safeguard                                                            | Verification                                                            |
| ---------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Central Rulebook | `typescript-bound-popup-split-panes-and-own-overflow-at-the-content-region-001` | `UI_PRECHECK`: the sheet uses a shrink-safe body as the sole mobile scroller | 320/390 runtime bounds, keyboard End/Enter, desktop scroller regression |

Postflight reconciliation: `skipped(no_new_lesson)`. The verified change applies the selected
existing overflow-ownership rule and did not produce a distinct reusable lesson.
