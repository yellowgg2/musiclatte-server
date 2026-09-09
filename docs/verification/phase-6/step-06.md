# Phase 6 S06 — authenticated curation reads

Implementation complete; direct UI acceptance not applicable. Base `69ca880`; branch `yellowgg2/tdd/phase-6/step-06-curation-read-api`.

`GET /api/v1/metadata-policy`, `/api/v1/tracks` and `/api/v1/tracks/:id/curation` accept authenticated session/PAT metadata principals when curation limits are configured. Each request checks current upstream identity/library scope before and after projection. List and detail never perform file/helper/getSong traversal. Filters are closed, one-field combinations are enforced, and missing-lyrics aliases preserve independent completed state. Credential-bound frozen pagination, strict shared response decoders, scoped history cursors, coverage, active claim/work summary and immutable receipt revision are exposed without private paths/digests/proofs.

Completion capability remains unadvertised until S09. Runtime activation remains S10-owned. Snapshot expiry/scope/capacity errors have matching nonempty KO/EN messages; no UI layout or Gallery surface changes.

## Verification

- RED: both new API tests executed and failed with 404 before route registration.
- GREEN: curation and access-token unit suites passed 9 tests. Follow-up scope-isolation test rerun passed both curation tests.
- Actual HTTP contract test plus existing metadata API contract: 5 passed. Strict decoders reject extra fields and false success claims.
- Tested authenticated policy, completed+missing lyrics and equivalent explicit field filter, malformed/conflicting queries, history paging, session/PAT parity, missing authentication, unauthorized track exclusion, frozen count during mutations, credential/filter changes, tampering and expiry. Upstream request observations confirm no file-discovery fan-out.
- Typecheck/build/format:check passed under pinned Node 24.20.0/npm 11.19.0. Typecheck caught the shared API error localization dependency; both languages were updated together.

DOC_SYNC/ACCEPTANCE_SYNC complete. Test apps/listeners and temporary stores are cleaned. Rulebook postflight `skipped(no_new_lesson)`, no central write/sync. Snapshot restore/epoch invalidation remains covered by S03 storage tests.
