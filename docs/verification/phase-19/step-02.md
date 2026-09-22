# Phase 19 Step 02 — External watch safety scheduling

## Contract

- `coalesceMs=250` wakes only the owner root after filesystem hints or watcher errors.
- `dueMs=5,000` independently schedules mapping checks, settling/admission, and registering rows.
- `watcherRefreshMs=60,000` retries watcher attachment without starting inventory.
- `safetyReconcileMs=21,600,000` bounds missed-event recovery for completed active roots.
- Baseline roots start immediately, progress results yield after one slice, and blocked roots use the repository's shorter durable retry.
- Inventory scheduling never calls the Gonic scan coordinator without a due registering observation.

## RED → GREEN

The RED fake clock reproduced an unchanged active root inventory call at 60 seconds and showed a blocked missing root waiting for that same interval. GREEN keeps the inventory count unchanged at watcher refresh, starts the next no-event scan at six hours, and honors the inventory root's 30-second blocked retry. Event bursts still coalesce to one call after 250 ms, and watcher errors advance only their owner root.

## Verification

- Runtime: Node 24.20.0, npm 11.19.0, Vitest 5.0.0.
- Focused runtime RED/GREEN: `npm run test:unit -- apps/api/test/external-watch-runtime.test.ts` — 1 file, 6 tests passed.
- Affected unit: `npm run test:unit -- apps/api/test/external-watch-runtime.test.ts apps/api/test/external-watch-inventory.test.ts apps/api/test/import-worker.test.ts apps/api/test/gonic-registration.test.ts apps/api/test/deployment-runtime.test.ts` — 5 files, 104 tests passed.
- `npm run typecheck`, `npm run build`, `npm run format:check`, and `git diff --check` passed.

All paths, accounts, and media in the tests are synthetic temporary fixtures. Runtime logs assert only event, reason, and aggregate count fields.
