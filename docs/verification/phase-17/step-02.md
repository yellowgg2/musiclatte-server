# Phase 17 Step 02 verification

## RED

- `npm run test:unit -- apps/api/test/metadata-organization-api.test.ts`
- 15 tests collected; the three new status cases failed with `404 not_found` because `POST /api/v1/metadata-organization/statuses` did not exist.

## GREEN

- Added a status-only dual credential boundary. Browser cookies require JSON, the normal web origin/client headers, and a valid CSRF token. PAT requests require an `mlpat_` bearer token, JSON, and `metadata:read`.
- Query credentials are rejected, while the existing selection/preview/job/retry boundary remains PAT-only.
- The service derives allowed libraries from the verified principal, performs one ordered bulk projection, revalidates the credential, and decodes the public response before returning it.
- The request abort signal reaches upstream library discovery and the repository checks it before and after the bounded query.
- Request decoding rejects duplicate, empty, oversized, or selector-expanded bodies before repository access. Missing and out-of-scope targets share the same bounded `unknown` result.

## Verification

- `npm run test:unit -- apps/api/test/metadata-organization-api.test.ts` — 15/15 passed.
- `npm run test:unit -- apps/api/test/organization-storage.test.ts` — abort and projection regression covered.
- `npm run test:contract -- tests/contract/metadata-organization-api.test.ts` — 8/8 passed.
- `npm run typecheck` — passed.
- `npm run build` — passed.
- `npm run format:check` — passed.
- `git diff --check` — passed.

No live credential, deployment, music-library mutation, or final UI acceptance was required for this API-only step.
