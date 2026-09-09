# Phase 7 S01 — saved mix storage

Implementation complete. Base `f575174`. Actual baseline schema19 advances to20 through additive `020-saved-mixes.sql`; original v12 plan number was reassigned as authorized.

Repository root, Node24.20.0/npm11.19.0:

- RED: missing repository6 and contract13 assertion failures; duplicate-key parser1 additional assertion failure.
- `npm run test:unit -- apps/api/test/mix-storage.test.ts apps/api/test/session-storage.test.ts apps/api/test/backup-restore.test.ts apps/api/test/import-worker.test.ts apps/api/test/metadata-worker.test.ts`: 93 passed.
- `npm run test:contract -- tests/contract/mix-schema.test.ts`: 14 passed.
- `npm run typecheck`, `npm run build`, `npm run format`, `npm run format:check`: exit0.
- Fresh/v12/v19 migration and two open connections, restart, account isolation, stale revision, insertion high-water, duplicate replay, delete tombstone, transactional rollback, real snapshot restore and tampered row rejection covered.
- Repository accepts private HMAC identity/operation/request fingerprints and typed anchors. S02 owns authenticated identity derivation, root membership validation, signed cursors and HTTP routes; no client-provided owner.
- JSON duplicate keys (including escaped names) are rejected by `parseMixJson`; normalization validates Unicode code points, controls, exact genres and integer ranges.
- Existing migration assertions updated from19 to20 and table inventory expanded. Existing worker/session behavior preserved.
- No UI or locale copy changes; acceptance remains pending at its existing owners. Temporary databases cleaned by harness.
- Rulebook lookup had no direct storage safeguard; postflight skipped(no_new_lesson), canonical write not applicable.
