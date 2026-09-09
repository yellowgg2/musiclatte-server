# Phase 6 S07 — expiring curation claims

Implementation complete; direct UI acceptance not applicable. Base `d1a1adb`; branch `yellowgg2/tdd/phase-6/step-07-curation-claims`.

Claim/renew/release routes enforce current credentials, purpose-specific scopes, editable libraries, closed inputs and credential ownership. Durable operation receipts bind canonical intent, survive application recreation and replay before revision/lease checks. Partial batches distinguish granted, missing, stale, busy and pending inventory. Fresh binding/revision checks run under the shared OS fence; renewal holds every acquired fence through generation/auth/lease transaction checks. Leases cannot revive after expiry or clock rollback. Release is owner-idempotent. Required review affects effective status only; optional enrichment preserves completion and receipt.

Legacy metadata preview exposes `claimed_by_other` with matching KO/EN messages, and submit rejects an active claim. P3 publication already consumes the S04 shared claim conflict check. PAT job creation remains disabled until S08. S08 owns adoption of revisions from that claim's accepted successful jobs.

## Verification

- RED: new claim API tests initially executed with 404; integration subsequently exposed nested token lookup transactions. `findByHash` now joins an existing transaction, retaining the final authorization check. Existing token-storage producer tests pass with the claim consumer regression.
- GREEN: claims/storage/token-storage/legacy metadata unit suites: 23 tests; added stale/fence/revocation/concurrent-renew/legacy-submit coverage and application-recreation replay: final claim suite 3 tests passed.
- Real HTTP claim/renew/release strict-decoder contract plus existing metadata compatibility: 5 tests passed.
- Covered partial batches, same-account different PAT ownership, purpose scopes, same operation changed intent, expired replay, generation mismatch, clock rollback, optional completed preservation, file-lock contention and revoked credentials.
- Pinned Node/npm typecheck, build and format:check passed. Test listeners, helper fences and temporary fixture stores are cleaned.

DOC_SYNC/ACCEPTANCE_SYNC complete. No new UI layout or Gallery surface. Rulebook postflight `skipped(no_new_lesson)`. Gitignore inspection adds no exclusions; vault stays outside repo commits.
