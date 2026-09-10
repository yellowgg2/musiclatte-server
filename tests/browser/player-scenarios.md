# S10 persistent player browser scenarios

Run the real S03/S07/S09 API against the deterministic synthetic upstream. Ports 3000 and 5173
must be free.

```bash
export PATH="$HOME/.cache/musiclatte-toolchain/node-v24.20.0-darwin-arm64/bin:$PATH"
PREVIEW_CONTROL=/tmp/musiclatte-s10-control node --import tsx tests/support/library-preview.ts
npm run dev:web -- --host 127.0.0.1
```

Use the synthetic account exported by `tests/support/auth-harness.ts`. Do not record account values
or media identifiers in browser evidence.

1. Open `/login`, enter Music → My music → Daylight folder, and play a row. Verify the query-free
   `/api/v1/media/songs/:id/stream` request, playing state, seek and volume.
2. Open Queue. Select entries, enable Shuffle, and cycle Repeat through Off → All → One. Let media
   end to verify queue advancement and one-song repeat semantics.
3. Move to Settings, change KO/EN, then use browser Back. Current song, queue mode and audio element
   identity remain while route/title/control copy updates.
4. Search `new` and play its song. Use Play random songs. The default response replaces and starts a
   bounded 5-song queue.
5. Put `random-empty` or `random-error` in the owned control file, then activate random. The existing
   queue/current song remains and a localized status appears. Use `media-error` to verify a concrete
   media failure, restore `normal`, and retry the same player button to reload and recover.
6. Open `/__preview/mobile` and `/__preview/narrow` on the synthetic API origin. Their test-only
   390×844 and 320×844 iframes exercise the real Vite document and CSS media queries in Chrome.
   Check mini-player/nav/list separation, long KO/EN, and the final expanded list row.
7. Open the mini-player. Confirm a named modal, seek/previous/next/shuffle/repeat, a named focusable
   queue scroller, Tab containment, Escape close and opener focus restoration.
8. Review the top-level page at 200% Chrome zoom. The player adds no animation; the existing shared
   `--motion-response: 0ms` reduced-motion contract applies to reused actions.

Run production exclusion and native gateway regression with the Step's focused contract command.
Stop only the owned API/Vite processes and remove the owned control file.

## Phase 8 mobile queue containment

Run the same normal Router fixture with explicit free ports. Set the owned control file to
`long-queue`; use `long-queue-error` only for the quality-feedback state.

```bash
PORT=3118 WEB_PORT=5188 PREVIEW_CONTROL=/tmp/musiclatte-p8-s01-control \
  node --import tsx tests/support/library-preview.ts
MUSICLATTE_PREVIEW_API_TARGET=http://127.0.0.1:3118 \
  npm run dev:web -- --host 127.0.0.1 --port 5188
```

1. Open `/__preview/mobile` and `/__preview/narrow`, start and pause the 25-song queue, then open
   the expanded player. Confirm the dialog ends inside the 844px iframe and the named body is the
   only vertical scroller; the queue list itself has visible overflow.
2. Scroll the body to the end. Measure the final queue button inside the body viewport, activate it
   with Enter, then verify `aria-current=true`.
3. From the last queue button, Tab wraps to Close and Shift+Tab wraps back. Escape closes the dialog
   and restores focus to its opener.
4. With quality feedback visible, repeat the 390px dialog/body/final-row and horizontal-overflow
   measurements.
5. Open `/__preview/desktop`, start and pause the same queue, then open Queue. Confirm the popover
   stays above the persistent player and its named list retains `overflow-y:auto`, keyboard End,
   and last-row visibility.
