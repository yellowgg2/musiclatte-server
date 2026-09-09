# Phase 6 S01 — token management and scoped authentication

Implementation complete; direct UI acceptance not applicable. Base: `f97c30a`; branch: `yellowgg2/tdd/phase-6/step-01-token-auth-api`. Autopilot branch-push to origin; no production deployment or main merge.

## Result

Existing sessions can issue/list/revoke PATs with strict request/response contracts and one-time, no-store secret output. PAT authentication is separate, current account/library/scope constrained and revalidated after network I/O. P4 and ordinary session APIs still reject PATs. Default-off private runtime configuration and the actual `automation.tokens` capability producer are connected; web support and curation remain disabled.

The shared synthetic HTTP harness owns temporary Fastify/upstream instances and databases, all cleaned after tests. No live credentials/media or remote processes were used.

## Evidence

Cwd: repository root. Node 24.20.0/npm 11.19.0 from the session-local toolchain. `npm run format` ran before checks.

- RED: `npm run test:unit -- apps/api/test/access-token-api.test.ts`: 3 expected assertion failures (missing routes returned 404), exit 1.
- GREEN: `npm run test:unit -- apps/api/test/access-token-api.test.ts apps/api/test/auth-api.test.ts apps/api/test/auth-runtime.test.ts`: 49/49 passed; additional native/other-owner coverage subsequently passed in the focused file, 7/7. Combined distinct test count: 50.
- `npm run test:contract -- tests/contract/access-token-api.test.ts tests/contract/capabilities.test.ts`: 28/28 passed. Actual HTTP producer responses are consumed by strict decoders.
- `npm run typecheck`: passed after changing a contract-test spread from unknown JSON to its decoded typed value.
- `npm run build`: passed. No package upgrades or new framework.
- Coverage includes default off/private file modes, issuance constraints, one-time output, cookie CSRF/mixed auth, native bearer, cross-owner 404/empty list, PAT session API denial, logout independence, permission loss, transient upstream failure, identity mismatch and revocation during upstream verification.

No broader suite or real deployment was needed for this auth-only boundary. UI_PRECHECK/AUTOMATED_UI/Gallery/localization: not applicable (no UI changes). Existing KO/EN files are unchanged. ACCEPTANCE_SYNC: no new surface/ID. DOC_SYNC: S01/overview and C1 implementation notes synchronized. Rulebook: no directly relevant returned rule; postflight `skipped(no_new_lesson)`, no central write or sync. Gitignore inspection includes the private automation config and corresponding Docker exclusion.
