# Phase 7 S02 — saved mix API

Implementation complete, base `b869f90`. Node24.20.0/npm11.19.0, repository root.

- RED: mix API3 assertions returned404 before routes existed. Strict contract fixtures also exercised unauthorized and malformed requests.
- `npm run test:unit -- apps/api/test/mix-api.test.ts apps/api/test/library-api.test.ts`: 42 passed.
- Contract scope: `tests/contract/mix-api.test.ts`4, `tests/contract/library-api.test.ts` and `tests/contract/capabilities.test.ts`36: 40 passed total. Final new-file focused rerun4 passed after supplying the required session-retention setting to the configured-runtime fixture.
- `npm run typecheck`, `npm run build`, `npm run format`, `npm run format:check`: exit0.
- HTTP create/replay, conditions replacement, stale revisions, deletion replay, other-account404, signed cursor tampering/account/page-size binding, removed root409, empty random success and upstream503 covered.
- Capability opt-in follows the existing random support observation. Real configured-app startup injects the repository; default flag remains false, nonboolean strings fail startup.
- Cookie CSRF and JSON requirements, duplicate/unknown keys, native bearer and mixed-credential rejection covered. Existing library tests retain shared abort/session boundary coverage.
- Each execution makes one upstream random request. No write probes, recursive folder traversal or song persistence.
- Shared `libraryRead` supplies abort cleanup and response-time session/policy validation. Mutation checks session again after root validation and before synchronous storage.
- No UI/copy/Gallery changes. Existing P7 acceptance pending; no browser/live deployment claim. Fixture apps, HTTP servers and temporary databases closed.
- Rulebook: no directly applicable selected rule; postflight skipped(no_new_lesson), no canonical writes.
