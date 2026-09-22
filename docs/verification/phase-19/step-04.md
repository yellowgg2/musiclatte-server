# Phase 19 Step 04 — Curation failure ledger lifecycle

## Contract

- Migration 032 retains every failure row and its count while resolving historical tombstoned tracks
  and failures absent from a ready generation.
- Resolution uses the proving run's `last_reconciled_at`, falling back to the row's
  `last_failed_at`. Current queue errors and incomplete runs remain unresolved.
- A future error-free generation resolves queue-absent track and directory failures in the same
  transaction as track tombstones and the ready checkpoint.
- Item success resolves the existing row; a later failure reopens it with `resolved_at=NULL` and an
  incremented `failure_count`. Current-warning aggregates use only unresolved rows; resolved rows
  remain available as history.

## RED → GREEN

RED retained two queue-absent historical failures after an empty full generation. GREEN resolves
both at the generation's reconciliation timestamp and tombstones the missing track. A synthetic
run-update trigger proves transaction rollback leaves both the tombstone and resolution unpublished.

The v31 migration fixture contains four rows: a tombstoned track, a ready-generation absent
directory, a current-generation terminal queue error, and a partial-generation directory failure.
After migration the first two are resolved at the ready run timestamp, the latter two remain open,
and all four rows, counts, causes, and last-failure timestamps are retained.

## Verification

- Focused RED: `npm run test:unit -- apps/api/test/curation-inventory.test.ts` — one expected failure
  showed both absent rows still had `resolved_at=NULL`.
- Affected GREEN: 6 unit files / 58 tests and 2 contract files / 3 tests passed.
- `npm run typecheck`, `npm run build`, `npm run format:check`, and `git diff --check` passed.
- The management backup/restore fixture preserves one resolved historical row and one unresolved
  actionable row.
- No music files, production databases, or volumes were read or changed.
