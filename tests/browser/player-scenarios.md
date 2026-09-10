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

## Phase 8 three-state repeat control

Reuse `tests/support/library-preview.ts` and the isolated ports above. The preview keeps the normal
Router, locale picker, desktop player, and mobile expanded player in one provider lifecycle.

1. On `/__preview/desktop`, start a song in English. Cycle the repeat button through off, one, all,
   and off. For every state record `data-repeat-mode`, `aria-pressed`, the marker (`off`, `one`, or
   absent), the accessible name/title, and the 44×44px button bounds.
2. On `/__preview/mobile`, open the expanded player at 390×844. Cycle one state on desktop before
   opening when testing cross-surface state, then cycle again in the dialog and confirm both
   `[data-repeat-mode]` controls update together. Switch EN↔KO and confirm current/next names.
3. Keyboard-activate the focused repeat button and confirm `:focus-visible` plus the existing
   outline remain visible. Ensure decorative SVG content does not add an accessibility node.
4. On `/__preview/narrow`, verify the 320×844 transport wraps within its container with zero
   horizontal document overflow and keeps every control at 44×44px.
5. Apply Chrome 200% page zoom, repeat the 320px containment and focus check, then restore 100%
   before cleanup. Review off/one/all screenshots or DOM markers without treating this automatic
   run as final P8-UA-002 approval.
