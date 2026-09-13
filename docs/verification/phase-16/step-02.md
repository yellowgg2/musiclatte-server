# Phase 16 Step 02 verification

- Removed the denied Media scan placeholder from Settings. `ScanSettingsPanel` now mounts only for
  a server-advertised supported+allowed capability.
- Preserved the existing Download engine supported+allowed manager gate and its
  temporarily-unavailable recovery state. Denied/unknown/unsupported states do not mount or fetch.
- Preserved ordinary-user Access Tokens whenever `automation.tokens` is supported+allowed, including
  the existing scope, collection dependency, library, expiry, one-time secret, and revocation flows.
- Updated KO/EN Settings description to describe language, personal tokens, and only the server
  controls available to the current account. No client-side role model was introduced.
- Added a normal-Router preview for ordinary/admin capability visibility. It uses only synthetic auth,
  metadata policy, token storage, and Subsonic fixtures.

## RED evidence

- `npm run test:unit -- apps/web/test/scan-settings-ui.test.tsx` — the new ordinary/token-allowed
  integration test failed because the denied Media scan heading remained in the DOM.

## GREEN and regression evidence

- Runtime: Node 24.20.0 and npm 11.19.0 from the pinned project-local toolchain.
- `npm run test:unit -- apps/web/test/scan-settings-ui.test.tsx apps/web/test/engine-settings-ui.test.tsx apps/web/test/access-tokens-ui.test.tsx apps/api/test/scan-api.test.ts apps/api/test/engine-api.test.ts`
  — 67 passed.
- `npm run test:contract -- tests/contract/capabilities.test.ts tests/contract/automation-ui.test.ts`
  — 34 passed.
- The API suite includes ordinary scan GET/mutation 403, engine GET/mutation 403, verified admin scan
  allow, and engine manager allowlist/revalidation coverage. No API authorization code changed.
- `npm run typecheck` — passed.

## Connected Chrome evidence

- Chrome 152, normal Router, 390px: the ordinary synthetic account displayed Language and Access
  Tokens while Media scan and Download engine were absent from the accessibility tree.
- The ordinary account issued one disposable synthetic token, displayed its one-time value, hid it,
  confirmed revocation, and showed the revoked state. The value was not copied or retained.
- Switching the same synthetic identity proof to admin retained Access Tokens and mounted Media scan.
  A separate existing normal-Router engine preview showed the allowed manager Download engine region,
  current version, Check now, and Restore previous version actions.
- The Settings hierarchy remained reachable at 320px and actual 200% Chrome zoom; KO copy and the
  global account trigger remained intact. Final visual preference remains P16-UA-003 pending.

No production credential, account, library, engine, or token storage was used. The UI visibility check
is supplementary to, and never replaces, the server-side 403 tests.
