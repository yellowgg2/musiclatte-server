# Phase 3 Step 05 verification

Completed 2026-09-07 on `yellowgg2/tdd/phase-3/step-05-imports-api`. No project commit/push.

## Outcome

Implemented strict imports create/list/detail/retry/cancel routes, explicit public projections,
HMAC account/instance handles and library-bound pagination, canonical idempotency/duplicate
admission, and persisted policy/worker/engine capability production. Runtime uses the real
configured database and policy. Schema v6 adds the durable in-flight duplicate reference and
history index; existing worker/registration behavior and media/event retention are preserved.
See `docs/architecture/import-api.md` for the wire and upgrade contract.

## TDD and verification

Cwd: repository root. Session-local Node v24.20.0 and npm 11.19.0, matching AGENTS.md,
.nvmrc, .node-version, package.json and the installed workspace toolchain. No installation or
host runtime change was needed.

| Command                                                                                                                                                                                                                                       | Evidence                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `npm run test:unit -- apps/api/test/import-api.test.ts`                                                                                                                                                                                       | Initial RED: 5 assertion failures (missing routes/disabled producer); final 11 passed                      |
| `npm run test:contract -- tests/contract/import-api.test.ts`                                                                                                                                                                                  | Initial RED: missing schema assertion; final 3 passed                                                      |
| `npm run test:unit -- apps/api/test/runtime.test.ts`                                                                                                                                                                                          | 6 passed, including configured imports runtime                                                             |
| `npm run test:unit -- apps/api/test/import-api.test.ts apps/api/test/import-storage.test.ts apps/api/test/session-storage.test.ts apps/api/test/import-worker.test.ts apps/api/test/gonic-registration.test.ts apps/api/test/runtime.test.ts` | 100 passed at the intermediate focused gate; subsequent imports/runtime tests are included in the full run |
| `npm run test:unit`                                                                                                                                                                                                                           | 393 passed across 33 files; existing jsdom media/scroll not-implemented diagnostics were non-failing       |
| `npm run test:contract`                                                                                                                                                                                                                       | 114 passed across 15 files, including auth/capability/playlist/media/login-shell and production exclusion  |
| `npm run typecheck`                                                                                                                                                                                                                           | Passed                                                                                                     |
| `npm run build`                                                                                                                                                                                                                               | Passed for all workspaces; API build includes schema v6 migration                                          |
| `npm run format:check`                                                                                                                                                                                                                        | Passed after repository-only formatting                                                                    |
| `git diff --check`                                                                                                                                                                                                                            | Passed                                                                                                     |

All successful verification commands exit 0. RED tests collected successfully and failed on
assertions; the RED typecheck passed. The later offline-replay regression first failed on a 503
response and passed after checking existing operation receipts before availability. Temporary
runtime-test fixture corrections (required session lifetime and session-create 201) were setup
fixes, not production RED evidence.

Coverage includes exact body/query/schema checks, body limit, JSON/CSRF/Origin, cookie and bearer
read access, bearer write denial, expiry and final-response revocation, two accounts and libraries,
instance replay, cursor tampering/scope changes/default/max limit, canonical URL aliases,
concurrent duplicate admission, same-batch duplicates, ready MediaLink duplicate, retry source
order and nonfailed rejection, terminal/running cancellation, safe failure projection, persisted
health clocks and configured runtime wiring. Duplicate references survive reopen and backup/restore
with no foreign-key violations. Existing storage upgrade and worker/registration suites pass.

## Gates and scope

- BRANCH_SETUP, PROJECT_DOC_CONTEXT, ANALYZE, RED, GREEN, REFACTOR, LOCALIZATION, DOC_SYNC and GATE_CHECK: complete.
- REFACTOR: removed repeated retry fingerprint calculation; focused tests/typecheck/build preserved.
- LESSONS_CONTEXT: project search succeeded; category-only results and compatibility-unknown projection rule were excluded, leaving no directly applicable compatible rule.
- Postflight `yk-rulebook-reconcile`: skipped(no_new_lesson); no canonical write, index refresh or Rulebook data repo sync required.
- PROJECT_SETUP: skipped; installed pinned toolchain/dependencies were sufficient.
- UI class/action, Gallery/catalog, Chrome Preview, UI_TEST and MANUAL_UI_TEST: not applicable; no UI diff, new shared component or review debt. Existing Gallery approval is unchanged.
- KO/EN: no new visible copy or locale changes; matching nonempty keys and placeholders verified.
- Web imports consumer remains false; `availableEntries` contract proves supported producer alone cannot create an entry.
- Temporary Fastify servers, database connections and fixture directories are closed/removed by test cleanup. No Chrome tabs, devserver processes or live music files were created.
- Actual downloader/gonic/device/deployment verification remains owned by later Steps 09/13/14. No manual confirmation is required for this API Step.
- Vault Step, overview and capability implementation evidence are synchronized outside repository commits.
