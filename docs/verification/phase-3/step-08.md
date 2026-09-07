# Phase 3 Step 08 — Engine management API

Completed 2026-09-07 on `yellowgg2/tdd/phase-3/step-08-engine-api`, created from clean main.
No project commit/push, deployment or live music mutation was performed.

## Implementation

- Added strict public engine contracts, GET/POST route and the policy/availability service.
- Added additive schema v8 mailbox and worker-only intent consumer. API uses the existing
  `AuthOptions.imports`/configured runtime database-policy-clock boundary.
- Extended provider restore with an optional pinned pair; existing direct callers are compatible.
- Added replay protection across worker crashes, running lease preservation, current-role and
  late session/policy checks, failed-previous recovery state and capability revision changes.
- Updated schema-version/table assertions. No web/native/gonic/bot feature implementation changed.
- Exact protocol, daily check semantics, safety limits and deployment handoff:
  `docs/architecture/engine-api.md`.

## Toolchain and verification

Cwd: repository root `/Users/incredibleyoung/Documents/code/musiclatte-server`.
Session PATH: `~/.cache/musiclatte-toolchain/node-v24.20.0-darwin-arm64/bin`.
Node 24.20.0, npm 11.19.0; project TypeScript 7.0.2 / Vitest 5.0.0. No host toolchain replacement
or dependency installation. `npm run format` ran before verification.

| Stage / command                                                                                                                     | Evidence                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial `npm run test:unit -- apps/api/test/engine-api.test.ts`                                                                     | 22 intended failures: missing route/capability producer; exit 1                                                                                         |
| Initial `npm run test:contract -- tests/contract/engine-api.test.ts`                                                                | 1 intended missing-schema failure, 1 pass; exit 1                                                                                                       |
| RED typecheck and build                                                                                                             | Both exit 0; no collection/type/compile failure used as RED                                                                                             |
| Worker RED: `npm run test:unit -- apps/api/test/engine-api.test.ts apps/api/test/engine-requests.test.ts`                           | 6 missing-consumer assertions; a separate bare-query injection fixture was corrected to real HTTP because injection normalizes a trailing question mark |
| Review RED: `npm run test:unit -- apps/api/test/engine-api.test.ts`                                                                 | 2 intended failures: known-failed previous recovery and stale probe-time role                                                                           |
| GREEN `npm run typecheck` / `npm run build`                                                                                         | Both pass, exit 0                                                                                                                                       |
| Affected unit scope below                                                                                                           | 190 tests collected; one historical expected table list updated for v8; final full suite covers all 190                                                 |
| `npm run test:unit -- apps/api/test/session-storage.test.ts`                                                                        | 13 pass after v8 expected-table update; exit 0                                                                                                          |
| `npm run test:contract -- tests/contract/engine-api.test.ts tests/contract/capabilities.test.ts tests/contract/login-shell.test.ts` | 32 pass; exit 0                                                                                                                                         |
| `npm run test:unit`                                                                                                                 | 502 pass in 37 files; exit 0                                                                                                                            |
| `npm run test:contract`                                                                                                             | 118 pass in 17 files; exit 0                                                                                                                            |
| `npm run format:check` / `git diff --check`                                                                                         | Required final checks; results verified before completion                                                                                               |

Affected unit command:

```sh
npm run test:unit -- apps/api/test/engine-api.test.ts apps/api/test/engine-requests.test.ts apps/api/test/engine-lifecycle.test.ts apps/api/test/auth-api.test.ts apps/api/test/import-storage.test.ts apps/api/test/session-storage.test.ts apps/api/test/import-worker.test.ts apps/api/test/gonic-registration.test.ts apps/api/test/backup-restore.test.ts
```

The full suite emits existing jsdom HTMLMediaElement load/pause diagnostics; tests pass. Synthetic
subprocesses and real loopback HTTP/SQLite exercise the boundaries without live music or accounts.
Tests cover enabled/disabled/two-account/role changes, 401/403/400/409/503, cookie CSRF/Origin,
extra/forged fields, read-only projection, coalesced requests across connections, daily failed-check
budget, pinned restore/replay, corrupt previous, stale claims, unchanged running bytes,
manifest-commit recovery, v7 migration and v8 backup/restore. Existing login, player, playlist,
imports and gonic contract regression suites pass.

## Gates

| Gate                          | Result                                                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| BRANCH_SETUP                  | Complete; clean main to Step 08 branch                                                                                                    |
| PROJECT_DOC_CONTEXT / ANALYZE | Step, Phase overview, capability/route contracts and actual runtime symbols verified; Serena used                                         |
| LESSONS_CONTEXT               | Rulebook search succeeded; 3 results dropped as not directly relevant (bulk result identity, deployment Node alignment, HTML audio retry) |
| RED / GREEN                   | Complete; assertion failures followed by passing implementation and regression evidence                                                   |
| PROJECT_SETUP                 | Skipped; existing toolchain, dependencies and synthetic fixtures sufficient                                                               |
| REFACTOR                      | Reviewed boundaries; existing import runtime and CSRF/session/error helpers reused; no further behavioral refactor needed                 |
| LOCALIZATION                  | ko/en registry; 271 matching nonempty keys, no new copy, placeholder parity covered by full unit suite                                    |
| UI / Chrome / Gallery         | Not applicable; no UI diff, consumer remains false, review debt 0                                                                         |
| MANUAL_UI_TEST                | Not required; actual deployed timer/nightly/network validation belongs to Steps 09/14                                                     |
| DOC_SYNC                      | Step, Phase overview, capability/route vault evidence and repo architecture/report synchronized                                           |
| LESSONS_LEARNED               | `yk-rulebook-reconcile mode=postflight`: skipped(no_new_lesson); routine bounded fixes do not meet high-cost capture eligibility          |
| GATE_CHECK                    | Complete after final formatting/diff verification; no user confirmation pending                                                           |

No update_plan tool was exposed; session updates and this matrix track the gates. Rulebook
postflight context is project `musiclatte-server`, Node 24.20.0/npm 11.19.0/TypeScript 7.0.2/
Vitest 5.0.0. Search/prepare/add availability was checked. No central write, re-search, sync,
local lesson fallback or pending candidate was needed.

Test cleanup closes owned apps, loopback servers and SQLite connections, removes temporary
fixtures, and reaps owned bounded child processes. No persistent dev server, browser tab or SSH
session was started. Obsidian files remain outside repository commits.
