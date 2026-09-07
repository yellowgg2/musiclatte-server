# Phase 3 Step 06 — Recent downloads snapshot API

Completed 2026-09-07 on `yellowgg2/tdd/phase-3/step-06-recent-api`. The worktree was clean
before branch creation. No project commit or push was performed.

## Implementation and contract

- Added `packages/contracts/src/recent.ts`, `imports/recent-service.ts`, and
  `routes/recent-downloads.ts`; connected app/auth runtime/capability registry.
- Added the indexed bounded recent query and append-only insertion fence to the existing
  import repository; schema remains v6 and prior import/player/playlist behavior is preserved.
- Added server-only `recentSong`/`decodeRecentSong`; public MusicEntry/getSong remain path-free.
- Added synthetic P5 response/error fixtures, an actual SQLite/temp-files/HTTP harness,
  42 API tests and 2 wire contract tests. No production UI or web feature flag was changed.
- Architecture and maintenance boundary: `docs/architecture/recent-downloads-api.md`.

## RED → GREEN evidence

All commands below ran from `/Users/incredibleyoung/Documents/code/musiclatte-server` with
session-local Node **24.20.0**, npm **11.19.0**, TypeScript **7.0.2**, Vitest **5.0.0** and Fastify
**5.12.3**. The toolchain was selected by prepending
`~/.cache/musiclatte-toolchain/node-v24.20.0-darwin-arm64/bin` to PATH; host globals were unchanged.
`npm run format` ran before verification.

| Stage                   | Exact command                                                                                                                                                                                                    | Result / exit                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| RED API                 | `npm run test:unit -- apps/api/test/recent-downloads-api.test.ts`                                                                                                                                                | 33 intended assertion failures: absent route 404 and absent producer; exit 1   |
| RED contract            | `npm run test:contract -- tests/contract/recent-downloads-api.test.ts`                                                                                                                                           | 1 expected schema-file assertion failure, 1 consumer-preservation pass; exit 1 |
| RED compilation         | `npm run typecheck` and `npm run build`                                                                                                                                                                          | Both exit 0; no collection/import/compile failure used as RED                  |
| GREEN affected unit     | `npm run test:unit -- apps/api/test/recent-downloads-api.test.ts apps/api/test/gonic-registration.test.ts apps/api/test/library-api.test.ts apps/api/test/import-api.test.ts apps/api/test/auth-runtime.test.ts` | 124 passed / 5 files; exit 0 (before final runtime integration test)           |
| GREEN affected contract | `npm run test:contract -- tests/contract/recent-downloads-api.test.ts tests/contract/library-api.test.ts tests/contract/capabilities.test.ts`                                                                    | 38 passed / 3 files; exit 0                                                    |
| Final focused           | `npm run test:unit -- apps/api/test/recent-downloads-api.test.ts`                                                                                                                                                | 42 passed / 1 file; exit 0                                                     |
| Final broader unit      | `npm run test:unit`                                                                                                                                                                                              | 435 passed / 34 files; exit 0                                                  |
| Final broader contract  | `npm run test:contract`                                                                                                                                                                                          | 116 passed / 16 files; exit 0                                                  |
| Final types             | `npm run typecheck`                                                                                                                                                                                              | Root and all workspaces exit 0                                                 |
| Final build             | `npm run build`                                                                                                                                                                                                  | Contracts/test-support/API/web exit 0                                          |
| Formatting              | `npm run format:check`                                                                                                                                                                                           | Exit 0                                                                         |
| Diff                    | `git diff --check`                                                                                                                                                                                               | Exit 0                                                                         |

The full unit suite emits existing jsdom HTMLMediaElement load/pause “Not implemented” diagnostics;
all player tests pass. No live browser/media playback claim is inferred from those diagnostics.

## Behavior verified

- Exact fake-clock seven-day default, explicit timezone-converted UTC boundaries, inclusive start,
  exclusive end, invalid calendar dates, unknown/duplicate query, incomplete/reversed/equal range
  and bounded noncoercing limit validation.
- Same-time descending binary event-ID ordering across two libraries; continuation after new
  same-time/backdated insertions has no duplicate/omission. The original default range/asOf stays
  fixed after clock advancement; refresh includes new events. Future ranges still honor asOf.
- HMAC tamper, changed asOf payload, account/filter/library ID and library-root replay rejected.
  Account history isolation, native bearer reads and unauthorized account denial verified.
- Registering and missing entries retain event/time and omit song; ready returns current metadata.
  Missing file, final/parent symlink, nonregular file, path/ID mismatch, missing path, `..` alias,
  gonic 70 and deletion during getSong are covered. History rows remain intact.
- Current-account getSong proof, HTTP 401/403/503/timeout, Subsonic 40/50, safe error redaction,
  401 session revocation and policy revision during the final identity check are covered.
- Default 50/max 100 getSong reads; observed concurrency is at most four. Whole-page timeout and
  cleanup prevent unbounded waiting. Only page entries get availability checks, not the extra row.
- A spy captures the actual prepared recent SQL; EXPLAIN reports
  `SEARCH e USING INDEX download_events_recent` and an import-item primary-key search, with no
  e/i/m table scan. Upstream trace for recent contains only getUser/getSong, zero startScan,
  getIndexes, getMusicDirectory or search3 calls.
- Configured production runtime reads the real synthetic root through `IMPORT_MUSIC_ROOT`, rejects
  relative roots, uses the persisted key/database and returns a ready item through the HTTP route.
- Stopped/uninitialized worker/engine state does not hide historical recent capability; disabled
  policy and disallowed accounts are denied. Existing music/player/API/playlist tests pass.

## Gate check

| Gate                                         | Outcome                                                                                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| BRANCH_SETUP / PROJECT_DOC_CONTEXT / ANALYZE | Complete; selected Step and overview read, vault folder verified, Serena activated                                                |
| LESSONS_CONTEXT                              | Skipped: successful central lookup returned no directly applicable compatible safeguard                                           |
| RED / GREEN                                  | Complete; evidence above                                                                                                          |
| PROJECT_SETUP                                | Skipped: pinned dependencies and runtime already available                                                                        |
| REFACTOR                                     | Skipped: no further behavior-preserving restructuring warranted                                                                   |
| LOCALIZATION                                 | Complete: actual ko/en registry; zero new visible copy, matching nonempty keys/placeholders verified by full workspace unit tests |
| DOC_SYNC                                     | Complete: Step/overview plus media, routes and capabilities vault contracts synchronized; vault outside code Git                  |
| UI / Chrome / Gallery                        | Not applicable: API-only diff, no shared UI/consumer changes or review debt; approved baseline untouched                          |
| MANUAL_UI_TEST                               | Not required; live imports deployment and real devserver/native round-trip remain Steps 09/14                                     |
| LESSONS_LEARNED                              | `yk-rulebook-reconcile mode=postflight`: `skipped(no_new_lesson)`; no canonical write, no Rulebook data repo sync needed          |
| GATE_CHECK                                   | Complete; no user confirmation or pending gate                                                                                    |

The update_plan tool was not exposed in this session; gates were tracked in session updates and
this evidence matrix. No local lesson fallback/outbox was created. Test-owned apps, HTTP servers,
SQLite connections and temporary files were closed/removed by teardown. No live devserver,
browser tab, actual music file, existing service, bot or native app was changed.
