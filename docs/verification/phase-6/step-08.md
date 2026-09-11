# Phase 6 S08 — automation metadata jobs and absence evidence

Implementation complete; direct UI acceptance not applicable. Base `0e8af26`; branch `yellowgg2/tdd/phase-6/step-08-automation-writes`.

The existing metadata-jobs route accepts a closed automation envelope with claim identity/generation/purpose and bounded notes. PATs require that envelope; legacy session payloads retain their original validation and response. Explicit session automation is supported through the same claim checks. Dry-run uses the real Python tag patch logic in memory, returns field-specific before/after and no-change, and creates no job, backup, operation receipt, attempt or completion. Cover comparisons use private content identity internally; public diffs never expose digests or host paths.

Admission retains the shared file fences through fresh file inspection, current authority and short transaction checks. Valid targets enter the existing P4 job; rejected targets remain typed admission rows with null item IDs. Zero accepted targets return 422 with a null job. One transaction records the existing job and curation operation/admission receipt. Current credentials and immutable intent govern replay; accepted work is authorized by the existing encrypted grant after token revocation/claim expiry. Only an associated succeeded job advances that claim's exact matching revision baseline. File-saved remains pending reflection, never succeeded or completed.

Optional attempts require current scope, purpose, generation and fresh supported MP3 evidence under the fence. A present field cannot be marked absent. Attempts write evidence/history only. The ordinary metadata client accepts strictly decoded automation job detail while preserving its legacy job view. No new layout, Gallery or localized product surface.

## Verification

- RED: automation tests failed with 403 and attempt tests with 404 before route/service implementation.
- Actual MP3 tests: original USLT insertion preserves other lyrics, all unrelated tags, cover frames and packet hash; accepted work finishes file publication after token revocation/lease expiry. Explicit album clear preserves other tags/audio, successful own-job baseline permits renewal, missing-album attempt replays once without changing bytes, and completed receipt is preserved.
- Authentication during admission rejects a token revoked at the file-validation boundary before any job is created. Read/curation-only and lyrics-scope omissions reject writes. Session automation regression exposed nested session lookup; the lookup now participates in the outer transaction with unchanged expiry/revocation checks. Session-storage producer suite plus automation consumer: 17 tests passed.
- Focused automation/attempt/helper/legacy API/principal/claim/web-state unit suites: 34 tests passed. HTTP automation preview/admission/poll/null-job strict decoder plus legacy metadata contracts: 5 passed.
- Typecheck/build/format:check passed under the pinned toolchain. Temporary files, app listeners and shared-fence child processes are cleaned by test fixtures.

Actual gonic reflection/deployment runtime remains S10-owned; the file-write test deliberately asserts file_saved, and the own-job baseline test labels synthetic index reflection explicitly. Completion endpoint remains S09-owned. DOC_SYNC/ACCEPTANCE_SYNC complete. Rulebook postflight `skipped(no_new_lesson)`; no central changes. Gitignore adds no new exclusions.

## Follow-up — ID3 claim cleanup (2026-09-11)

`tools/id3-organize-client.ts` now releases its one-song claim in a `finally` block after metadata
submission. The release accepts an empty 204 response and retries once when the response is lost.
Contract coverage fixes the success and rejected-submission call order; the API worker regression
proves that an already admitted job still writes safely after immediate claim release.

Focused verification: curation/automation unit suites 11 tests and claim/automation/ID3 contract
suites 8 tests passed under Node 24.20.0 and npm 11.19.0. Typecheck and production build passed.
