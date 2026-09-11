# Phase 9 Step 03 verification

- RED: organization state/repository modules and migration 023 did not exist.
- GREEN: schema v23, the ordered state machine, immutable intent replay, generation leases,
  baseline/reference checkpoints, source-location binding, encrypted accepted grants, and offline
  restore classification were implemented.
- Unit: `organization-storage.test.ts`, `organization-state.test.ts`, and
  `metadata-backup.test.ts` — 10/10 passed.
- Contract: `metadata-deployment.test.ts` — 2/2 passed; migration 023 declares all private tables
  and no public organization route is enabled.
- Recovery: revoked-token accepted work remains claimable; restore clears token/grant credentials,
  finishes the interrupted attempt, and maps a moved item to filesystem-owned
  `recovery_required`.
- Storage privacy: assertions exclude raw PAT, proof, lyrics/media payloads; source evidence is
  bounded structured metadata only. Organization events reject mutation and deletion.
- UI, Gallery, localization, browser, filesystem rename, and gonic checks: not applicable to this
  storage-only Step.
- Rulebook: runtime/deployment alignment remains satisfied; postflight is
  `skipped(no_new_lesson)`.

Final gates: project formatting, focused unit/contract tests, typecheck, build, `format:check`, and
`git diff --check`.
