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

## Settling admission regression — 2026-10-20

The delta optimization in `cc46c2c` preserved unchanged observation rows, but admission still required
`last_seen_at > stable_since_at`. Production diagnostics found 90 settling candidates with equal
timestamps and no events, including eight newly created files on the investigation date. The
deployed binary contained both conditions. A synthetic scratch run remained deferred after eleven
seconds, six hours, and one day; advancing the second-observation timestamp only in the scratch DB
allowed admission.

The fix uses the existing opened-file fingerprint comparison as the second observation after ten
seconds. It removes only the stale timestamp prerequisite. Fingerprint, no-follow open, MP3 probe,
post-probe identity, lease, ownership, baseline, internal-path, and path-once checks remain in place.
Existing settling rows resume normally without schema migration, queue reset, or timestamp edits.

- RED: the changed admission expectation, changed-file check, and inventory-to-admission regression
  failed with `deferred`; the other eleven focused tests passed.
- GREEN: nine affected unit files passed, 168 tests; three contract files passed, nine tests.
- `npm run typecheck`, `npm run build`, `npm run format:check`, and `git diff --check` passed
  with Node 24.20.0 and npm 11.19.0. The build retained its existing web chunk-size advisory.
- The integration regression performs a baseline, discovers a new synthetic MP3, rescans unchanged
  after one day, proves the observation stayed identical, and admits through a fresh service. It
  also preserves baseline exclusion and prevents duplicate history after same-path replacement.
- The admission regression refuses changed bytes even without another inventory scan; the existing
  rename-over-open race and account/path/storage checks remain covered.
- Commands: `npm run test:unit -- apps/api/test/external-watch-admission.test.ts
apps/api/test/external-watch-inventory.test.ts apps/api/test/external-watch-storage.test.ts
apps/api/test/external-watch-runtime.test.ts apps/api/test/external-registration.test.ts
apps/api/test/recent-downloads-api.test.ts apps/api/test/import-worker.test.ts
apps/api/test/import-boundaries.test.ts apps/api/test/backup-restore.test.ts`;
  `npm run test:contract -- tests/contract/recent-downloads-api.test.ts
tests/contract/import-api.test.ts tests/contract/recent-ui.test.ts`.
- Branch setup: skipped for this ad-hoc repair; no Step was selected by the user. No UI, Gallery,
  public API, or locale change; additional visual acceptance is not applicable.
- Resolution Memory search returned only unrelated candidates, none applied. Postflight:
  `no_new_solution` because this is a local producer/consumer contract repair without a separately
  verified portable procedure; no canonical write or Rulebook sync.
