# Phase 17 Step 03 verification

## RED

- `npm run test:contract -- tests/contract/metadata-client.test.ts` collected 8 tests and the new client contract failed because `organizationStatuses` was absent.
- `npm run test:unit -- apps/web/test/metadata-sync.test.tsx` failed during import because the organization state store did not exist.

## GREEN

- The web client posts `{ schemaVersion: 1, targets }` to the organization status endpoint with cookie credentials, JSON, CSRF, cancellation, and strict response decoding.
- A provider-scoped registrar deduplicates visible track IDs, batches them on a zero-delay turn, and chunks at 100 targets. A 302-track fixture produced request sizes `100/100/100/2`; duplicate consumers shared one cache entry.
- Cache entries use bounded stale and retention windows. Last-subscriber removal cancels queued work, while a quick route remount reuses a fresh result.
- Scope replacement disposes and aborts the old store. A transport that ignored the abort and resolved late could not overwrite the new account result.
- Visibility regain, stale expiry, manual retry, and metadata completion invalidate visible targets. Metadata completion always re-reads the server projection and never writes an optimistic organized state.
- Authentication failures call the existing session expiry callback; forbidden, server, malformed-response, and ordinary transport failures remain isolated to the status view.
- The Router supplies the current session CSRF token without changing the existing account/instance/policy scope or player/selection ownership.

## Verification

- `npm run test:unit -- apps/web/test/metadata-sync.test.tsx apps/web/test/metadata-single-ui.test.tsx` — passed.
- `npm run test:unit -- apps/web/test/library-ui.test.tsx apps/web/test/favorites-ui.test.tsx apps/web/test/playlist-read-ui.test.tsx` — passed.
- `npm run test:contract -- tests/contract/metadata-client.test.ts` — passed.
- `npm run typecheck` — passed.
- `npm run build` — passed.
- `npm run format:check` — passed.
- `git diff --check` — passed.

Final visual, zoom, touch, and user expectation checks remain pending under `P17-UA-002`; no production or live credential work was performed.

## 2026-09-16 background-refresh flicker regression

- RED: a controlled second status request left the prior `needs_organization` result in flight; the store exposed `loading`, reproducing the metadata action surface/mark flicker.
- GREEN: only initial loads and explicit retries from an error expose `loading`. Stale, visibility, metadata-completion, and manual background refreshes keep the last ready value until a replacement ready result or a real error arrives.
- The regression also proves that a changed server result still publishes after the pending request resolves, so the stabilization does not hide durable status changes.
- Focused web verification passed 55/55 tests across `metadata-sync`, `metadata-single-ui`, and `library-ui`; typecheck, production build, Prettier check, and diff check passed under Node 24.20.0/npm 11.19.0.
- The actual development Gallery disclosure opened with the expected organization copy and its accessibility tree remained unchanged across a 31-second refresh interval.
- The unrelated existing playlist occurrence test still fails when run independently because its song fixture is absent. That route fixture does not grant metadata edit permission and therefore does not subscribe to organization state; the changed store and all focused consumers pass.
