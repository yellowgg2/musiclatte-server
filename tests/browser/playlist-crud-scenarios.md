# S07 playlist lifecycle browser scenarios

Run the real playlist BFF against the deterministic synthetic upstream. Ports 3000 and 5173 must
be free.

```bash
export PATH="/Users/incredibleyoung/.cache/musiclatte-toolchain/node-v24.20.0-darwin-arm64/bin:$PATH"
PREVIEW_CONTROL=/tmp/musiclatte-step07-preview-control node --import tsx tests/support/playlist-preview.ts
npm run dev:web -- --host 127.0.0.1
```

Use only the local synthetic account exposed by the auth harness. Do not put its values or media
identifiers in screenshots, evidence, or logs.

1. Open `/playlists` with `normal`. Create a playlist from a name with surrounding whitespace,
   Korean, English, an ampersand, and an em dash. Verify the authoritative trimmed name and opaque
   ID appear without clearing an existing player.
2. Open the playlist and rename it. Verify the returned snapshot replaces the heading before the
   background read and the name remains correct after that read.
3. Submit whitespace-only and more than 255 Unicode code points. No request is sent, the field
   remains open, and localized field help/error stays associated with the input.
4. Verify initial field focus, Tab/Shift+Tab focus trapping, Escape dismissal, body scroll lock,
   and focus return to the Create/Rename/Delete trigger. While busy, repeated submit and dismissal
   do not create a second write.
5. Open delete confirmation. It must show the exact long playlist name and explain that deleting
   the playlist does not delete audio files. Cancel must send no request and return focus.
6. Switch KO/EN and review desktop, 390×844, and 320×844. The mobile presentation is a bottom
   sheet; at 320px actions reflow to full width without clipping. The 320px review exceeds the
   horizontal reflow pressure of the 200% desktop checkpoint. Shared motion duration becomes 0ms
   under `prefers-reduced-motion: reduce`; the feature-local overlay adds no animation.
7. Put `conflict` in the control file only after opening Rename. Submit and verify the current
   server snapshot replaces the page behind the still-open form, with localized recovery copy and
   a refresh action.
8. Reload with `normal`, open Rename, then switch to `outcome-unknown` before submit. Verify the
   form remains open, no success is announced, and localized refresh guidance appears.
9. Use `list-empty` and `denied` to verify distinct localized status surfaces. Browser warning and
   error logs must remain empty throughout the state matrix.
10. Restore `normal`, open delete confirmation, submit once, and verify replace navigation to
    `/playlists`. Direct stale detail access must resolve as missing while the player queue/audio is
    untouched.

Run focused and complete unit/contract suites plus format, typecheck, build, format check, and
`git diff --check`. Reset the control to `normal`, stop only the owned API/Vite processes, and
remove the owned control file.
