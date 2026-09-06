# Phase 2 Step 10 verification

Date: 2026-09-06

Branch: `yellowgg2/tdd/phase-2/step-10-optimistic-ui`

## Scope

- Added the signed-in, account-scoped favorites client/store/provider and the guarded
  `/music/favorites` route.
- Reused the approved `IconAction`, `Action`, `StatusSurface`, `Artwork`, and `MusicRow`
  components for folder, search, album, playlist, favorites, and current-player actions.
- Kept the authoritative favorite order from the BFF while overlaying only a pending song intent.
  Each song allows one write at a time; non-auth failures roll back with an inline retry, 401 expires
  the session, and lifecycle generations discard late account/capability/logout work.
- Reused the existing PlayerProvider and SelectionProvider. Favorite changes do not recreate audio,
  queues, locale state, or a second player store.

## RED and GREEN

- RED: `favorites-state.test.ts` and `favorites-ui.test.tsx` produced 7 intended failures for the
  missing store, actions, provider, route, and player sharing. `favorites-ui.test.ts` produced one
  intended producer-consumer failure while `favorites.songs` was disabled. Typecheck and the
  pre-existing build still passed.
- Focused GREEN: 4 unit files / 19 tests and 4 contract files / 9 tests passed. These cover
  optimistic pending and duplicate blocking, rollback/retry, authoritative order, account
  generation discard, focus refresh, player persistence, playlist selection, API compatibility,
  and production exclusion.
- Full GREEN: 28 unit files / 283 tests and 14 contract files / 110 tests passed.
- `npm run typecheck` and `npm run build` passed; the web production build transformed 95 modules.
  The expected jsdom `scrollTo`/media not-implemented diagnostics remained non-failing.

## Connected Chrome review

The deterministic preview used the real signed-in routes and favorite BFF with synthetic media
metadata only. No credentials, authentication query, or user media entered this evidence.

- Desktop EN/KO: confirmed the direct capability-gated route, `[B, A]` authoritative order,
  play-all, row/current-player shared pressed state, and persistent desktop player.
- State coverage: confirmed optimistic rollback, code-specific localized error, retry success,
  empty state, read-error recovery, and refresh loading that keeps the current list visible.
- Selection: confirmed favorites selection, native checkbox keyboard toggling, and the existing
  editable-playlist picker.
- Reflow: confirmed 390×844 and 320×844 layouts, KO/EN long copy, 200% browser zoom, 44px action
  targets, fixed player/navigation separation, and bounded error/retry panels without horizontal
  loss. This feature adds no animation; the existing reduced-motion player rule remains intact.
- External refresh: the store/provider focus listener is covered by the real Router unit test;
  connected Chrome confirmed the same native-state result through explicit refresh while retaining
  the old list during an in-flight read.
- Browser console collection was empty after the final flows.

Three MAJOR findings were fixed during the owner review: fragmented heading actions, long rollback
copy expanding row/player control tracks, and mobile feedback escaping the viewport. Final result:
FATAL 0, MAJOR 0, deferred UI debt 0.

## Component policy

No shared-new component or global token/primitive meaning was introduced. The approved `MusicRow`
action slot and `IconAction` pressed/disabled states already cover the consumer. `FavoritesProvider`,
`FavoriteAction`, and the favorites page remain feature-local, so the S05 user-approved baseline is
unchanged and no Gallery reapproval is required.

## Remaining boundary

This Step did not write to the live devserver or native Musiclatte account. Web↔Musiclatte star
round-trip verification remains the explicit owner of Phase 2 Step 11.
