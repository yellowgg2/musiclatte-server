# Step 10 verification — persistent browser player

Date: 2026-09-05. Runtime: Node 24.20.0, npm 11.19.0, TypeScript 7.0.2, React
19.2.8, Vitest 5.0.0. Work branch: `yellowgg2/tdd/phase-1/step-10-player`.

## Implementation

- One authenticated `PlayerProvider` outlives SPA page routes and owns the audio element, typed
  player state, bounded queue, seek/volume, Shuffle and Repeat Off/All/One. Logout unmount clears
  authenticated media; route and KO/EN changes retain it.
- Folder/search/album MusicRow actions and S07 random are enabled only when capabilities are
  available. Empty/error random responses preserve the exact queue; a nonempty response replaces
  it and starts playback without enumerating the whole library.
- Desktop player/queue and mobile mini-player/modal sheet reuse the approved Action, IconAction and
  Artwork primitives. Player/queue remain feature-local; MusicRow's Gallery fixture now exercises
  its shared play/pause state without real media. No global token or primitive meaning changed.
- Media Session is best-effort. The product makes no native background or gapless guarantee; see
  [browser support](browser-support.md).

## TDD and automated evidence

- Initial RED collected 14 intentional failures across the three new files while typecheck/build
  remained valid. Focused GREEN grew to 18 player/queue/state cases after Chrome-found regressions.
- Chrome found two concrete defects: a failed media resource was not reloaded on same-song retry,
  and the mobile mini-player retained its base `display:none`. New tests preserve media-error
  priority/reload; the responsive CSS was corrected and re-reviewed at both target widths.
- Final full gates: unit 206/206 across 17 files; contract 91/91 across 10 files; root typecheck,
  production build, `format:check`, and `git diff --check` passed.
- The focused transport/production command passed 8/8. Full contract includes the unchanged native
  `/rest` gateway parity for query/method/status/range/error behavior and production dev-source
  exclusion. No gonic, iOS or bot tree changed.
- Queue tests cover opaque song identity, next/previous, Repeat All/One, deterministic Shuffle that
  preserves the current song, and random empty/error preservation. UI tests cover play-Promise
  races, media-event/error recovery, route/locale persistence, named controls, modal focus and
  logout teardown.

## Chrome full review

Connected Google Chrome 152.0.7977.82, bright theme. Top-level desktop viewport screenshot output
was 1800×919. The same Chrome session exercised actual CSS media queries through test-support-only
390×844 and 320×844 iframe viewports because the connected browser did not expose a viewport setter.
The iframe wrapper is not in the production web bundle or routes.

- Folder and search rows played the generated WAV through clean BFF URLs. Seek reached one second,
  `ended` advanced the five-song queue, queue selection worked, Shuffle toggled, and Repeat cycled
  Off → All → One with accessible state.
- Settings navigation, KO/EN switching and browser Back retained current identity and queue modes.
  Search playback and normal random replacement worked. `random-empty` and `random-error` kept the
  previous queue with distinct localized feedback.
- `media-error` exposed the concrete localized failure. Restoring the upstream and pressing the same
  player control reloaded and resumed the resource after the Chrome-discovered fix.
- At 390×844, mini-player, bottom navigation and list content were separate. The expanded sheet
  showed its queue without page overflow; Shift+Tab/Tab wrapped inside the modal and Escape restored
  the mini-player opener. At 320×844, the secondary next control was intentionally omitted, long
  KO/EN titles truncated safely, the search reflowed, and the expanded final row remained above the
  mini-player/navigation.
- Desktop 200% zoom retained content and controls without horizontal loss. Player CSS adds no motion;
  reused controls inherit the approved reduced-motion token, and the sheet's defensive reduced-motion
  rule removes any future animation. CRITICAL/full review result after fixes: FATAL 0, MAJOR 0,
  deferred UI debt 0. S05 baseline reapproval is not required.

## Physical iPhone Safari gate — complete

On 2026-09-05, the user replied `device done` for the requested play, seek, route/locale change,
portrait/landscape, lock, and return checks on an iPhone 17 Pro Max running the latest iOS available
to them. No failure condition was reported. The exact iOS/Safari version number was not supplied, so
the record preserves the user's `latest` description rather than inferring a version. This evidence
completes Step 10 and Phase 1 independently of the Chrome automation.

### Isolated LAN verification installation

On 2026-09-05, an isolated `musiclatte-iphone-s10` Docker Compose project was installed on the
development Mac for the physical-device gate. The web gateway uses an explicit private LAN address
and test-only port; gonic administration remains loopback-only. Six new project-scoped volumes and
three generated 24-second WAV tracks are used; no personal music or pre-existing Docker volume is
mounted. The non-administrator test credential is stored only in an ignored, mode-0600 local file.

The first container build exposed a missing web-image workspace dependency: production player code
imports `@musiclatte/contracts`, but `deploy/web.Dockerfile` did not copy or build that package. A
deployment contract reproduced the failure, then the image recipe was corrected. Focused contract
5/5, root typecheck/build, and the rebuilt image passed. The final stack reported all services
healthy; both LAN health endpoints returned 200. Chrome then used the LAN origin to sign in with the
non-admin account, enumerate all three tracks, play real streamed WAV bytes, seek to nine seconds,
enable Shuffle, and cycle Repeat Off → All → One.

Use the same base and LAN override files for lifecycle commands. `docker compose -f compose.yaml -f
deploy/compose.lan-development.yaml stop` stops this test installation without deleting its volumes.

## Agent Rulebook postflight

- Added and privately synced
  `typescript-reload-failed-html-audio-resources-and-preserve-concrete-media-errors-001` in Rulebook
  data commit `1dd4188`; a post-sync exact search returned the active shared rule.
- Skipped the responsive `display:none` override candidate because it did not meet the required
  high debugging-cost and token-cost thresholds. No project-local lesson file was written.
- The follow-up web-image workspace omission was classified `skipped(no_new_lesson)`: it was a
  direct import/path packaging correction covered by the deployment contract and did not meet the
  3×HIGH capture threshold.

No source commit, push, production deployment, DNS change, personal media capture or private
metadata recording was performed. The requested isolated LAN verification stack remains running.
