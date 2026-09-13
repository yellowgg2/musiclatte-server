# Phase 16 global layout browser scenarios

Use `tests/support/layout-preview.ts` with the normal production Router and synthetic auth. Do not
use production credentials or music metadata.

## Desktop route parity

1. At 1800px, visit music, playlists, imports, settings, listening, recent, favorites, mixes,
   curation, and metadata list/detail routes.
2. Assert the sidebar is 240px and every top-level heading starts at x=272px.
3. Assert primary navigation rows share x, width, height, and padding.
4. Repeat representative routes at 1024px and assert `scrollWidth - innerWidth` is zero.

## Narrow route parity

1. At 390px and 320px, assert each top-level heading starts at x=16px.
2. Confirm the mobile brand/account trigger and bottom navigation remain reachable.
3. Exercise normal and preview error states, long KO/EN text, player, and selection consumers.
4. Assert the final interactive content remains clear of fixed player, selection, navigation, and
   safe-area surfaces.

## Reflow

1. Set actual Chrome zoom to 200% at a 320px responsive viewport.
2. Assert the account trigger remains present and the document has no horizontal overflow.
3. Restore zoom to 100% after recording the accessible state and rect evidence.
