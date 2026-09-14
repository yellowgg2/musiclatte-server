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

## 2026-09-14 production contention recovery

- Incident: one pre-rename organization attempt reached terminal `failed` with SQLite writer
  contention, no successor track, and the frozen client journal still bound to the accepted job.
- RED: the organization worker terminalized injected `database is locked`; exact submit replay of a
  legacy contention failure remained `failed` with its accepted grant cleared.
- GREEN: pre-rename contention remains reclaimable, while an exact fully revalidated replay of the
  same legacy job restores its grant and resumes from its durable reference baseline. Changed
  requests, non-contention failures, and successor-bearing jobs remain closed.
- Focused verification: organization worker/runtime/storage/API unit coverage passed 44/44 and the
  metadata organization contract passed 9/9; typecheck, build, formatting, and diff checks passed.
- Deployment: exact `main` commit `d8d545d15954bfb52f912522efe89a51ff4cb34f` was built for and
  deployed to only the production API and metadata worker after an owner-only online management
  SQLite/key backup and import, metadata, and automation policy snapshots. API, metadata worker,
  import worker, web, and Gonic were healthy; live/readiness returned 200 and recreated services had
  zero restarts.
- Resume: exact replay of the preserved operation revalidated and completed the same failed item,
  created its successor, restored both account snapshots (including one playlist occurrence), and
  passed final ID3, one-front-JPEG, and Gonic successor-binding checks. The frozen sweep then
  advanced normally; no replacement intent, direct database edit, or manual file move was used.
