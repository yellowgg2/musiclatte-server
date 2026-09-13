# Phase 16 Settings visibility browser scenarios

Use the pinned Node toolchain and ensure ports 3000/5173 are free. Start
`PREVIEW_CONTROL=/tmp/musiclatte-phase16-settings node --import tsx tests/support/settings-visibility-preview.ts`
and the normal Vite development server. Sign in through `/login` with the existing synthetic auth
harness credentials; no production credential, library, or runtime is used.

- `ordinary` (default): Settings shows Language and Access tokens. Media scan and Download engine
  are absent from the DOM/accessibility tree. Issue one synthetic token, observe its one-time secret,
  hide it, and revoke it.
- `admin`: after writing this value to the owned control file, refresh capabilities by reloading or
  focusing the page. Media scan becomes visible while Access tokens remains. Engine authorization and
  manager presentation remain covered by `engine-settings-scenarios.md` because this fixture does not
  construct an import engine.
- Switch KO/EN and inspect 390px, 320px, and actual 200% Chrome zoom. The global account trigger and
  language remain available while privileged sections are absent for ordinary mode.

Stop only the owned preview process, remove the control file, reset Chrome viewport/zoom, and retain
no generated token value. Evidence: `docs/verification/phase-16/step-02.md`.
