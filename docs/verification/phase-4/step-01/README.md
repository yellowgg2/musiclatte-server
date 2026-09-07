# Phase 4 Step 01 — metadata contracts and ledger

Implemented and verified 2026-09-08 with Node 24.20.0 / npm 11.19.0 from the session-local
toolchain. Cwd: this repository root. Phase 3 final device/cleanup evidence was confirmed before
implementation. Branch: `yellowgg2/tdd/phase-4/step-01-metadata-contract-ledger`.

## Implementation

- Strict patch/request/public snapshot/job/item contracts and decoders; existing disabled
  metadata capability keys and generic API errors are reused.
- Additive schema v9: jobs, items, attempts, canonical file locks, backup manifests, cover
  uploads, indexed monotonic change events and independent worker heartbeat.
- Transactional operation replay, binding checks, cross-account file claims, lease-generation
  fencing, legal stage transitions, backup receipts, failed-only child jobs and scoped restore
  lineage.
- Snapshot validation checks metadata relationships and receipts; real v8 migration preserves
  numeric MediaLink revision and import rows without creating download events.
- Updated current-schema expectations in existing migration tests. Historical fixtures and
  existing assertions for session, engine and import data preservation remain intact.

## Verification

RED: missing schema v9, missing wire contracts/decoders/repository operations and accepted
tampered backup ownership produced assertion failures. New public contracts were built before
repository tests consumed the workspace package; stale dist output was corrected by the normal
project typecheck/build. No environment failure is counted as behavior RED.

| Command                                                                                                                                                                                                                                                                                          | Result                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| `npm run format`                                                                                                                                                                                                                                                                                 | exit 0 before verification   |
| `npm run test:unit -- apps/api/test/metadata-storage.test.ts apps/api/test/backup-restore.test.ts apps/api/test/import-storage.test.ts apps/api/test/session-storage.test.ts apps/api/test/gonic-registration.test.ts apps/api/test/engine-requests.test.ts apps/api/test/import-worker.test.ts` | 110 passed, 7 files, exit 0  |
| `npm run typecheck`                                                                                                                                                                                                                                                                              | exit 0                       |
| `npm run test:unit`                                                                                                                                                                                                                                                                              | 577 passed, 43 files, exit 0 |
| `npm run test:contract`                                                                                                                                                                                                                                                                          | 134 passed, 21 files, exit 0 |
| `npm run build`                                                                                                                                                                                                                                                                                  | exit 0                       |

The repository test uses two real SQLite connections and a deterministic clock. It observes
identical replay, different-body conflict, cross-account exclusion, expired-owner fencing,
failed-only retry, saved receipt preservation, scoped restore lineage and DB+key reopen. The
backup owner tampering test failed before metadata validation and passes after it. Contract
tests use Fastify's strict JSON-schema input validation independently of public decoders.
All test files/data are synthetic and temporary resources are cleaned by their harnesses.

## Gate scope

No UI diff, browser gate, Gallery change or review debt. No new localized strings; existing KO/EN
parity remains covered by the complete suites. No actual music, credentials, private backups,
remote server mutations or deployment were needed for this storage step. File writer, real OS
locks, actual MP3 roundtrip and live reflection are subsequent step owners and are not claimed.

Rulebook project lookup succeeded; returned rules were not directly applicable or lacked
compatible evidence for this storage change, so none were selected. Postflight:
`skipped(no_new_lesson)`; routine version expectations/import build order do not warrant a new
lesson. No central YAML write or sync. Refactor limited to shared validation/projection helpers.

Plan/spec/contract documentation is synchronized in the external vault, which is excluded from
this repository's commits. The user's continuous-execution instruction authorizes the separate
Git handoff after this TDD gate.

Final `npm run format:check` after documentation sync: exit 0.
