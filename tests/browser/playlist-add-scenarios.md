# S08 song selection and playlist-add browser scenarios

Run the real playlist BFF against the deterministic synthetic upstream on ports 3000 and 5173.
Use only the local harness account and keep its values and opaque song IDs out of evidence.

1. On folder, search, and playlist-detail sources, enter selection mode. Verify each checkbox is
   named and independently operable, title/details and Play remain separate, duplicate IDs count
   once, and Select this page follows source order.
2. Change only search page offsets and retain selection. Change query, music folder, route, account,
   or playlist revision and verify stale selection is not carried into the new scope.
3. Open Add to playlist. Only editable summaries appear. The bounded named target list scrolls
   internally while its heading and actions remain visible; Escape/Cancel returns focus to the
   trigger.
4. Add to an existing playlist, then use Create a new playlist. Creation must finish empty before
   append starts. Existing playback and queue remain mounted through selection and overlays.
5. Put `selection-partial` in `PREVIEW_CONTROL`, select the 40 synthetic rows, and add to the
   editable target. Verify the first byte-bounded batch succeeds, the next fails, later songs are
   not attempted, and only failed/unattempted rows remain selected with one retry action.
6. Review KO/EN at desktop, 390×844, and 320×844. The selection bar must sit above player/navigation;
   at 320px its actions stack without clipping. Treat 320px as stricter horizontal reflow than the
   200% desktop checkpoint.
7. Verify keyboard checkbox activation, dialog focus order, Escape and focus return, pointer/touch
   targets, long playlist metadata, and empty/read-only target states. The feature introduces no
   animation and inherits the approved reduced-motion foundation.
8. Confirm browser warning/error logs are empty, restore `normal`, stop only owned preview/Vite
   processes, and remove the owned control file.

Finish with focused and full unit/contract suites, typecheck, build, format check, locale key and
placeholder parity, production Gallery exclusion, and `git diff --check`.
