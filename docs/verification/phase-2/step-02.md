# Phase 2 Step 02 — Playlist operation receipt verification

Date: 2026-09-05

## Outcome

Implemented management schema v2 and a durable synchronous playlist operation receipt repository. No HTTP route, Subsonic write, capability, React/UI, playlist content cache, retention cleanup, native source, or live data was added or changed.

## Contract evidence

- `001-session.sql` remains unchanged. `database.ts` applies ordered 0→1→2 and 1→2 migrations under one `BEGIN IMMEDIATE`, then validates the complete v2 shape.
- `002-playlist-operations.sql` defines a STRICT receipt table keyed by identity HMAC and operation ID hash, with request reuse, status, terminal time, and nullable reconciliation metadata constraints.
- `playlist-operation-repository.ts` provides synchronous `claim/get/markApplied/markUncertain/markFailed`. Same-request replay returns the stored receipt, changed request reuse conflicts, and only `pending→applied|uncertain|failed` plus `uncertain→applied` are accepted.
- Receipt rows contain no raw operation ID, playlist name/order/song IDs, credential, or playlist source-of-truth content. Phase 2 performs no automatic receipt deletion.
- SQLite online backup and offline restore preserve receipt status; an applied operation remains an existing claim after restore, while a CHECK-bypassing tampered status makes restore fail before publication.

## TDD evidence

- RED focused: 17 tests ran; 11 existing tests passed and 6 new tests failed only because user_version remained 1 and the receipt repository did not exist. Typecheck passed, excluding collection/import/type failures.
- GREEN focused: 4 files with 26 tests passed, covering fresh v2, real v1 data preservation, atomic migration rollback, pending restart, request collision, identity isolation, valid/invalid transitions, restricted columns, WAL backup, and restored replay.
- REFACTOR kept the production repository type as the test source through the shared storage harness; the same 26 focused tests and the 5-test deployment contract passed.
- `npm run build` copied both `001-session.sql` and `002-playlist-operations.sql` to `apps/api/dist/storage/migrations`.
- Final gate: 18 unit files with 217 tests and 10 contract files with 104 tests passed; typecheck, build, both compiled migration checks, format-check, and `git diff --check` passed.

## Commands

All commands used Node 24.20.0 and npm 11.19.0 from the pinned session-local toolchain.

```text
npm run format
npm run test:unit -- apps/api/test/session-storage.test.ts apps/api/test/playlist-operation.test.ts apps/api/test/backup-restore.test.ts apps/api/test/deployment-runtime.test.ts
npm run test:contract -- tests/contract/deployment.test.ts
npm run typecheck
npm run build
test -f apps/api/dist/storage/migrations/001-session.sql
test -f apps/api/dist/storage/migrations/002-playlist-operations.sql
npm run format:check
```

## Residual ownership

- Phase 2 Step 04 owns HMAC construction, route authorization, upstream writes, reconciliation, and `playlists.write` activation.
- Phase 2 Step 11 owns live devserver and Musiclatte round-trip mutation/restore verification.
- Receipt cleanup and retention remain intentionally undefined; no schedule was invented in this Step.

Rulebook postflight: `skipped(no_new_lesson)`. No unexpected failure met the debugging-cost, token-cost, and recurrence-risk 3×HIGH threshold, so no canonical write or Rulebook data-repo sync was required.
