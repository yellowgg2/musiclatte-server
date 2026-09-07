# Phase 3 Step 01 verification

## Scope

Implemented management schema v3, synchronous import/media/engine/worker repositories, v2
preservation, and v3-aware online backup/offline restore. No HTTP route, worker process,
filesystem publication, product UI, gonic tree, iOS tree, bot tree, deployment, or live media was
changed.

## RED evidence

1. Fresh and legacy storage reported `user_version=2`; v3 ledger tables were absent.
2. Repository factory modules were absent, then behavior tests failed on missing repository
   methods.
3. Import replay, lease race, transition/cancel/publish, failed-only retry, duplicate terminal,
   relative path, engine, and worker cases failed before their implementations.
4. A snapshot with a download-event library different from its job restored successfully before
   cross-ledger validation.
5. An owner could renew at the exact instant another worker considered the lease reclaimable, and
   `candidate_ready` accepted an unsuccessful check.

All RED runs collected normally under Vitest and typecheck passed; failures were the intended
behavior assertions rather than syntax, import-collection, or environment failures.

## GREEN and regression evidence

- Fresh v3 and real v1/v2 migration preserve instance, session, and playlist-operation data.
- SQL and repository validation reject unsafe relative keys, incomplete leases, invalid terminal
  payloads, invalid transitions, duplicate publication events, wrong-library media links, and
  invalid singleton state.
- Two SQLite connections prove only expired leases are reclaimed; exact-expiry renewal is
  rejected and stale owners cannot transition.
- Cancellation terminalizes unpublished work but publishing/registering continues to one ready
  item and one download event.
- Backup/restore preserves import replay and rejects cross-ledger snapshot tampering.
- `EXPLAIN QUERY PLAN` selects all three dedicated v3 indexes.

Runtime: Node 24.20.0, npm 11.19.0, TypeScript 7.0.2, Vitest 5.0.0.

- `npm run test:unit -- apps/api/test/import-storage.test.ts apps/api/test/session-storage.test.ts apps/api/test/playlist-operation.test.ts apps/api/test/backup-restore.test.ts`: 4 files, 34 tests passed.
- `npm run test:contract -- tests/contract/deployment.test.ts tests/contract/workspace.test.ts`: 2 files, 9 tests passed.
- `npm run typecheck`, `npm run build`, `npm run format:check`, and `git diff --check`: passed.

No commit or push was performed.
