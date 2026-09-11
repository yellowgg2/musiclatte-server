# Phase 9 Step 06 verification

- RED: there was no old-to-new account reference migration or scheduler owner after gonic rebound.
- GREEN: the reference worker accepts both observed scan outcomes—baseline retained or only old
  occurrences removed—and reconstructs the full desired list with the verified new ID.
- Preservation: first/middle/last and duplicate occurrences keep their exact order across multiple
  playlists. Already-desired and previously completed checkpoints do not repeat mutations.
- Safety: playlist checkpoints precede reads/writes, immutable baseline/desired payloads fence
  retries, and unrelated member/order/name/owner edits fail as `reference_conflict` without a write.
- Recovery: an uncertain upstream result is decided by exact readback. Authorization loss and
  deleted/read-only/unverifiable references remain auditable as reference-owned recovery while the
  managed file and rebound MediaLink stay intact.
- Verification: the final target-account playlist ID set, each complete ordered list, playlist
  metadata, and star state must match before `succeeded` clears the accepted grant.
- Boundary: the worker's client surface contains only playlist and star calls; contract coverage
  excludes recent, scrobble, bookmark, and listening storage access.
- Regression: focused storage/runtime tests and the existing playlist, favorites, and Subsonic
  suites preserve their public session behavior.
- Rulebook: runtime/deployment alignment remains satisfied; postflight is
  `skipped(no_new_lesson)`.

Final gates: project formatting, focused unit/contract tests, typecheck, build, `format:check`, and
`git diff --check`.
