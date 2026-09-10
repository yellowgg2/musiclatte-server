# Phase 8 Step 03 verification

## Scope

`RepeatAction` is a player-local composition of the existing 44px `IconAction`. Desktop and
expanded players now consume the same mode, label, inline SVG, and cycle callback. No shared
primitive, global token, Gallery baseline, API, storage, or queue transition changed.

## RED and GREEN

Runtime: Node 24.20.0, npm 11.19.0, React 19.2.8, Vitest 5.0.0, Chrome 152.

- RED unit: the focused synchronization test failed because the old control exposed only
  `Repeat: Off` and a fixed `↻`, with no mode marker.
- RED contract: `tests/contract/player-repeat-ui.test.ts` failed because
  `player.repeat.label` and its `{current}`/`{next}` placeholders were absent.
- Both RED states remained compile-ready: typecheck and build passed.
- GREEN unit: `npm run test:unit -- apps/web/test/player-ui.test.tsx apps/web/test/queue.test.ts`
  passed 20/20.
- GREEN contract: `npm run test:contract -- tests/contract/player-repeat-ui.test.ts` passed 1/1.

## Localization

The resolved product locales are `en` and `ko`, from `apps/web/src/i18n/index.ts` and the two JSON
resources. The repeat namespace has five matching, nonempty keys in each locale. One current/next
template was added and three mode values were clarified. Both templates contain exactly the
`current` and `next` placeholders; JSON parsing and TypeScript resource typing passed.

## Browser functional evidence

The normal Router preview used isolated loopback ports 3118/5188 and synthetic media only.

| Surface/state          | Observed result                                                                                                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop 1440×900 EN    | off marker `off`/pressed false, one marker `1`/pressed true, all marker absent/pressed true; each button 44×44px; title equaled accessible name; horizontal overflow 0                         |
| Expanded 390×844 EN/KO | both desktop and dialog controls reported the same mode after each click; exact current/next labels changed with locale; transport width 342px with all children inside; horizontal overflow 0 |
| Keyboard               | Enter advanced one→all while focus stayed on the button; `:focus-visible` was true with the existing solid 3px outline                                                                         |
| Expanded 320×844 KO    | off and one markers remained visible; target 44×44px; the six controls wrapped to a 96px transport within 12–308px bounds; horizontal overflow 0                                               |
| Chrome 200% zoom       | the 320px fixture remained contained with the repeat control visible, 44 CSS-pixel target, wrapped 96px transport, and horizontal overflow 0                                                   |

No browser console error or warning was observed. Automatic screenshots and DOM measurements do
not replace the pending P8-UA-002/P8-UA-004 final visual and assistive review.

## Rulebook

The previously selected overflow-ownership rule was reused for the 320px and zoom containment
regression. Postflight reconciliation is `skipped(no_new_lesson)` because the Step produced no
distinct broadly reusable lesson.
