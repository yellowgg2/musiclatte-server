# Phase 19 Step 01 — External inventory staged delta commit

## Contract

- Traversal retains the 256-entry/50 ms slice and persists only directory continuation between slices.
- Each root generation owns a process-local map of normalized relative keys to lossless fingerprints, capped at 100,000 entries by default.
- Observation changes occur only in `commitScanSnapshot`, after a complete traversal and root identity/generation recheck.
- New, changed settling/absent, and missing settling rows are the only observation writes. Baseline/admitted/internal/ready path-once rows are not refreshed or reopened.
- A process restart cannot resume an incomplete snapshot: it advances the generation and restarts traversal before absence can be inferred.

## RED → GREEN

The RED scan of 40 unchanged MP3 fixtures produced 43 durable changes, including one observation refresh per file. GREEN produces three root-level changes and leaves every observation value and generation byte-for-byte equivalent through the repository projection. A second RED fixture proved that an uncapped traversal completed with three entries; GREEN blocks at an injected capacity of two with `inventory_capacity` and zero observation rows.

## Verification

- Runtime: Node 24.20.0, npm 11.19.0, Vitest 5.0.0.
- Focused unit: `npm run test:unit -- apps/api/test/external-watch-inventory.test.ts apps/api/test/external-watch-storage.test.ts apps/api/test/import-boundaries.test.ts apps/api/test/backup-restore.test.ts` — 4 files, 36 tests passed.
- `npm run typecheck`, `npm run build`, `npm run format:check`, and `git diff --check` passed.

Fixtures are synthetic temporary trees. No production music path, filename, account, or metadata is copied into tests or evidence.
