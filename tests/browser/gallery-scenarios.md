# S05 Gallery browser scenarios

Entry: `npm run dev:web -- --host 127.0.0.1` → connected Chrome `http://127.0.0.1:5173/__dev/gallery`.

Fixture: `apps/web/src/dev/gallery-fixtures.ts`; initial locale ko, favorite false, blank editable username, recoverable error. Reload resets only this development fixture. No login or production library data is needed.

| Scenario             | Actions                                                             | Expected result                                                                                              |
| -------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Foundation / states  | Read all six numbered sections                                      | Tokens and five actual shared primitives; loading/empty/error/busy/disabled and four artwork states          |
| Keyboard             | Tab through header and actions; Enter on primary, Space on Favorite | Visible focus, feedback; pressed state toggles; disabled/busy skipped                                        |
| Form                 | Type `latte`; Enter; Home, Right, type `ko`                         | Form feedback; `lkoatte` with caret immediately after insertion; help/error remain associated                |
| Locale               | Switch English, then 한국어                                         | All visible/accessibility copy localized; field, toggle and recovery state preserved                         |
| Recovery             | Click Try again in error surface                                    | Connected again; other fixtures preserved                                                                    |
| Responsive           | Desktop 1800×863, mobile 390×844, narrow 320×844; KO/EN             | No horizontal overflow, clipped text or inaccessible action; long labels wrap                                |
| Zoom                 | Chrome page zoom 200%                                               | Reflow and accessible actions; reset 100% afterward                                                          |
| Reduced motion       | Chrome DevTools command Emulate CSS prefers-reduced-motion: reduce  | Computed response token 0ms and button transition 0s; reset afterward                                        |
| Production exclusion | Run focused contract test                                           | Root/nested-base preview dev paths 404, Gallery absent in bundle/manifest/maps; no-dev-source context builds |

All browser scenarios above are AUTOMATION_CAPABLE and were exercised by Codex. Physical iPhone media is outside S05. The remaining user task is visual direction approval, not replaying these scenarios.

Evidence and actual outcomes: [S05 verification](../../docs/verification/phase-1/step-05/README.md).
