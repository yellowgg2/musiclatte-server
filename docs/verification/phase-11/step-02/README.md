# Phase 11 Step 02 verification

## Result

- `visibleListeningRows` is the single pure projection for listening cards, bulk playback, queue append, and row activation positions. History keeps the first available song occurrence in loaded newest-first order; top keeps server order, last time, and authoritative count. Both defensively hide missing and duplicate song IDs without changing raw API rows or cursors.
- Recent listening now renders one card per visible song with only the newest loaded time. An older duplicate from a later cursor page does not move the card or replace its time.
- Frequently played uses the same shared song heading, list/tile frame, metadata action, and favorite action while retaining the server count and last-qualified time.
- A raw page containing only missing songs renders one page-level status and retains Load more. It no longer creates per-event disabled rows.
- The period label/select/refresh group is compact, and playback actions remain a separate primary/secondary group. Filter, locale, pagination, and metadata refresh do not own player restart state.

## TDD evidence

RED was observed before production edits:

- `npm run test:unit -- apps/web/test/listening-ui.test.tsx`
- 3 intended failures: the projection helper was absent, repeated history rendered twice, and a missing-only page rendered an unavailable row instead of one page status.

GREEN:

- listening focused regression: 7 tests passed
- metadata/favorite/listening affected set: 3 files, 24 tests passed
- listening contract set: 3 files, 8 tests passed
- typecheck: passed
- production build: passed; the existing non-blocking 500 kB chunk-size warning remained
- format and `git diff --check`: passed

## Chrome evidence

The real Router ran against `tests/support/listening-preview.ts` on owned loopback ports with 54 synthetic events, requested-ID songs, one deterministic missing lookup, and original two-second PCM. No real music, account metadata, or authentication query was recorded.

- History first raw page: 50 events → 47 visible unique cards/times, missing text 0, Load more present, horizontal overflow 0.
- History after the 4-event cursor page: 50 visible cards, the first card retained `2026-09-11T05:08:19.601Z`, missing text 0, Load more absent, horizontal overflow 0.
- Top first page: 49 visible cards plus cursor because the missing grouped item was hidden. After Load more it contained 50 visible cards. The leading synthetic repeat count became 5 after one real qualifying playback, demonstrating the authoritative server count and live listening lifecycle.
- Play now created the persistent player from the visible queue; navigation, tile mode, locale change, and missing-only refresh did not erase it.
- Tile mode used the shared grid and a transparent outer list; individual `MusicRow` card bodies retained their own surface, artwork, details, play, metadata disclosure, and favorite action.
- Actual Chrome 200% zoom produced a 900 CSS-pixel viewport with zero horizontal overflow.
- Responsive device mode at 390×844 produced two 157px tile columns and 44px actions with zero horizontal overflow.
- At 320×844 it produced two 122px tile columns, 44px actions, zero horizontal overflow, and the final card could scroll 158.5px above the mini-player.
- English at 320px retained the page/Songs headings and zero overflow. Missing mode rendered only `No available songs in these loaded records.`, kept Load more, disabled bulk playback, and showed no unavailable event row.
- Browser runtime logs contained Vite debug messages and the React development hint only; application console error count was 0.

## Compatibility and scope

- `tests/support/auth-harness.ts` gained a synthetic requested-song missing-ID control used only by preview fixtures. API schemas, history event identity, signed cursors, repository SQL, and production runtime behavior did not change.
- `P7-UA-002` was marked stale before the new listening presentation was finalized; its prior passed evidence is preserved and revalidation is owned by `P11-UA-003`.
- Postflight Rulebook reconciliation was skipped (`no_new_lesson`); the enforcement-boundary projection rule applied in preflight already covers the card/player/queue consistency risk, and the transient TypeScript narrowing correction did not meet shared capture criteria.
- Shared Gallery primitives were consumed unchanged from S00. No new shared component, global token, database, deployment, native, iOS, bot, or Compose change was made.
- Final visual judgment, reduced-motion, and actual Safari/touch acceptance remain deferred to P11-UA-003/P11-UA-005.

## Acceptance feedback follow-up — 2026-09-12

- User evidence exposed a missed tile alignment defect: a short Korean date kept the count on the same line while longer dates wrapped it, so card bodies started at different vertical positions.
- RED added a feature-local contract requiring separate date/count chip styling plus a shared tile context reserve. The focused listening suite failed on the missing contract, then passed 7/7 after implementation.
- Frequently played now presents time and authoritative count as two non-interactive chips. Tile mode stacks them consistently and reserves a two-line-date plus one-line-count context height; history retains one time chip without the Top-only reserve.
- Chrome fixture geometry measured the first seven tile contexts at 76.6484375px and every card top at 494.546875px, with document `scrollWidth === clientWidth` (1800px). Actual devserver revalidation is recorded in the Phase 11 acceptance artifact.
