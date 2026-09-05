# S06 login shell browser scenarios

Use the connected Chrome and the normal `/login` entry. The browser fixture runs the real S03 Fastify/session/CSRF API with the existing synthetic Subsonic harness and disposable SQLite storage.

```bash
export PATH="$HOME/.cache/musiclatte-toolchain/node-v24.20.0-darwin-arm64/bin:$PATH"
PREVIEW_CONTROL=/tmp/musiclatte-s06-control node --import tsx tests/support/login-shell-preview.ts
```

In a separate terminal run `npm run dev:web -- --host 127.0.0.1`. Ports 3000 and 5173 must be free. The fixture binds only loopback; its synthetic account is defined in `tests/support/auth-harness.ts`. Do not substitute real credentials in screenshots or saved evidence. The fixture is outside the production web/API source and Docker contexts.

1. Open `http://127.0.0.1:5173/login`. Inspect KO/EN labels, required fields, native username/password autocomplete, focus and keyboard submit.
2. Submit a wrong synthetic password. Expect translated authentication error, retained username, cleared password and password focus. Correct it and submit once; expect `/settings`.
3. Select the other language and reload. Expect the same account/route and retained locale. Only settings navigation is available; music/playlist/import are absent.
4. Open `/music` directly while signed in. Expect scoped unavailable content and a working settings recovery link. Signed-out entry returns to login with a canonical settings return path. Test malicious return paths in the unit suite.
5. Sign out by pointer/keyboard. Reload `/settings`; expect login. The DELETE uses the current session-bound CSRF token and the HttpOnly cookie.
6. Restart only the owned preview fixture with `PREVIEW_SESSION_AGE_MS=15000`. Sign in, wait for the absolute expiration, then submit valid credentials once. Expect expiry notice and successful reauthentication. This 15-second duration is a fixture setting, not a product session policy.
7. Write `loading`, `outage`, or `denied` to the owned control file to exercise synthetic upstream timeout/503/403. Retry shows loading; `normal` followed by retry restores the account. No private client state or cookies need inspection/mutation. `expire` revokes disposable fixture sessions on the next control tick.
8. Inspect desktop, 390×844 and 320×844, KO/EN long copy, 200% Chrome zoom, keyboard focus and reduced-motion. Use Chrome DevTools command menu for reduced-motion, then undo that temporary override.
9. `/__dev/shell` renders the actual AppShell and shared StatusSurface without enabling music navigation. `/__dev/gallery` retains the approved primitives. Production contract tests require these routes to be 404 and exclude all dev source from bundles.

For viewport overrides, screenshots with an explicit viewport-sized `clip` preserve readable pixels. During this run the extension's whole-window screenshot scaled the mobile region down; native Chrome accessibility clicks were used to verify mobile pointer activation. This is browser-tool behavior, not a layout failure.

Stop only the owned API/Vite processes, remove the owned control file, reset zoom/viewport/reduced-motion, and close the owned tab. Fixture shutdown deletes its temporary databases and closes its upstream listener. See [S06 evidence](../../docs/verification/phase-1/step-06/README.md).
