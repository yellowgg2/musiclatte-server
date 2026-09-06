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
