# Phase 2 Step 07 verification — playlist lifecycle UI

Date: 2026-09-06. Runtime: Node 24.20.0, npm 11.19.0, Google Chrome 152.0.7977.82.
Work branch: `yellowgg2/tdd/phase-2/step-07-playlist-ui`.

## Delivered behavior

- Enabled the web `playlists.write` consumer and exposed create/rename/delete only when the server
  capability permits writes; resource mutation also requires `editable`.
- Added strict playlist client methods with CSRF and web-client headers, bounded requests, typed
  response decoding, and localized handling for 401/403/404/422/conflict/outcome-unknown.
- Each new user intent receives a Web Crypto base64url operation ID. A retry of the unchanged
  intent reuses that ID, while editing resets it; busy state blocks duplicate submission.
- Added feature-local desktop dialogs/mobile sheets using the approved Action and TextField
  components. Names are trimmed, validated as 1–255 Unicode code points, and preserve special
  characters.
- Modal focus starts in the field, traps Tab/Shift+Tab, closes with Escape when idle, locks body
  scroll, and returns to the initiating control. Failure keeps the form and value in place.
- Delete confirmation displays the exact playlist name and states that audio files are retained.
  Successful mutation snapshots update the current view before a background authoritative read;
  delete uses replace navigation and never clears PlayerProvider state.
- Added matching nonempty KO/EN copy, real client-to-Fastify CRUD contract coverage, and local
  preview fault modes for conflict and outcome-unknown review.

## RED → GREEN evidence

The first focused React run collected six new tests: five failed because lifecycle actions and
forms did not exist, while the negative capability gate already passed. The producer-consumer
contract failed because the web `playlists.write` feature was false. Typecheck and build passed in
RED, isolating the failures to the missing behavior.

Focused GREEN passed 26/26 React regression tests and 10/10 contract tests. The new suite covers
create/rename/delete visibility, name validation, CSRF and operation-ID reuse, busy submission,
focus return, exact delete impact, conflict/current snapshots, outcome-unknown recovery, navigation,
and player preservation. The contract performs create → rename → delete through the real Fastify
routes and synthetic upstream.

## Chrome full review

Connected Chrome exercised the real Vite UI and BFF with only deterministic synthetic data.

- Create trimmed a long mixed KO/EN name containing `&` and an em dash; rename displayed the
  authoritative result after refresh.
- Desktop controls initially placed Rename and Delete too far apart. The detail action group was
  corrected to cluster related management actions and re-reviewed without changing a shared
  primitive or token.
- Initial focus, Tab/Shift+Tab trapping, Escape, Cancel, and focus return all passed. Delete
  confirmation showed the exact long target and audio-retention impact.
- The confirmed delete submitted once, replaced the URL with `/playlists`, and rendered the empty
  list while the active Synthetic A audio and queue stayed present. A fresh request to the deleted
  detail rendered the localized missing state. Browser warning/error logs remained empty.
- Desktop, 390×844 mobile, and 320×844 narrow layouts passed. Mobile used a bottom sheet and 320px
  actions reflowed to full width with no clipping or overlap; this also covers a stricter horizontal
  reflow condition than a 200% desktop viewport reduction.
- KO/EN copy, long names, special characters, empty list, denied reads, mutation conflict with the
  current snapshot, and outcome-unknown refresh guidance all rendered without raw upstream text.
- The feature adds no animation. Shared action transitions inherit the approved reduced-motion
  0ms token. Browser warning/error logs were empty after the state matrix.

CRITICAL/full result after the action-group fix: FATAL 0, MAJOR 0, deferred UI debt 0. S05 Gallery
reapproval is not required: Action, TextField, and StatusSurface semantics are unchanged, the
overlay is feature-local, shared-new is 0, and the approved baseline remains intact.

## Automated gates

All final commands use the pinned project runtime by prepending the project-local toolchain to
`PATH`.

```text
npm run format
npm run test:unit -- apps/web/test/playlist-crud-ui.test.tsx apps/web/test/playlist-read-ui.test.tsx apps/web/test/login-shell.test.tsx
npm run test:contract -- tests/contract/playlist-ui.test.ts tests/contract/playlist-api.test.ts tests/contract/production-exclusion.test.ts
npm run test:unit
npm run test:contract
npm run typecheck
npm run build
npm run format:check
git diff --check
```

Current result: focused unit 26/26, focused contract 10/10, full unit 262/262, and full contract
109/109 passed. Typecheck and production build passed. KO/EN contain 218/218 matching nonempty keys
with matching placeholders. Final format check and diff check are recorded after documentation
sync.

The first full-unit invocation accidentally inherited host Node 26 and correctly failed the pinned
runtime assertion; the same run also produced one timing miss. The two affected tests passed 16/16
under Node 24.20.0, followed by the clean 262/262 full run. No product fix or test weakening was
needed.

## Boundaries

No song add/selection, occurrence edit, favorites UI, shared overlay library, or player queue
mutation was added. No gonic, iOS, bot, live devserver, personal metadata, real music file, commit,
push, deployment, or DNS change was involved.

## Agent Rulebook postflight

Result: `skipped(no_new_lesson)`. The management-action spacing finding was a direct visual
correction with low debugging and recurrence cost. The first full-test invocation using host Node
instead of the pinned runtime matched an existing central Node toolchain rule and the repository's
explicit PATH instruction; it was not a new candidate. No canonical or project-local rule was
written, so prepare/add/sync/re-search were not applicable.
