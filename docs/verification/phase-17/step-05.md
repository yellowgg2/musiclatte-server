# Phase 17 Step 05 verification

## RED

- `npm run test:unit -- apps/api/test/organization-selection.test.ts apps/api/test/metadata-organization-api.test.ts` collected 20 tests and failed the two new boundaries: the unorganized snapshot factory/repository exports were absent and the HTTP endpoint returned 404.

## GREEN

- Schema v29 adds a dedicated organization-selection parent/item store plus the curation album projection required by the public minimal item DTO. Existing curation snapshots keep their own tables and capacity.
- Creation accepts only `{schemaVersion:1}`, requires a PAT with metadata read plus media organize authority, derives libraries from the current principal, and refuses any inventory run that is not ready with completed discovery. The error exposes only affected library IDs and bounded coverage states.
- Current non-tombstoned rows are classified through the canonical organization status projection in chunks of 100. All five counts are frozen while only `needs_organization` items receive stable ordinals.
- Page cursors bind selection ID, ordinal, principal/token scope, allowed libraries, policy revision, and inventory revision. Bit flips, another PAT, expiry, missing ordinals, and capacity shortage fail closed.
- A 1,001-item synthetic snapshot was captured and consumed across eleven pages without touching the legacy curation snapshot pool. Capacity failure left zero partial parent/item rows.
- A live state change from needs to processing after capture did not mutate the captured page, proving the S06 live-revalidation boundary remains necessary.
- The public body contains no raw token, actor identifier, filesystem path, credential proof, digest, or private source data.

## Automated verification

- `npm run test:unit -- apps/api/test/organization-selection.test.ts apps/api/test/curation-inventory.test.ts apps/api/test/curation-query.test.ts apps/api/test/curation-storage.test.ts` — passed, 24 tests.
- `npm run test:unit -- apps/api/test/metadata-organization-api.test.ts` — passed, 18 tests.
- `npm run test:contract -- tests/contract/metadata-organization-api.test.ts tests/contract/curation-query.test.ts` — passed, 10 tests.
- `npm run test:unit -- apps/api/test/automation-config.test.ts apps/api/test/session-storage.test.ts apps/api/test/engine-requests.test.ts apps/api/test/curation-reconciliation.test.ts` — passed, 36 tests.
- `npm run test:contract -- tests/contract/automation-deployment.test.ts tests/contract/automation-roundtrip.test.ts tests/contract/curation-schema.test.ts` — passed, 7 tests.
- `npm run typecheck` and `npm run build` — passed; the existing web bundle-size warning remains non-blocking.
- `npm run format:check` and `git diff --check` — passed.

No production deployment, credential access, Gonic call, metadata job creation, or music-file mutation was performed.
