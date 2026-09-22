# Phase 19 Step 05 — Background load aggregates and contention regression

## Contract

- The operator tool accepts one explicit management database path, opens it read-only with a 100 ms
  timeout, validates schema 32, and emits only whole-installation aggregates.
- Output is allowlisted to schema/storage byte counts, worker state and heartbeat-age buckets,
  external root/observation states, curation run/queue states, failure lifecycle totals, and closed
  error-code counts.
- Missing arguments, unavailable files, and foreign schemas return a nonzero exit with only a closed
  error code. Database paths and private row values are never echoed.
- Three shared SQLite connections preserve valid session reads under a writer lock and keep invalid
  cleanup fail-closed. The combined regression also retains O(delta) unchanged external scans and
  zero curation calls before the cooldown boundary.

## RED → GREEN

The contract RED failed because the aggregate module did not exist. GREEN exercises synthetic
empty/active/history states, a private sentinel in every representative identifier field, database
and WAL hashes before/after collection, and CLI failure modes. The contention fixture reproduces a
held writer lock while separate readers validate a good session and reject a corrupt one.

## Safety evidence

- Affected verification passed: 4 unit files / 34 tests and 1 contract file / 3 tests, followed by
  `npm run typecheck`, `npm run build`, `npm run format:check`, and `git diff --check`.
- The collector checks `total_changes()=0`; contract tests also verify database and WAL SHA-256
  digests are unchanged.
- The JSON sentinel assertion covers library, account, username, worker, path, generation, and track
  identifiers. No live account or media data is used.
- No HTTP/admin surface, port, credential mount, migration, checkpoint, or production path was added.
