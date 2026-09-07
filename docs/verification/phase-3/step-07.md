# Phase 3 Step 07 — Engine lifecycle

Implementation and deterministic verification completed 2026-09-07 on
`yellowgg2/tdd/phase-3/step-07-engine-lifecycle`. The worktree was clean before branch creation.
No project commit/push or deployment was performed.

## Implementation

- Added `engine/{engine-store,updater,provider,scheduler}.ts`, schema migration
  `007-engine-lifecycle.sql`, and expanded the engine repository.
- Added synthetic standalone self-update fixture and isolated SQLite/filesystem/process tests.
- Worker acquisition accepts a cancellation signal, retains its selected version, and releases
  the engine after processing/cleanup or a late acquisition result. Existing Engine fixtures
  remain compatible through an optional release callback.
- Import availability preserves usable active fallback after update failure. No shared wire
  DTO, browser feature flag, product UI, existing gonic/bot/native tree or stored music changed.
- Updated existing schema-version assertions to v7; unchanged historical verification reports
  still describe the schema at the time of their original Step.
- Detailed lifecycle/state/time/backup/retention contract: `docs/architecture/engine-lifecycle.md`.

## Commands and results

Cwd: `/Users/incredibleyoung/Documents/code/musiclatte-server`.
Session-local PATH: `~/.cache/musiclatte-toolchain/node-v24.20.0-darwin-arm64/bin`.
Node **24.20.0**, npm **11.19.0**, TypeScript **7.0.2**, Vitest **5.0.0**;
manifests, lockfile, `.nvmrc` and `.node-version` agree. Host globals unchanged.
`npm run format` preceded verification; no vault/generated/private files were formatted.

| Stage                                  | Exact command                                                                                                                                                           | Result / exit                                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Initial RED                            | `npm run test:unit -- apps/api/test/engine-lifecycle.test.ts apps/api/test/import-worker.test.ts`                                                                       | 3 intended assertion failures / 40 passes, exit 1: never_checked and missing success/error release |
| Capability RED                         | `npm run test:unit -- apps/api/test/import-api.test.ts`                                                                                                                 | 1 intended availability assertion failure / 10 passes, exit 1                                      |
| Timeout RED                            | `npm run test:unit -- apps/api/test/import-worker.test.ts -t 'late engine acquisition'`                                                                                 | 1 intended aborted-signal assertion failure, exit 1                                                |
| Missing-pointer RED                    | `npm run test:unit -- apps/api/test/engine-lifecycle.test.ts -t 'refuse reseeding'`                                                                                     | 1 intended unexpected-reseed assertion failure, exit 1                                             |
| Durability RED                         | `npm run test:unit -- apps/api/test/engine-lifecycle.test.ts -t 'durability failure'`                                                                                   | 1 intended unexpected-success assertion after atomic rename/directory fsync fault, exit 1          |
| Final affected unit                    | `npm run test:unit -- apps/api/test/engine-lifecycle.test.ts apps/api/test/import-worker.test.ts apps/api/test/import-storage.test.ts apps/api/test/import-api.test.ts` | 97 passed / 4 files, exit 0                                                                        |
| Full unit                              | `npm run test:unit`                                                                                                                                                     | 471 passed / 35 files, exit 0                                                                      |
| Full contract                          | `npm run test:contract`                                                                                                                                                 | 116 passed / 16 files, exit 0                                                                      |
| Focused deployment/workspace contracts | `npm run test:contract -- tests/contract/deployment.test.ts tests/contract/workspace.test.ts`                                                                           | 9 passed / 2 files, exit 0                                                                         |
| Types                                  | `npm run typecheck`                                                                                                                                                     | Exit 0                                                                                             |
| Build                                  | `npm run build`                                                                                                                                                         | Exit 0                                                                                             |
| Format                                 | `npm run format:check`                                                                                                                                                  | Exit 0                                                                                             |
| Whitespace                             | `git diff --check`                                                                                                                                                      | Exit 0                                                                                             |

The full unit suite emits existing jsdom HTMLMediaElement load/pause “Not implemented” diagnostics; player tests pass. No browser playback claim is inferred.

No import, collection or compile failure was counted as RED. An initially missing hang behavior
in the synthetic fixture was corrected before accepting timeout verification; it was not a
production regression. All tests use synthetic source IDs and executables, real temporary files
and real SQLite; actual nightly/network behavior is not inferred from these fixtures.

## Verified matrix

- First seed, pinned hash refusal, repeated initialization, missing-pointer fail-closed behavior.
- Real copied self-update with active bytes unchanged, no-update, corrupt/empty/symlink/unsafe
  mode/invalid-version candidate, dependencies, altered persisted hash and timeout cleanup.
- 23:59:59.999 / 24:00:00, restart, many missed intervals, two connections racing a check,
  stale token denial and actual asynchronous stale-result cleanup.
- Pending candidate survives restart; no-source acquire keeps it pending. Matching source probe
  activates; failed source probe and ID mismatch use active for the same worker item. Invalid
  source input cannot consume a candidate; cancellation preserves it for another item.
- Atomic replacement write failure keeps old manifest; committed-pointer/DB mismatch and actual
  SQLite projection failure recover on restart. A narrow real-fs fsync fault after rename verifies that the visible commit is projected and durability uncertainty is surfaced rather than reported as old-active fallback. Previous restore, damaged previous refusal,
  immutable leases across activation, original-version worker completion and event preservation.
- Worker release after success/error, timeout/late result, cancellation race, crash/recovery;
  process termination precedes normal staging cleanup/release. Candidate install bytes and
  directories are synced before a durable candidate receipt.
- v6 migration preserves active/previous/timestamps and safely drops an unverifiable v6 candidate;
  validated online backup/offline DB restore preserves v7 pending state with matching engine root.
- Whole-suite checks cover API readiness, media/player/library/playlist/registration and existing
  deployment/SPA/API-origin contracts. Source/update diagnostics are never persisted as raw text.

## Gates and ownership

| Gate                               | Status                                                                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| BRANCH_SETUP / PROJECT_DOC_CONTEXT | Complete; Step/overview and vault media/deployment contracts read; vault excluded from code Git                               |
| LESSONS_CONTEXT                    | Skipped: successful project lookup, no directly applicable compatible safeguard                                               |
| RED / GREEN                        | Complete; intended assertions and final focused verification above                                                            |
| PROJECT_SETUP                      | Skipped: existing pinned runtime/dependencies sufficient                                                                      |
| REFACTOR                           | Complete: final durability/cleanup review, shared failure classification and bounded operation ownership                      |
| LOCALIZATION                       | Actual ko/en registry; no new visible copy; 271 matching nonempty keys, placeholder mismatch 0; full-suite locale checks pass |
| UI / Chrome / Gallery              | Not applicable, server-only diff; no component changes, baseline approval or review debt                                      |
| MANUAL_UI_TEST                     | Not required for this Step; Compose/seed provisioning and live nightly/source tests remain Steps 09/14                        |
| DOC_SYNC                           | Step, Phase overview, media/deployment vault contracts plus repo architecture/evidence synchronized                           |
| LESSONS_LEARNED                    | `yk-rulebook-reconcile mode=postflight`: `skipped(no_new_lesson)`; no canonical write/sync or pending candidate               |
| GATE_CHECK                         | Complete; no pending/user-confirmation gate                                                                                   |

The update_plan tool was not exposed; session updates and this matrix track the gates. No local
lesson fallback/outbox was created. The central search returned no directly relevant compatible
engine safeguard; no central rule was applied. New fixes were bounded low-cost TDD work and did
not qualify for capture. The Rulebook data repository required no sync.

Test teardown closes DB connections and removes owned temporary files; bounded runners reap
owned child process groups. No SSH server, browser tab or persistent dev process was started.
Runtime version files deliberately have no automatic online GC; see the retention contract.

The whole unit suite was rerun after the final directory-fsync regression; unchanged full contracts remain supported by the 116-test run.
