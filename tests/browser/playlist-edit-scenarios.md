# S09 playlist occurrence edit browser scenarios

Run the real playlist BFF against the deterministic synthetic upstream on ports 3000 and 5173.
Use only the local fixture account and keep opaque IDs out of evidence.

1. Open playlist detail with `[A, B, A]`. Verify each occurrence has separately named up, down,
   and remove buttons; first-up and last-down are disabled with a reason.
2. Start playlist playback, confirm and remove the second `A`, and verify only that occurrence
   disappears. Open the player queue and verify its original two `A` entries remain.
3. Move the first occurrence down using Enter, then move it again. Verify old-position permutations,
   returned revision chaining, duplicate-submit blocking, and focus on the moved occurrence.
4. Change the fixture after detail load and submit a stale move. Verify the current snapshot replaces
   the page, the intent is not replayed, inline copy names the conflict, and focus moves to the
   nearest matching occurrence or heading.
5. Use the outcome-unknown fixture and submit removal. Verify the confirmation closes, the current
   snapshot remains, and Refresh playlist is the only stale-intent recovery path.
6. Review EN/KO at desktop, 390×844, and 320×844. Check long title/copy reflow, touch targets,
   confirmation layout, player/navigation overlap, and the approved reduced-motion override.
7. Confirm browser warning/error logs are empty, stop only owned preview/Vite processes, and remove
   the owned control file.

Finish with focused and full unit/contract suites, typecheck, build, format check, locale key and
placeholder parity, production Gallery exclusion, and `git diff --check`.
