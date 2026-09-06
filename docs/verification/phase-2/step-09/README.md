# Phase 2 Step 09 verification — playlist occurrence editing

Date: 2026-09-06. Runtime: Node 24.20.0, npm 11.19.0, connected Google Chrome.
Work branch: `yellowgg2/tdd/phase-2/step-09-playlist-occurrence`.

## Delivered behavior

- Editable playlist rows expose duplicate-safe move-up, move-down, and remove actions using the
  rendered `{position, songId, revision}` identity. Reorder sends an exact permutation of old
  positions and chains each returned authoritative revision.
- Remove uses an inline, exact title/position confirmation. A page-level in-flight guard prevents
  rapid duplicate or overlapping mutations; first/last move buttons remain named and disabled.
- Conflict and outcome-unknown responses replace the list with any current snapshot, never replay a
  stale intent, close stale confirmation, and require explicit refresh. Focus returns to the moved,
  nearest, or page-heading target.
- Playlist edits do not mutate the PlayerProvider queue. A currently playing queue retains its
  original duplicate/order snapshot until the user starts playlist playback again.
- Added matching KO/EN copy, client remove/reorder support, old-position permutation logic,
  integrated React coverage, and real producer-consumer contract coverage.

## RED → GREEN evidence

The initial focused unit run collected four tests and all four failed on missing occurrence actions.
The initial contract run collected one test and failed on missing `reorder`. GREEN passed the same
four unit tests and one contract test, followed by the shared MusicRow action-slot test.

## Component and Chrome full review

`PlaylistOccurrenceActions` is feature-local and reuses approved Action/IconAction. The existing
shared MusicRow gained an optional action slot because playlist detail is its first actual consumer;
the same slot and occurrence action component render in the Gallery. No global token or primitive
meaning changed, so the approved S05 baseline remains valid without reapproval.

Connected Chrome used the real Vite UI and Fastify BFF with deterministic synthetic data.

- Desktop confirmed separate `[A, B, A]` identities, exact second-duplicate removal, Enter-based
  reorder, focus recovery, boundary disabled states, and original player queue persistence.
- 390×844 and 320×844 confirmed pointer/touch operation, KO/EN accessible names, long copy reflow,
  single-column narrow confirmation actions, and no player/navigation overlap. The feature adds no
  motion and inherits the approved reduced-motion foundation.
- Conflict replaced the page with the server-updated snapshot and focused the nearest occurrence.
  Outcome unknown closed stale confirmation and left Refresh playlist as the recovery action.
- Browser warning/error logs were empty.

Initial desktop review found MAJOR `CORE-003`/`LIST-002`: row actions created a second line on every
desktop row. Actions now remain inline on desktop and move to a second line only below 30rem or while
confirming. Inline conflict copy and stale confirmation recovery were also corrected. Final result:
UI baseline pass, FATAL 0, MAJOR 0, deferred UI debt 0.

## Automated gates

- Focused unit: `playlist-edit-ui`, `playlist-add-ui`, `playlist-read-ui`, and
  `design-foundation` — 4 files, 19 tests passed.
- Focused contract: `playlist-ui` and `playlist-api` — 2 files, 4 tests passed.
- Full unit: 26 files, 276 tests passed. This includes matching, nonempty KO/EN keys and exact
  placeholder-order parity.
- Full contract: 13 files, 109 tests passed. This includes production Gallery exclusion and the
  playlist UI/BFF producer-consumer boundary.
- `npm run typecheck`, `npm run build`, `npm run format:check`, and `git diff --check` passed.

## Boundaries

No bulk remove, drag-only interaction, optimistic local reorder, automatic player queue rewrite,
favorites UI, gonic/iOS/bot change, real music metadata, live devserver write, commit, push,
deployment, or DNS change was made.
