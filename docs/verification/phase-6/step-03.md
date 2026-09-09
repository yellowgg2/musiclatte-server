# Phase 6 S03 — curation state and snapshots

Implementation complete; direct UI acceptance not applicable. Base `56c70ffb`; branch `yellowgg2/tdd/phase-6/step-03-curation-storage`. Autopilot branch-push, no main merge or deployment.

Migration 017 introduces track/field projections, append-only receipts/events, claim items and epoch, hashed operation/admission results, inventory checkpoint/queue and materialized snapshots. Existing values remain unreviewed. The reducer separates current revision from immutable receipt revision, preserves completed status for verified optional enrichment and returns changed required/audio/policy evidence or reopened reviews to needs_review. Effective required-review claims expire at query time. Optional attempts preserve independent completion and cannot create present values.

Snapshots freeze public projections, membership, count and coverage. HMAC cursors bind actor, credential, scope, libraries, instance, policy, filter, epoch and ordinal. Expiry, tampering and changed scope fail explicitly; bounded cleanup and configured storage limits prevent unlimited snapshots. No private path, digest or credential is projected. Backup checks field, receipt, operation, claim and snapshot consistency. Offline restore preserves existing sessions/receipts, invalidates automation credentials/claim epoch and marks inventory/validation stale.

## Verification

Pinned Node 24.20.0/npm 11.19.0; formatter before checks.

- RED: state tests executed 2 failures for absent implementation; storage tests executed 3 failures for absent repository/schema 16 instead of 17.
- GREEN: affected 10 unit files covered 127 tests in total. Initial historical table-list expectation and operation INSERT placeholder count failures were fixed; final focused rerun passed all 19 tests. Remaining 108 affected tests passed in the preceding run.
- Contract: actual repository projections and policy decoded through shared strict DTOs; curation and existing metadata schema suites passed 4 tests.
- Real v14/v16 upgrade, failed migration rollback, lease expiry without sweeper, immutable receipts/events, optional evidence, frozen pages, scope/TTL/tamper rejection, bounded snapshot capacity, operation intent replay and corrupt-backup rejection are tested.
- Typecheck, build and format:check passed. HTTP, inventory scheduling, fresh-file serialization and automation mutation admission remain assigned to subsequent Steps; these are internal storage primitives.

No UI/localization/Gallery change. DOC_SYNC and ACCEPTANCE_SYNC complete; no new acceptance IDs. Fixtures own and clean their temporary databases. Rulebook postflight `skipped(no_new_lesson)`; no central write/sync.
