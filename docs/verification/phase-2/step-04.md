# Phase 2 Step 04 verification

Date: 2026-09-05

## Delivered behavior

- Added strict create, rename, append, occurrence remove, reorder, and delete playlist BFF contracts and routes.
- Added account/playlist keyed single-process serialization, durable operation receipt consumption, no-write replay, and exact post-write reconciliation.
- Preserved gonic as the only playlist-content source of truth. Remove and reorder use one full ordered replacement and never use `songIndexToRemove`.
- Activated the server `playlists.write` capability while leaving web client features and favorites disabled.
- Added stable `conflict` and `outcome_unknown` codes with matching, nonempty KO/EN messages.

## RED evidence

Before production routes and services existed, the focused unit run executed 44 tests: 34 existing tests passed and all 10 new mutation scenarios failed with the absent-route `404`. The focused contract run executed 30 tests: 28 existing tests passed and the two new mutation/capability assertions failed. An error-mapping assertion also verified that the absent route had not accidentally performed an upstream write.

Additional focused RED cycles reproduced and then fixed:

- replay of a terminal failed delete returning `500` instead of stable `409 outcome_unknown`;
- a queued request whose session was logged out returning a playlist conflict instead of `401`;
- an over-255-code-point rename inside the action union returning `400` instead of the contract `422`.

## Automated coverage

The source-shaped fake covers the full create → rename → append duplicate → remove the selected occurrence → reorder → delete path, including rereads and no-write applied replay. It also covers native bearer separation, strict JSON/query/body/name validation, stale revisions, wrong occurrence pairs, non-owner resources, same-revision races, logout while queued, response loss, pending receipt restart, request disconnect, operation ID reuse, post-write mismatch, deterministic upstream 10/50/70, failed receipt replay, and timeout uncertainty.

Repository backup/restore and the pre-existing authentication, capability, library, media, and player suites remain in the broad regression runs. No live devserver mutation, source-media access, UI work, Chrome review, commit, push, or deployment was performed in this Step.

## Runtime and commands

All verification used the project-pinned Node `24.20.0` and npm `11.19.0` by prepending `/Users/incredibleyoung/.cache/musiclatte-toolchain/node-v24.20.0-darwin-arm64/bin` to the existing `PATH`.

```text
npm run format
npm run test:unit -- apps/api/test/playlist-mutations.test.ts apps/api/test/playlist-operation.test.ts apps/api/test/auth-api.test.ts
npm run test:contract -- tests/contract/playlist-api.test.ts tests/contract/capabilities.test.ts
npm run test:unit
npm run test:contract
npm run typecheck
npm run build
npm run format:check
```

Final result: focused unit 49/49 and contract 30/30; complete unit 243/243 and contract 107/107; typecheck, production build, 177-key KO/EN parity/nonempty check, and format check all passed.

Agent Rulebook postflight: `skipped(no_new_lesson)`. The three extra RED corrections were local, directly reproduced contract/guard defects and did not meet the required debugging-cost, token-cost, and recurrence-risk HIGH criteria together; no canonical or project lesson was written.

## Residual boundary

The promise queue is local to one API process. Because gonic has no CAS and native `/rest` writes bypass this queue, a native write between BFF pre-read and upstream mutation cannot be made transactional. The BFF rereads and refuses to claim success when the requested state cannot be proven; it never automatically retries an uncertain operation. Whole-stack gonic plus management-database snapshot/cutover verification remains Phase 2 Step 11 ownership.
