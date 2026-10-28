# Theme selection and combobox spacing

Implemented on 2026-10-28 from direct UI feedback.

- Every single-value native select uses the global chevron treatment: a 16px stroke icon positioned
  12px from the right edge and 40px trailing text padding. Page-local background/padding shorthands
  cannot erase it. Native semantics and keyboard behavior remain intact; forced-colors mode restores
  the platform arrow. Multiple/listbox selects keep their platform treatment.
- `ThemePicker` appears above authenticated page content, in the login header, during session
  recovery, and in the development Gallery. Light remains the default. Dark overrides the existing
  semantic color tokens and sets native `color-scheme` consistently.
- The browser preference survives reload/login/navigation, synchronizes storage events, rejects
  invalid stored values, and remains usable when persistence is blocked. Startup applies the saved
  theme before the first React render. KO/EN labels are complete.
- ThemePicker is shared-new with actual AppShell/LoginPage/Router/Gallery consumers. Existing native
  selects, LanguagePicker, and semantic foundation tokens are reused. Historical S05 approval is
  preserved; the theme/combobox delta awaits final review in the vault's unplanned UI acceptance.

## Verification

Cwd: repository root. Runtime: Node 24.20.0 / npm 11.19.0 from the session-local pinned toolchain.

| Command                                                                                                                                                                                                        | Result                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `npm run test:unit -- apps/web/test/login-shell.test.tsx -t theme` before implementation                                                                                                                       | 2 expected assertion failures: Theme control absent |
| `npm run test:unit -- apps/web/test/login-shell.test.tsx apps/web/test/account-shell.test.tsx apps/web/test/design-foundation.test.tsx apps/web/test/engine-settings-ui.test.tsx tests/unit/workspace.test.ts` | 68 passed                                           |
| `npm run test:contract -- tests/contract/login-shell.test.ts tests/contract/metadata-ui.test.ts`                                                                                                               | 11 passed                                           |
| `npm run typecheck`                                                                                                                                                                                            | passed                                              |
| `npm run build`                                                                                                                                                                                                | passed; existing bundle-size advisory               |

Production-exclusion verification (`npm run test:contract -- tests/contract/production-exclusion.test.ts`)
passed 8 tests. `npm run format:check` passed. Generated local artifacts are also excluded from Docker
build contexts.

Chrome through CUA used the normal Router and the existing loopback synthetic login/API fixture.
Verified dark selection, reload persistence, signed-in shell, settings navigation, language switching,
light restoration, and Gallery dark rendering. Desktop and 320px KO/EN settings had no horizontal
overflow. Computed select padding was 40px and the icon's right offset was 12px. Both palettes passed
13 main text/surface contrast pairs: minimum light 5.46:1, dark 5.81:1.

Local screenshots are in ignored `artifact/ui-adjustments-20261028/`. The temporary browser tab and
Vite/API fixture processes were cleaned up. Full visual/accessibility/Safari consumer coverage
remains pending as THEME-UA-001–003; functional tests are complete.

No Rulebook lookup or capture: this was a direct UI addition with a local selector-ambiguity test
adjustment, without an unresolved tooling/runtime failure. The previous unnamed combobox query now
identifies Language explicitly. Branch setup was not applicable to this ad-hoc request. No unrelated
API, worker, media, iOS, or bot implementation changed.
