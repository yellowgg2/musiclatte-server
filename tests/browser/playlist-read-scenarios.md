# S06 playlist read and playback browser scenarios

Run the real playlist BFF against the deterministic synthetic upstream. Ports 3000 and 5173 must
be free.

```bash
export PATH="/Users/incredibleyoung/.cache/musiclatte-toolchain/node-v24.20.0-darwin-arm64/bin:$PATH"
PREVIEW_CONTROL=/tmp/musiclatte-step06-preview-control node --import tsx tests/support/playlist-preview.ts
npm run dev:web -- --host 127.0.0.1
```

Use the synthetic account exposed by the local auth harness. Keep its values and all media IDs out
of screenshots, committed fixtures and logs.

1. Open `/playlists` and confirm the summary request does not fan out into detail requests. The
   compact card shows fallback artwork, the long name and song count without clipping.
2. Open the card and verify the detail order begins A, B, A. Play B from its row, advance once and
   confirm the second A becomes current. Then choose Play playlist and inspect Queue for the same
   A, B, A occurrence order.
3. Use the All playlists link, browser Back and direct `/playlists/:id` entry. A delayed detail
   response must not replace the list after navigation. A signed-out direct entry returns through
   login only to a validated same-origin playlist path.
4. Switch KO/EN and inspect long copy at desktop, 390×844 and 320×844. At 320px, scroll to the last
   row and verify that it remains above the persistent mini-player and bottom navigation.
5. Use keyboard Tab and Enter on MusicRow disclosure/play controls. Use pointer/touch-sized controls
   at mobile widths. Review the desktop page at Chrome 200% zoom for reflow and horizontal loss.
6. Put `loading`, `list-empty`, `detail-empty`, `missing`, `denied` or `error` in the owned control
   file and navigate to force a new read. Verify distinct localized status/recovery actions while
   the existing Now playing queue remains. Restore `normal` and activate Try again.
7. Put `cover-fallback` or `cover-error` in the control file. The artwork placeholder must retain its
   geometry and the playlist/detail/player must remain usable.
8. Confirm the feature introduces no animation; shared actions inherit the approved
   `prefers-reduced-motion: reduce` zero-duration token. Review browser warning/error logs.

Run the Step's focused and complete regression commands. Reset Chrome zoom, stop only the owned
API/Vite processes, and remove the owned control file.
