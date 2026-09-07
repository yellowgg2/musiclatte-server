# Phase 3 Step 04 verification

Date: 2026-09-07. CWD: repository root.
Branch: `yellowgg2/tdd/phase-3/step-04-gonic-registration`.
Runtime: session-local Node **24.20.0**, npm **11.19.0**; pinned project Vitest/Prettier.

## Result and gates

Published items now register by exact gonic relative path through an optional worker runtime
injection. Public scan status/getSong and worker-only directory projection are implemented.
Schema v5 adds durable registration attempts and cycle scheduling, preserving v4 mappings.
See [architecture](../../architecture/gonic-registration.md) for source links, API details,
full-scan limitations and runtime ownership.

| Gate                  | Result                                                                                                                                                                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BRANCH_SETUP          | Clean main; Step branch created before reading Step body or repo writes                                                                                                                                                                                          |
| PROJECT_DOC_CONTEXT   | Selected Step, Phase overview, route/Subsonic contract and Step 03 evidence resolved; external Obsidian files excluded from repo Git                                                                                                                             |
| ANALYZE / CHECKLIST   | Serena project activation/symbol analysis and Sequential Thinking completed; update_plan tool unavailable, gate state tracked in session and this table                                                                                                          |
| LESSONS_CONTEXT       | Central project search succeeded; three returned rules were not directly relevant to this change, so none selected                                                                                                                                               |
| RED                   | Client method absence: 1 intentional assertion failure; registration service absence: 8; worker runtime injection and explicit batch outcomes: 1 each. Initial fixture transition error was corrected before accepting service RED. Initial RED typecheck passed |
| GREEN / REFACTOR      | Exact scan/path matching, durable retry, atomic ready, worker injection implemented; typed fixtures and registerPending/runOnce batch contract consolidated                                                                                                      |
| UI / Gallery / Chrome | Not applicable: no React/UI/copy/token/component/route changes; approved baseline untouched; review debt 0; no browser resources                                                                                                                                 |
| LOCALIZATION          | KO/EN in apps/web/src/i18n unchanged; new visible keys 0; full unit locale completeness/parity tests pass                                                                                                                                                        |
| DOC_SYNC              | Selected Step, Phase overview, route/Subsonic contract, registration/worker architecture and this evidence synchronized                                                                                                                                          |
| LESSONS_LEARNED       | yk-rulebook-reconcile mode=postflight: skipped(no_new_lesson). Fixes were local fixture/type/schema-expectation corrections, with no high-cost reusable new lesson. No canonical write, re-search or Rulebook sync required                                      |
| GATE_CHECK            | Required gates passed; no manual user confirmation needed for Step 04; live tests remain their explicit Step 14 owner                                                                                                                                            |

## Commands

All commands ran at repository root with the session-local toolchain directory prepended to PATH.

| Command                                                                                                                                                                                                              | Result                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `node --version`, `npm --version`                                                                                                                                                                                    | v24.20.0 / 11.19.0; exit 0                                                    |
| `npm run test:unit -- apps/api/test/gonic-registration.test.ts apps/api/test/subsonic-client.test.ts apps/api/test/import-worker.test.ts apps/api/test/session-storage.test.ts apps/api/test/import-storage.test.ts` | 123 tests / 5 files passed, exit 0                                            |
| `npm run test:unit`                                                                                                                                                                                                  | 381 tests / 32 files passed, exit 0                                           |
| `npm run test:contract`                                                                                                                                                                                              | 111 tests / 14 files passed, exit 0; includes Subsonic/gateway/library parity |
| `npm run typecheck`                                                                                                                                                                                                  | All workspaces and test sources passed, exit 0                                |
| `npm run build`                                                                                                                                                                                                      | All workspaces built, exit 0                                                  |
| `npm run format`, `npm run format:check`                                                                                                                                                                             | Project formatting applied and checked, exit 0                                |
| `git diff --check`                                                                                                                                                                                                   | Passed, exit 0                                                                |

The initial full unit run passed 379/380 and found the old session-storage table inventory expected
v4. Updating the inventory to include both additive tables and adding explicit v4→v5 pending-link
preservation coverage resolved it. Initial auth harness scenario placement and backup helper
signature mistakes were corrected and focused tests/typecheck rerun; neither was accepted as RED.
Existing non-failing JSDOM HTMLMediaElement diagnostics were not hidden or converted into skips.

## Observed evidence

- Two equal-title files become distinct song-a/song-b mappings by path; a trace proves one start,
  one configured-folder indexes request and only user/channel directories for the ordinary batch.
- Existing scanning status skips start entirely. Delayed leaves become visible in fresh bounded
  rounds. Paths using `./` and repeated separators normalize; title changes do not affect identity.
- Admin 50, continuous scanning timeout, HTTP 503, stalled body, zero/two leaf matches, duplicate
  root/branch names, case mismatch, out-of-config root, absolute/backslash/NUL/traversal paths all
  retain registering and preserve the event/pending mapping. Durable next-attempt blocks immediate
  retry after DB reopening; later valid evidence becomes ready without a second event.
- Concurrent service instances cannot overlap the local cycle. Cancelled work stays pending;
  expired-owner late responses cannot modify the resumed worker's finalized mapping/revision.
- A trigger rejecting event registration proves mapping/revision/time rollback, while a successful
  sibling independently becomes ready. Replaying finalized work makes no upstream calls.
- v4 pending mapping survives additive migration to v5 unchanged. Backup/restore retains attempts;
  existing session/storage/worker regression coverage verifies the expanded schema.
- Current-account getSong trace uses the listener proof, while registration/status use the fixed
  synthetic worker identity. Song JSON omits private path and a missing ID remains not_found.
  Malformed status/song/directory payloads fail strict decoding. Default read-only fake still denies
  startScan, and management scan permission parity remains in the unchanged auth contracts.
- Worker runtime injection completes a synthetic published file after restart with one engine
  acquisition, one music file and one event. No production credentials or session dependency enters
  the registration service.

## Cleanup and boundaries

Temporary HTTP servers, SQLite connections, media/process fixtures, timers and listeners were closed
by test teardown. Gateway contract containers/networks were managed by their existing harness.
No Chrome tabs, dev servers, SSH probes, live music CRUD, production deployment or DNS changes.
No existing service/volume/native/bot tree was modified. No package installation or global Node change.

The default 120-second cycle / 1-second poll / 30-second initial backoff is synthetic-fixture policy;
real library timing, asynchronous upstream scan failure limits and end-to-end Musiclatte behavior
remain Steps 13–14. No project commit/push was performed. Obsidian edits remain outside repository
commits; Rulebook data repository was unchanged.

## S14 owner regression — 2026-09-07

S14-B01: omitted zero scan count compatibility; RED3/69, GREEN69+worker46, contract55, fresh empty real gonic ready/event/link1 without manual scan.

See [S14 evidence](step-14/README.md). No commit/push.
