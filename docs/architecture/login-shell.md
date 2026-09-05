# S06 login and account shell

`main.tsx` now renders `Router` after the S05 Gallery approval. `Router` owns canonical route transitions and account gating; `AppShell`, `LoginPage`, `SettingsPage` and `LanguagePicker` are feature-local. They reuse the approved Action, TextField and StatusSurface symbols and unchanged design tokens. The actual settings icon is a simple semantic SVG; brand/page icons reuse the existing iOS app asset.

## Session and request ownership

`auth/client.ts:createSessionClient` calls the origin-root `/api/v1/session` and `/api/v1/capabilities`. API origin and SPA mount base remain separate. Development Vite proxies `/api` and discovery to `127.0.0.1:3000` without changing Origin; configure the API PUBLIC_ORIGIN as the web origin. The S03 server has no cross-origin CORS allowance, so an arbitrary different browser API origin needs an independently configured gateway. Production uses the existing S04 gateway.

Every request includes cookies, disables caching, refuses redirects and has a bounded 15-second browser timeout. Session JSON must be schema v1 cookie transport with username, absolute expiry and CSRF; bearer responses are rejected. Passwords go only in the POST body, are cleared from the form at submission, and are never persisted. Logout sends JSON, `X-Musiclatte-Client: web` and session-bound `X-CSRF-Token`. Raw upstream response text is never rendered.

`createSessionStore` keeps session/CSRF/capabilities in memory. Absolute expiry clears the account; returning to the visible page revalidates with GET. Before an expired session's next password exchange, GET clears an expired HttpOnly cookie or restores the current CSRF. Failed logout retains a retry path; a CSRF rejection refreshes the current cookie context without automatically resending a password. Request generations discard late responses after logout or a newer operation, and a different username/CSRF clears the previous capability snapshot. Disposal invalidates outstanding responses and clears timers/subscriptions.

## Routes, capability and locale

The only implemented authenticated destination is `${base}settings`. `safeReturnPath` accepts that canonical relative path and falls back to it for external, encoded, API, unknown or unimplemented paths. Unknown signed-in routes show a recovery page. All private feature entries remain false in `clientFeatures`; `availableEntries` intersects that registry with explicit server support, permission and availability. Unsupported, denied, unavailable and unknown remain distinct. Extension failure leaves the account and standard capability evidence available within the same session; it cannot create a menu or remove the account.

`useLocale` resolves an explicit KO/EN preference before browser language and persists only `musiclatte.locale`. Denied storage falls back to memory; storage events update other tabs. Locale changes update HTML language/copy while keeping the account, route and active form state. KO/EN resources have matching nonempty keys; server codes map to localized recovery messages.

## iOS asset reuse

At the user's request, web icons were resized from the existing light iOS asset `Musiclatte/Assets.xcassets/AppIcon.appiconset/aaa.png` (1024×1024) in the sibling Musiclatte repository. The original was read only and its Git state remains unchanged. `sips -z` wrote separate 32×32 favicon, 180×180 Apple touch icon and 192×192 brand image under `apps/web/public/icons`; no crop or redraw was needed. HTML icon URLs use `%BASE_URL%`; in-page URLs use the configured SPA base. Decorative repeated brand imagery has empty alt text beside the Musiclatte name.

The iOS project, gonic, bot, media and management schema were not modified. No license terms were invented. Asset reuse is project-specific and does not change the approved global token/primitive baseline.

See [verification](../verification/phase-1/step-06/README.md) and [browser scenarios](../../tests/browser/login-shell-scenarios.md). Music data/navigation remains S07/S08; media/player remains S09/S10.
