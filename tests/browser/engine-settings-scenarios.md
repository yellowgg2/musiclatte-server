# Engine settings scenarios

Use Node 24.20.0/npm 11.19.0. Check that loopback ports 3000 and 5173 are free first.
Run `PREVIEW_CONTROL=/tmp/musiclatte-s12-preview-control node --import tsx tests/support/engine-preview.ts`
and `npm run dev:web -- --host 127.0.0.1`. Use the normal `/` → login → Settings flow.
The fixture uses the existing synthetic auth harness credentials; it also accepts a second synthetic
username to exercise account switching. No live engine, music library, updater or worker is touched.
Do not reuse production credentials. Stop only the two processes created for this preview.

Write a mode to the control file, then reload Settings or use an existing status/capability retry.
The control file and fixture never enter production bundles or Docker contexts.

| Mode                                 | Expected result                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `active`                             | Active and previous versions; check and restore available                                |
| `never_checked`                      | No check history; previous absent and restore disabled                                   |
| `checking`                           | Explicit checking status and disabled mutations                                          |
| `up_to_date`                         | No new version, distinct from a request acknowledgement                                  |
| `candidate_pending_validation`       | Candidate awaits the next eligible source; current active stays                          |
| `update_failed`, `validation_failed` | Specific failure help, preserved active version and manager recovery                     |
| `restored`                           | Restored status with next-job scope                                                      |
| `unavailable`                        | Known manager panel retained; retry refreshes capability and status                      |
| `restore-unavailable`                | Previous metadata retained but restore disabled with explanation                         |
| `unsupported`, `denied`, `unknown`   | No panel and no empty management placeholder                                             |
| `long`                               | Long valid version and failure copy wrap at 320 CSS px                                   |
| `check-failure`                      | Check accepted → checking → update failed; active stays                                  |
| `candidate-flow`                     | Check accepted → checking → candidate pending validation                                 |
| `stuck`                              | After 30 seconds without an observable change, unknown outcome requires explicit refresh |
| `401`, `403`, `409`, `503`           | Safe auth/permission/conflict/unavailable boundaries, no raw bodies                      |
| `late-read`                          | Delayed status response is discarded after route/account change                          |
| `late-action`                        | Delayed 401 from a mutation must not expire a newly signed-in account                    |

- Check now: keyboard Enter → sending/accepted (not completion) → observed checking → observed active.
- Restore: request → accepted while active unchanged → previous becomes active. No process controls.
- Busy: duplicate activation rejected; focus stays in the visible action group and returns to the
  initiating button only if the user has not moved it elsewhere.
- Failures: keep current status context, render one local recovery surface, require explicit retry;
  background reads do not clear an unknown action outcome and silently permit replay.
- Account race: start `late-action`, sign out, switch the control mode to `active`, sign in with another
  synthetic username, then verify that the late 401 does not remove the new account or its panel.
- Player: start Random play on Music, select Repeat One, open Settings, switch KO/EN and request check,
  failed check, restore and status retry. The same track remains visibly playing.
- Accessibility: KO/EN, 1800×863, 390×844, 320×844, actual Chrome 200% zoom and DevTools
  prefers-reduced-motion:reduce. Check label/value hierarchy, focus, action reachability, no horizontal
  overflow, live status text and console. Reset zoom, viewport and emulation and close test tabs.

Evidence and actual results: `docs/verification/phase-3/step-12/README.md`.
