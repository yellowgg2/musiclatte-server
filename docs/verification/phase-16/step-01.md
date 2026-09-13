# Phase 16 Step 01 verification

- Added an account-and-instance-scoped summary client/provider with strict decoding, request abort,
  late-response suppression, same-account last-success retention, and immediate cross-account clear.
- Added the responsive `AccountDock`: a direct desktop sidebar action and a 44px mobile trigger
  expose the current synthetic identity, capability-aware count links, and explicit logout.
- The mobile dialog owns its accessible name, initial focus, Tab containment, Escape/outside dismissal,
  trigger focus return, and a busy dismissal guard. Account overlays reserve existing bottom
  navigation/player/selection clearance rather than taking ownership of those surfaces.
- Removed the duplicate Settings account section. Language and all capability-owned settings remain.
- Successful favorite changes and playlist create/delete operations invalidate the account summary;
  rename, reorder, and add-song operations do not.
- `ShellFixture` provides deterministic normal, loading, summary-error, long-name, logout-busy,
  logout-error, mobile-open, and player-coexistence states using the production account component.

## RED evidence

- `npm run test:unit -- apps/web/test/account-shell.test.tsx` — 4 tests failed because the account
  summary client/provider and shell account surface did not exist.
- `npm run test:unit -- apps/web/test/favorites-ui.test.tsx apps/web/test/playlist-crud-ui.test.tsx apps/web/test/playlist-add-ui.test.tsx`
  — the four count-changing mutation scenarios failed because no summary invalidation occurred.

## GREEN and regression evidence

- Runtime: Node 24.20.0 and npm 11.19.0 from the pinned project-local toolchain.
- `npm run test:unit -- apps/web/test/account-shell.test.tsx apps/web/test/login-shell.test.tsx apps/web/test/favorites-ui.test.tsx apps/web/test/playlist-read-ui.test.tsx`
  — 32 passed.
- `npm run test:unit -- apps/web/test/account-shell.test.tsx apps/web/test/favorites-ui.test.tsx apps/web/test/playlist-crud-ui.test.tsx apps/web/test/playlist-add-ui.test.tsx`
  — 22 passed.
- `npm run test:contract -- tests/contract/login-shell.test.ts tests/contract/production-exclusion.test.ts`
  — 10 passed.
- Existing player/account settings regressions were also exercised in a 70-test affected suite; one
  obsolete ShellFixture expectation was updated for the now-intentional production account consumer.
- `npm run typecheck` — passed.
- `npm run build` — passed; the existing Vite chunk-size advisory remains non-blocking.
- `npm run format:check` — passed.
- `git diff --check` — passed.
- Serena diagnostics for all changed production TypeScript files — no warnings or errors.

## Connected Chrome evidence

- Chrome 152 used the real loopback Fastify/session/CSRF fixture and normal Router. Synthetic login
  reached `/music`, where the desktop account region exposed `fixture-listener`, zero favorites, one
  playlist, direct logout, and unchanged route content/navigation.
- Responsive mode at 320px and 390px exposed the 44px account trigger. Opening focused the named
  dialog; Escape closed it and returned focus to the trigger. A long synthetic username wrapped
  within the surface with all count links and logout reachable.
- The deterministic summary-error surface retained identity, route content, navigation, and logout
  while exposing a count-only retry. Logout busy disabled repeat activation, disabled close, and
  ignored Escape. Unit coverage also verifies pointer-outside dismissal and Tab wrap.
- `/settings` retained its language and capability panels under the global account trigger, with no
  duplicate account/logout section.

Only synthetic credentials and collection data were used. Final visual preference, Safari safe-area,
touch, actual 200% zoom, and representative player/selection coexistence remain pending under
P16-UA-001 and P16-UA-002; they are not reported as user-approved.
