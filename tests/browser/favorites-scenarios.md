# S10 favorites browser scenarios

Run the real favorite BFF against the deterministic synthetic upstream on ports 3000 and 5173.

1. Open Music, star and unstar a row, and verify immediate pressed/busy state, duplicate blocking,
   authoritative completion, inline rollback, and retry.
2. Open `/music/favorites`; verify authoritative `[B, A]` order, empty/loading/read-error recovery,
   ordered playback, selection, and playlist-add entry.
3. Start a row, change favorite state, and verify the same pressed state in desktop and expanded
   player surfaces without audio or queue restart.
4. Change the synthetic native state and focus the window; verify row/page/player refresh without
   wiping the current list while loading.
5. Review EN/KO at desktop, 390×844, and 320×844, including keyboard focus, 200% zoom-equivalent
   reflow, reduced-motion, touch targets, long error copy, and player/navigation overlap.
6. Confirm no fatal browser errors, stop only owned preview/Vite processes, and remove the owned
   control file.

## Phase 11 S01 selection surface

Verify `Select songs` appears once in the Favorite songs heading immediately before List/Tiles, while Play favorites and Refresh favorites remain in the top action panel. Reuse the shared fixed-bar matrix from the library scenario and confirm selection survives player creation without horizontal overflow.

## Phase 11 S03 collection parity

From the shared Phase 11 browser session, enter Favorites after Recent downloads with Tiles already selected. Confirm the preference persists, the outer collection remains transparent, each song owns its card surface, and each available tile keeps Play → Music information → Favorite in aligned 44px cells. The common heading must retain one selection entry before List/Tiles and the feature-level Play favorites/Refresh favorites controls must not migrate into it.
