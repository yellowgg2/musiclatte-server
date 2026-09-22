# Phase 19 Step 00 — Session read lock separation

## Contract

- Session lookup uses a synchronous `BEGIN DEFERRED` snapshot and performs no write on the valid path.
- Expired, revoked, policy-mismatched, corrupt, or unverifiable rows fail closed before conditional best-effort cleanup.
- Cleanup compares the complete observed row so a concurrent replacement is never discarded.
- Session creation, revocation, policy revision, the 100 ms writer timeout, and public HTTP envelopes are unchanged.

## RED → GREEN

The RED fixture held `BEGIN IMMEDIATE` on a second connection. Before the change, both direct `find` and `findByIdHash` raised `Storage unavailable`; the new `readTransaction` API was absent. GREEN adds a deferred read boundary and moves invalid-row cleanup after that boundary.

| Case                                      | No competing writer | Competing writer               |
| ----------------------------------------- | ------------------- | ------------------------------ |
| Valid direct lookup                       | session returned    | session returned               |
| Valid cookie lookup with upstream recheck | 200                 | 200                            |
| Invalid/expired lookup                    | null/401            | null/401; cleanup deferred     |
| Invalid cleanup after lock release        | proof discarded     | proof discarded on next lookup |
| Session create/revoke/policy bump         | existing behavior   | write remains fail-fast        |

Read callbacks reject async functions and returned thenables, roll back on errors, avoid nested `BEGIN`, and leave the connection reusable.

## Verification

- Runtime: Node 24.20.0, npm 11.19.0, Vitest 5.0.0.
- Focused unit: `npm run test:unit -- apps/api/test/session-storage.test.ts apps/api/test/auth-api.test.ts apps/api/test/deployment-runtime.test.ts` — 3 files, 55 tests passed.
- Focused contract: `npm run test:contract -- tests/contract/login-shell.test.ts tests/contract/capabilities.test.ts` — 2 files, 33 tests passed.
- `npm run typecheck`, `npm run build`, `npm run format:check`, and `git diff --check` passed.

The tests use synthetic credentials and temporary SQLite files. They do not simulate filesystem corruption below SQLite or a production multi-process deployment; Phase 19 S05 owns the combined shared-database regression.
