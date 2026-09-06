# Phase 2 Step 08 verification — song selection and playlist add

Date: 2026-09-06. Runtime: Node 24.20.0, npm 11.19.0, Google Chrome 152.0.7977.82.
Work branch: `yellowgg2/tdd/phase-2/step-08-playlist`.

## Delivered behavior

- Added signed-in, in-memory selection scoped to folder ID, search query plus music-folder ID, or
  playlist ID plus loaded revision. Search offsets retain selection; changed scope, route exit,
  logout, and provider unmount discard it. Duplicate IDs are stable-deduplicated in source order.
- Extended the shared MusicRow with an optional native checkbox whose accessible name/state and
  touch target are independent from details and Play. Folder/search and playlist detail expose a
  count, source label, current-page select-all, add, and cancel flow.
- Added a responsive contextual bar and feature-local playlist picker. The picker lists editable
  summaries only, then rereads target detail immediately before mutation to recheck editability and
  obtain an authoritative revision. Its named target scroller is bounded and owns overflow.
- Reused PlaylistForm for create-new. Empty creation is confirmed before appending; a later append
  failure leaves the created playlist and every applied batch intact.
- Packs ordered IDs by UTF-8 JSON bytes including the operation envelope. The conservative 8KiB
  default remains below the 16KiB BFF limit and leaves room for Subsonic query encoding. Batches run
  sequentially with fresh operation IDs and returned revision chaining.
- On failure, processing stops. Applied IDs leave selection, failed and unattempted IDs remain, and
  retry reuses the failed receipt ID/revision so an ambiguous response cannot duplicate a batch.
- Added matching KO/EN copy, playlist client append support, real create → rename → append → delete
  Fastify contract coverage, deterministic partial-failure preview state, and Gallery coverage for
  the actual selectable MusicRow.

## RED → GREEN evidence

The initial focused run collected seven tests and all seven failed only on missing selection UI and
pure selection/batch behavior. A later route-lifetime RED assertion also failed until keyed scope
cleanup was implemented; stale cleanup after revision rebase is ignored while actual route exit
clears selection.

Focused GREEN covers scope changes and paging, source-order dedupe, UTF-8 boundary packing,
sequential revision/operation IDs, receipt-safe partial retry, checkbox/play separation, editable
target gating, existing/new add order, partial selection retention, and the Gallery selectable row.

## Chrome full review

Connected Chrome used the real Vite UI and Fastify BFF with deterministic synthetic data.

- Desktop playlist detail counted 14 unique selected songs across 15 duplicate occurrences. The
  picker exposed only the editable target, kept its actions fixed, and preserved the active player.
- At 390×844 the selection bar stayed above the mini-player and bottom navigation. The picker and
  reused create form rendered as bottom sheets; initial focus, Escape, and focus return passed.
- The first 320px layout wrapped the longest Korean action excessively. Actions were changed to a
  single-column narrow layout and re-reviewed with no clipping or overlap. The picker target and
  cancel actions remained readable with long metadata.
- KO and EN count/action/scope copy passed. Native checkbox semantics, pointer separation, named
  internal scrolling, and keyboard dismissal passed. The feature adds no animation and inherits
  the approved 0ms reduced-motion override; 320px reflow is stricter than the 200% horizontal
  checkpoint.
- The partial fixture selected 40 rows. Chrome showed `Added: 16`, `Failed: 16`, `Not attempted: 8`,
  and exactly 24 remaining selected; the refreshed detail contained the 16 successful additions
  and a single retry action. Browser warning/error logs were empty.

CRITICAL/full result after the narrow-action correction: FATAL 0, MAJOR 0, deferred UI debt 0.
MusicRow gained an actual optional selection state in its existing Gallery fixture; no new shared
primitive or token was added, so the approved S05 baseline remains valid without reapproval.

## Automated gates

Final verification uses the pinned project runtime and records focused unit 22/22, focused contract
10/10, full unit 271/271, and full contract 109/109. Typecheck, production build, format check,
locale key/placeholder parity, production Gallery exclusion, and `git diff --check` pass.

## Boundaries

No occurrence remove/reorder, favorites UI, cross-route or persistent selection, all-library
selection, player lifecycle redesign, gonic/iOS/bot change, real music metadata, live devserver
write, commit, push, deployment, or DNS change was made.

## Agent Rulebook postflight

Result: `skipped(no_new_lesson)`. The bounded picker overflow reused an existing central lesson. The
320px action correction and conservative transport headroom were feature-specific verification
findings with direct tests/evidence, not broadly reusable new rules.
