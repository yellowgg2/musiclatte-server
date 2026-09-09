# Phase 6 S09 — verified completion and reopen

Implementation complete; direct UI acceptance not applicable. Base `229a5bc`; branch `yellowgg2/tdd/phase-6/step-09-curation-completion`.

Complete and reopen accept closed requests with current curation-write authority and scoped editable libraries. Completion retains the shared file fence across MP3 helper read, opaque revision/binding/audio identity, required title/artist projection against authenticated getSong, authority revalidation and final digest/inode/ctime inspection. Short transactions recheck authority, generation, policy and unresolved publications before atomically writing the immutable receipt, history, current state and replay result. Completed targets consume only their own reservation item, preserving other batch targets. Same-request replay returns the same receipt before lease/revision checks.

Queued/file-save/reflection/recovery work blocks completion with typed reasons. Interrupted P3 publications also block curation while retaining the owner's recovery route. A pre-publication failure can be resolved only by explicit successful file/index verification of its unchanged original revision/digest; an event records that the failed intent was not applied. Required values alone never trigger automatic completion. Explicit reopen preserves history and requires fresh revision/conflict checks. Previously completed optional-only changes return the original receipt after verification; a changed policy projects needs_review/stale immediately.

Shared verified observations now store field fingerprints together with field evidence. This prevents a subsequent inventory pass from forgetting a newly recorded unchanged absence attempt. S08's public workflow regression verifies attempt persistence. metadata.curation is supported only with configured routes/repository/fence, while availability also requires the worker/inventory readiness callback (S10 wiring). Existing lyrics-write capability is preserved.

## Verification

- RED: new completion tests executed with missing routes (404).
- Focused completion/publication-race/reconciliation/storage/attempt unit suites: 16 tests passed; completion suite expanded to 7 tests with interrupted P3 coverage. Claim/publication regressions passed after the final fencing integration.
- Actual HTTP token→policy/list→claim→dry-run→real MP3/P4 job→complete→optional lyric clear→missing query→absence attempt→inventory→receipt preservation roundtrip plus query/capability contracts: 29 tests passed. Synthetic index reflection is explicitly labeled; actual gonic runtime belongs to S10.
- Cases include unchanged completion without jobs, retry after expiry, altered-intent conflict, forged actor rejection, policy/stale revision/index mismatch, simultaneous completion, missing actual title despite index fallback, pending jobs, safe pre-publish failure resolution and an external byte change at final fence validation. No receipt commits on the mutation race.
- Pinned typecheck/build/format:check passed. Test listeners/process fences/temporary fixtures are cleaned.

DOC_SYNC/ACCEPTANCE_SYNC complete. Existing paged curation detail provides completion history. Rulebook postflight `skipped(no_new_lesson)`, no central changes. Runtime activation and deployment validation remain S10-owned; final UI acceptance remains separate.
