# Phase 16 Step 00 verification

- Added the strict `AccountSummaryResponse` schema and `GET /api/v1/account/summary` producer.
- The route derives both counts from the verified current principal and accepts no account selector
  in its path, query, or body.
- Favorite and playlist reads run concurrently and share cancellation. A client abort, timeout, or
  terminal sibling failure cancels outstanding upstream work.
- Authentication, session recheck, upstream status mapping, and secret-free errors remain owned by
  the existing `libraryRead` boundary. The session response is unchanged.

## RED evidence

- `npm run test:unit -- apps/api/test/account-summary-api.test.ts` — 8 tests failed on the missing
  route with the expected 404 response.
- `npm run test:contract -- tests/contract/account-summary.test.ts` — 2 tests failed on the missing
  schema export and route.

## GREEN and regression evidence

- Runtime: Node 24.20.0 and npm 11.19.0 from the project-local pinned toolchain.
- `npm run test:unit -- apps/api/test/account-summary-api.test.ts` — 9 passed.
- `npm run test:contract -- tests/contract/account-summary.test.ts` — 2 passed.
- `npm run test:unit -- apps/api/test/account-summary-api.test.ts apps/api/test/playlist-api.test.ts apps/api/test/favorites-api.test.ts`
  — 27 passed.
- `npm run test:contract -- tests/contract/account-summary.test.ts tests/contract/playlist-api.test.ts tests/contract/favorites-api.test.ts tests/contract/login-shell.test.ts`
  — 9 passed.
- `npm run typecheck` — passed.
- `npm run build` — passed; the existing web chunk-size advisory remains non-blocking.
- `npm run format:check` — passed.
- `git diff --check` — passed.

Only synthetic collection fixtures were used. Credentials, usernames beyond synthetic fixtures,
raw upstream bodies, music metadata, and private runtime data are excluded from this artifact.
