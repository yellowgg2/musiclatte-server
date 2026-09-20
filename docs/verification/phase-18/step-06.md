# Phase 18 Step 06 verification

## Result

- External work runs only through the existing serial import worker's idle boundary: import claim/download/publish first, import registration second, then at most one external inventory/admission/registration unit.
- Watch-disabled policies construct no external runtime, watcher, or external schedule. The existing worker and engine-maintenance task count remains unchanged.
- Watch-enabled runtime validates the complete API-projected owner set before touching account roots. Mismatch closes listeners and emits only `external_watch_config/config_mismatch` on a bounded five-second retry.
- An existing account directory receives one nonpersistent recursive watcher. Events contain no trusted data and only move that account's next inventory slice to a 250 ms coalesced deadline.
- Missing directories, unsupported watchers, and watcher errors retain the fixed 60-second periodic reconciliation path. Directory creation and missed events therefore recover without a native event.
- Inventory executes one 256-entry/50 ms service slice per import idle boundary. Settling admission and external registration are considered on fixed five-second boundaries; their own durable `next_attempt_at`, leases, and coordinator checks remain authoritative.
- Long external work uses the runner's existing idle heartbeat interval and abort controller. SIGTERM/AbortSignal stops new claims, aborts active probes/requests, closes watchers, removes listeners, and leaves generation-fenced durable rows for restart.
- Logger events contain only closed event names, bounded counts, and failure codes. Paths, usernames, identity keys, filenames, tags, and credentials are never logged.

## RED → GREEN evidence

- RED: 5 new runtime tests failed because the external scheduler module did not exist; the import fairness test failed because the runner had no idle-task boundary.
- GREEN: external runtime plus import worker passed 65/65 after implementing the serial idle boundary and scheduler.
- The prescribed runtime/import/engine/deployment suite passed 109/109.
- The production runtime fixture used schema v2 watch opt-in plus a projected owner, then started/stopped and reopened the real worker twice while preserving health and engine maintenance.
- Typecheck, production build, and formatting checks passed.

## Scheduling and recovery matrix

| Case                              | Result                                                         |
| --------------------------------- | -------------------------------------------------------------- |
| watch disabled                    | no external runtime/watcher/schedule                           |
| import item queued                | import publishes before any external call                      |
| import registration due           | existing registration service runs first                       |
| repeated idle calls at same clock | no repeated inventory/admission or watcher creation            |
| two rapid fs events               | one account-root reconcile after 250 ms                        |
| event omitted                     | reconcile at the 60-second boundary                            |
| account directory created later   | watcher attaches and inventory runs at periodic retry          |
| watcher error/unsupported         | listener closes; periodic correctness path remains             |
| projection mismatch               | no target access; bounded closed diagnostic                    |
| long external operation           | worker heartbeat remains `idle`, active import ID remains null |
| abort/SIGTERM                     | active signal aborts and watcher/listener close exactly once   |
| process restart                   | durable state reopens; initial bounded reconcile resumes work  |

The 250 ms, five-second, and 60-second values are code constants with test injection through the clock and service boundaries; no new operator environment surface was added.
