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

## 2026-09-17 overlapping replacement references

- RED: an approved target replacement whose source and displaced IDs both occurred in one playlist
  was scanned as one successor occurrence; either single-baseline restore returned conflict and
  could not reconstruct the second occurrence.
- GREEN: the restore service obtains the source/displaced predecessor set only from the successful
  replacement ledger, accepts the exact collapsed successor projection, and rebuilds both
  occurrences in their captured order. The second predecessor restore is idempotent and can apply
  the final favorite union.
- Safety: ordinary jobs retain the single-predecessor contract. Replacement restore still requires
  the same successful successor relation, unchanged playlist metadata, one of the enumerated scan
  projections, and exact authenticated readback; unrelated edits remain conflicts.
