# Phase 6 S02 — metadata principals and accepted work

Implementation complete; direct UI acceptance not applicable. Base `fe3403d`; branch `yellowgg2/tdd/phase-6/step-02-metadata-principal`. Autopilot branch-push only; no deployment or main merge.

## Result

P4 uses an explicit session/PAT union and principal checking helpers, preserving account identity HMAC and session mutation behavior. PAT reads, frames, cover uploads and token-owned job detail/list are scope/library/credential constrained; PAT job submit and restore remain denied. Read-only PATs cannot advertise editable metadata.

Migration 016 preserves populated v15 sessions, items, backups, rechecks, file locks and other tables through the item table rebuild. PAT actors have their own FK and encrypted accepted-work grant, without inserting fake sessions. The real worker account path uses grants for token actors and existing session verification for session actors; both retain upstream identity/folder/path/binding checks. Grants bind immutable intent and are discarded after terminal completion, offline restore or policy invalidation. Audit rows remain.

## Verification

Node 24.20.0/npm 11.19.0 from the session-local toolchain; cwd repository root. Formatter ran before verification.

- RED: `npm run test:unit -- apps/api/test/metadata-principal.test.ts` initially failed because PAT preview returned 403 and schema 15 did not have separate actor columns. The new grant test also failed on the missing authorizer before implementation.
- GREEN: `npm run test:unit -- apps/api/test/metadata-principal.test.ts apps/api/test/metadata-api.test.ts apps/api/test/metadata-worker.test.ts apps/api/test/metadata-runtime.test.ts apps/api/test/metadata-storage.test.ts apps/api/test/access-token-storage.test.ts apps/api/test/session-storage.test.ts apps/api/test/backup-restore.test.ts apps/api/test/import-storage.test.ts apps/api/test/gonic-registration.test.ts apps/api/test/import-worker.test.ts apps/api/test/engine-requests.test.ts`: 152/152 passed, 12 files, exit 0.
- `npm run test:contract -- tests/contract/metadata-principal.test.ts tests/contract/metadata-api.test.ts tests/contract/metadata-schema.test.ts`: 8/8 passed.
- `npm run typecheck` and `npm run build`: passed. A missing adapter import found during typecheck was corrected.
- Real synthetic MP3 helper reads, embedded cover/frame and uploaded cover isolation, unchanged legacy submit/detail, admitted-grant revocation survival, changed intent rejection, restored grant invalidation, populated v15 FK graph/value preservation and indexes are covered.
- Existing real file transaction/worker/runtime tests pass. No remote runtime was started for this step. Complete deployed end-to-end automation and publication-fence tests belong to later owner steps.

All fixture processes and temporary directories are cleaned by their owners. No UI, localization or Gallery changes; no new acceptance IDs. DOC_SYNC and ACCEPTANCE_SYNC complete. Rulebook search returned no directly applicable safeguard; postflight `skipped(no_new_lesson)`, no central write/sync. Required gates complete after final format/staged review; final user acceptance is not conflated with these automatic tests.
