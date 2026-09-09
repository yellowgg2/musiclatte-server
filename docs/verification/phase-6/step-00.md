# Phase 6 S00 — token storage

Implementation is **complete**; direct UI acceptance is not applicable. Git handoff uses branch-push. S01–S12 are subsequent steps.

## Execution

- Base: `7f8d398`; branch: `yellowgg2/tdd/phase-6/step-00-token-storage`.
- Autopilot scope: Phase 6 S00–S12; Git mode: branch-push to origin; no main merge or deployment.
- Runtime: Node 24.20.0, npm 11.19.0 from the session-local toolchain; cwd is this repository.
- BRANCH_SETUP and PROJECT_DOC_CONTEXT completed. Restore behavior was resolved by the user: preserve existing sessions and invalidate automation credentials.

## Implementation

- Migration 015 adds the private PAT ledger while preserving existing schema 14 data; migration failure rolls back atomically.
- CSPRNG `mlpat_` tokens are returned at creation; SHA-256 hashes and row-bound AES-GCM upstream proof are stored separately. Existing credential vault is reused.
- Scope dependencies, names, libraries and expiry are validated. Metadata decoders reject extra private fields.
- Owner-only bounded pagination uses an authenticated cursor bound to instance, owner and authorization policy revision. Expiry/revocation, backward time, row-envelope tampering and policy revision invalidation fail closed.
- Backup validation verifies PAT row envelopes; tampered snapshots are not published.
- Offline restore revokes all restored PATs, clears their proof envelopes and rotates a separate random automation credential epoch. Pre-restore automation cursors are rejected; ordinary sessions and global policy revision retain existing semantics. The original live database is unchanged. S02 will extend the same restore boundary to its new job grants.
- No PAT HTTP routes or capabilities are enabled. No UI or locale changes; direct acceptance is not applicable.

## Verification

All commands use the pinned PATH and repository root. `npm run format` precedes checks.

- RED: `npm run test:unit -- apps/api/test/access-token-storage.test.ts` exited 1 with 2 expected assertion failures: schema 14 instead of 15, and missing repository.
- GREEN: same focused file initially passed 2 tests; expanded v14 migration coverage also passed. Latest focused run passed 4/4, including backup-envelope tamper rejection, exit 0.
- Compatibility: `npm run test:unit -- apps/api/test/access-token-storage.test.ts apps/api/test/session-storage.test.ts apps/api/test/backup-restore.test.ts apps/api/test/import-storage.test.ts apps/api/test/gonic-registration.test.ts apps/api/test/import-worker.test.ts apps/api/test/metadata-storage.test.ts apps/api/test/engine-requests.test.ts` initially passed 120/121 tests. The single failure was an old-schema fixture retaining the new empty PAT table. After correcting its v7 reconstruction, focused access-token/engine tests passed 10/10 (including the additional v14 case).
- `npm run test:contract -- tests/contract/access-token-schema.test.ts tests/contract/metadata-schema.test.ts`: 4/4 passed, exit 0.
- `npm run typecheck`: passed, exit 0.
- `npm run build`: passed, exit 0; migration 015 is included in compiled API migrations.
- `npm run format:check`: passed; `git diff --check`: passed.
- Full unit/contract suites have not been run. No remote runtime test was needed for this storage draft.

## Decision and gate results

The user selected preservation of existing sessions on 2026-09-09. C1 and S00/overview are synchronized. Restore invalidation first failed on the restored PAT still authenticating; the same test now passes, also checking session preservation, original PAT validity, cursor rejection, audit metadata retention and removal of restored proof envelopes.

Resume verification: `npm run test:unit -- apps/api/test/access-token-storage.test.ts apps/api/test/session-storage.test.ts apps/api/test/backup-restore.test.ts apps/api/test/engine-requests.test.ts`: 32/32 passed, exit 0. `npm run typecheck` and `npm run build` passed after the restore change. No required implementation blocker remains. DIRECT_UI/LOCALIZATION/GALLERY: not applicable (storage-only). DOC_SYNC/ACCEPTANCE_SYNC: completed; no new acceptance IDs. GATE_CHECK: complete after final format and Git review.

Rulebook lookup returned no directly applicable storage safeguard; generic runtime alignment was already enforced by project instructions. Reconcile postflight: `skipped(no_new_lesson)`; no canonical write or Rulebook sync. Temporary test databases are cleaned by their harnesses. No runtime server or remote process was created.
