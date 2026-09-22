# Phase 19 Step 03 — Curation batch pacing and 30-day safety sweep

## Contract

- Legacy four-key and Phase 13 seven-key inventory policies remain valid and normalize `batchCooldownMs` to 60,000 ms.
- The current exact eight-key policy accepts cooldowns from 1,000 to 3,600,000 ms and sweep intervals through 2,592,000,000 ms.
- Each curation scheduler instance waits until `clock()+batchCooldownMs` after every attempted batch, including idle or failing batches.
- The cooldown gates only the curation inventory turn; metadata recovery, organization, file, and reflection remain owned by the outer scheduler.
- Durable source events retain their existing priority, and explicit stale requests begin at the next cooldown-eligible batch.

## RED → GREEN

RED showed an explicit stale request starting on the next 500 ms outer-loop cycle and both compatible policy shapes missing a cooldown. GREEN holds the stale request at 0 ms and 59,999 ms, starts it at 60,000 ms, accepts the exact eight-key policy, and extends only the full-sweep maximum to 30 days. Nonzero batches emit identifier-free aggregate counts plus bounded duration.

## Verification

- Runtime: Node 24.20.0, npm 11.19.0, Vitest 5.0.0.
- Focused RED/GREEN: `npm run test:unit -- apps/api/test/automation-config.test.ts apps/api/test/curation-runtime.test.ts apps/api/test/curation-inventory.test.ts` — 3 files, 31 tests passed.
- Affected unit: `npm run test:unit -- apps/api/test/automation-config.test.ts apps/api/test/curation-runtime.test.ts apps/api/test/curation-inventory.test.ts apps/api/test/metadata-runtime.test.ts apps/api/test/metadata-worker.test.ts` — 5 files, 49 tests passed.
- Affected contract: `npm run test:contract -- tests/contract/automation-deployment.test.ts tests/contract/deployment.test.ts` — 2 files, 16 tests passed.
- `npm run typecheck`, `npm run build`, `npm run format:check`, and `git diff --check` passed.

The example policy contains synthetic account placeholders only. No private production policy or credentials were read or copied.
