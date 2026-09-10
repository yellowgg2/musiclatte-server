# Phase 8 Step 02 verification

## Scope

The queue model now owns the canonical `off → one → all → off` transition. `PlayerProvider`
consumes that pure function while preserving the existing distinction between automatic media
completion and explicit next/previous actions.

## RED and GREEN

Runtime: Node 24.20.0, npm 11.19.0, React 19.2.8, Vitest 5.0.0.

- RED: `npm run test:unit -- apps/web/test/queue.test.ts -t "should cycle repeat off to one to all to off"`
  collected one target test and failed because `nextRepeatMode` was absent. Typecheck and build
  passed after the test fixture type was corrected, so the failure was product-behavior-only.
- GREEN: `npm run test:unit -- apps/web/test/queue.test.ts apps/web/test/player-ui.test.tsx apps/web/test/listening-player.test.tsx`
  passed 22/22.
- Provider lifecycle assertions confirmed that repeat-one reloads and plays the same source from
  time zero after `ended`, explicit next/previous still changes source, repeat-all wraps the final
  item, and repeat-off pauses without a new load or play call.
- Queue assertions confirmed shuffle-order edge wrapping, mode-only state preservation, random
  replacement resetting repeat to off, and append preserving the active repeat mode.
- The existing P7 listening-player test passed, preserving distinct repeat-one playback
  occurrences.

## Compatibility and deferred acceptance

No CSS, icon, localization, API, contract, storage, or deployment surface changed. The UI still
uses the existing repeat glyph until S03. Final icon/state visual review remains pending under
P8-UA-002 and P8-UA-004.

## Rulebook

The selected existing rule
`typescript-reload-failed-html-audio-resources-and-preserve-concrete-media-errors-001` informed the
same-source lifecycle assertions: completion is proven with concrete `load`/`play` calls and not
only with a state label. Postflight reconciliation is `skipped(no_new_lesson)` because no distinct
reusable lesson was produced.
