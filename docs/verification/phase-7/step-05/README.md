# Phase 7 S05 — listening API

Node24.20.0/npm11.19.0, repository root, base f968d89. Implementation complete.

- RED: listening-api unit3 and contract1 failed expected201/400 versus absent route404 before implementation.
- `npm run test:unit -- apps/api/test/listening-api.test.ts apps/api/test/listening-storage.test.ts apps/api/test/backup-restore.test.ts`:26 passed.
- `npm run test:contract -- tests/contract/listening-api.test.ts tests/contract/listening-schema.test.ts tests/contract/capabilities.test.ts`:31 passed.
- `npm run format`, `npm run typecheck`, `npm run build`, `npm run format:check`: exit0.
- Actual synthetic HTTP scrobble request count proves one dispatch across success, response drop, timeout,401 and relogin replay. Local event remains after failures. S04 separate-process claim tests and S05 configured startup recovery cover interrupted dispatch; second live runtime cannot recover/take over.
- Strict base64url event ID, listenedMs/time admission, known60-second threshold and unknown240-second threshold, future bound, stale-window replay, mismatched payload409, cookie CSRF, duplicate JSON keys, bearer and mixed-auth rejection verified.
- History/top page snapshot excludes later writes; cursor binds purpose/limit/account and detects tampering. Missing current metadata preserves count; upstream503 stays explicit. Six unique page songs used exactly six hydration calls, peak concurrency4. Repeated IDs hydrate once.
- Session revoked during getSong prevents insertion/dispatch. Real backup/restore retains3 events, invalidates sessions and leaves zero not_sent/dispatching deliveries.
- Runtime flags strictly default off; capability true only with local producer. No web UI/locale/Gallery changes. P7 acceptance pending unchanged. Owned servers, processes, SQLite locks/connections and fixtures closed by tests; no real gonic deployment claim.
- Rulebook search had no directly applicable selected lesson. Postflight skipped(no_new_lesson); no canonical writes.
