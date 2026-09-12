# Phase 11 Step 03 verification

Date: 2026-09-12

## Outcome

- Recent downloads uses a content-width inline period selector. In custom mode the period selector, two capped date fields, Apply, localized range, Refresh, and Play align on one desktop row and reflow without horizontal scrolling at 390/320 CSS px.
- The visible range is `{from} – {to}`. A visually hidden description preserves the exclusive `to` boundary; the redundant visible `asOf` line is gone while `data.asOf` remains in the queue source, snapshot cursor, and new-item flow.
- Ready download time is `MusicRow.context` outside the card. Available row actions are Play → Music information → Favorite. Registering/missing events and their recovery action remain unchanged.
- The shared tile breakpoint changes to one column at 352 CSS px and below. This preserves all three 44px action targets instead of allowing them to collide inside 122px two-column cards.

## RED → GREEN

- RED `apps/web/test/recent-ui.test.tsx`: the compact period marker was absent before production edits; the same contract also requires the short range/help, outside-card time, action order, retained source `asOf`, and no visible snapshot copy.
- RED `apps/web/test/design-foundation.test.tsx`: the shared list had no narrow breakpoint capable of fitting three 44px actions.
- GREEN: focused Recent 16/16 and the final affected unit group 66/66.

## Automated verification

```text
npm run test:unit -- apps/web/test/recent-ui.test.tsx apps/web/test/favorites-ui.test.tsx apps/web/test/library-ui.test.tsx apps/web/test/listening-ui.test.tsx apps/web/test/design-foundation.test.tsx
  5 files, 66 tests passed

npm run test:contract -- tests/contract/recent-ui.test.ts tests/contract/recent-downloads-api.test.ts tests/contract/favorites-ui.test.ts tests/contract/library-ui.test.ts tests/contract/listening-ui.test.ts
  5 files, 12 tests passed

npm run typecheck
npm run build
npm run format:check
git diff --check
  passed
```

The Vite build emitted only its existing chunk-size advisory. jsdom emitted its known unimplemented media-method notices; the test command exited successfully.

## Actual Chrome evidence

Normal production Router and synthetic preview data were used on owned loopback ports.

- KO 1800×952 default: document overflow `0`; the compact select was 138×44. Control/select, range, and actions shared a 44px aligned row.
- KO 1800×952 custom after user screenshot feedback: the two date fields were capped at 216px. Period/select, date inputs, Apply, range, Refresh, and Play all ended at `y=331`; document overflow `0`.
- KO 390×844: default panel 326px wide, select 138×44, wrapped range/action rows, document overflow `0`; custom fields stacked as 292px-wide controls with no clipping.
- KO 320×844: default panel 256px wide and document overflow `0`; custom period/date/apply/range/actions stacked without clipping. Shared tiles switched from colliding 122px two-column cards to one 256px column, and visual inspection confirmed three separated 44px actions.
- EN desktop custom: localized range `Sep 5, 2026, 1:49 PM – Sep 12, 2026, 1:49 PM`, no visible `As of`, document overflow `0`.
- Pagination: 39 ready songs plus one registering and one missing event loaded across all cursor pages; final Load more remained mounted and disabled.
- New snapshot: window refocus showed the new-download banner without replacing 39 loaded rows; applying it focused the page heading and showed the synthetic new song while the visible snapshot line remained absent.
- Cross-consumer session: All Music, Recent listening, Frequently played, Recent downloads, and Favorites retained the shared heading/tile language. Tile containers were transparent, cards were white surfaces, action targets were 44×44, and document overflow was `0`. Recent listening loaded 47 unique visible rows; Frequently played loaded 49; Favorites kept `Select songs → List/Tiles` and authoritative order.
- Browser logs contained Vite debug and the React development hint only; application errors were `0`.

Actual 200% zoom, reduced-motion visual judgment, and real iPhone Safari remain in `P11-UA-001`, `P11-UA-004`, and `P11-UA-005`; implementation completion does not mark those acceptance items passed.

## Compatibility audit

- Recent API shape, routes, cursor encoding, `data.asOf`, selection reducer, player queue model, FavoritesProvider state, DB/schema, native/iOS, bot, Compose, and deployment files were not changed.
- Period requests still own scope reset; refresh, metadata refresh, pagination, and new-item refresh rebase or retain selection as before.
- KO/EN resource keys are matching and nonempty.

## Cleanup

Owned Chrome tab, preview/Vite processes, ports, and `/tmp/musiclatte-phase11-s03-*-control` files are removed after Git verification.
