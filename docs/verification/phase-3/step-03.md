# Phase 3 Step 03 verification

Date: 2026-09-07. Working directory: repository root.
Branch: `yellowgg2/tdd/phase-3/step-03-download-worker`.
Runtime: session-local Node **24.20.0**, npm **11.19.0**, project-pinned Vitest/Prettier.
No global Node replacement, package installation, application commit/push or production activation.

## Result

Durable single-worker download/publication is implemented through registering. Schema v4 preserves
v3 media mappings while adding pending links, attempt cleanup acknowledgements and publication intent
with pending inode identity. gonic registration, real engine activation and deployment remain their
planned Steps 04/07/09. See `docs/architecture/import-worker.md` for the complete state/crash matrix.

| Gate                  | Result / evidence                                                                                                                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BRANCH_SETUP          | Clean main worktree; created Step branch before reading the Step body or writing repository files                                                                                                                                                                        |
| PROJECT_DOC_CONTEXT   | Selected Step, Phase overview and media/jobs contract resolved; external vault excluded from repo Git operations                                                                                                                                                         |
| LESSONS_CONTEXT       | Central project search succeeded; three results were unrelated or lacked relevant compatibility, so none applied                                                                                                                                                         |
| RED                   | Initial 23 intended assertion failures; later focused RED covered pending hard-link recovery, lost artifact, pending→ready rejection, hard exits, foreign same-source winner, corrupted recovery backup, blocked acquisition, idle heartbeat and cleanup acknowledgement |
| GREEN / REFACTOR      | Worker 39/39; final typecheck/build pass; refactored typed fixture factory and bounded acquisition settlement without changing behavior                                                                                                                                  |
| UI / Gallery / Chrome | Not applicable: no React, visible copy, components, tokens, routes or capability change; review debt zero                                                                                                                                                                |
| LOCALIZATION          | KO/EN unchanged, new visible keys zero; existing translation completeness and locale regressions pass in unit suite                                                                                                                                                      |
| DOC_SYNC              | Architecture, this evidence, selected Step, Phase overview and media/jobs contract updated                                                                                                                                                                               |
| LESSONS_LEARNED       | `yk-rulebook-reconcile mode=postflight`: skipped(no_new_lesson); observed fixes did not meet high debugging/token-cost capture eligibility; no canonical write or Rulebook sync                                                                                          |
| GATE_CHECK            | Required implementation, verification, documentation and resource cleanup complete; no user-only test for this Step                                                                                                                                                      |

## Commands and results

Every command below ran at repository root under the pinned session-local toolchain.

| Command                                                    | Result                                                                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `node --version`, `npm --version`                          | v24.20.0 / 11.19.0; exit 0                                                                                               |
| `npm run test:unit -- apps/api/test/import-worker.test.ts` | 39 tests passed, exit 0                                                                                                  |
| `npm run test:unit`                                        | 350 tests, 31 files passed, exit 0; includes import/storage/boundaries/session/backup/playlist/player/locale regressions |
| `npm run test:contract`                                    | 111 tests, 14 files passed, exit 0                                                                                       |
| `npm run typecheck`                                        | All workspaces and test sources passed, exit 0                                                                           |
| `npm run build`                                            | All workspaces built, migrations copied, exit 0                                                                          |
| `npm run format`, `npm run format:check`                   | Project Prettier applied and verified                                                                                    |
| `git diff --check`                                         | No whitespace errors                                                                                                     |

An initial broad contract attempt passed 108 tests and failed three Docker gateway tests because the
local Docker daemon was stopped. Starting Docker Desktop and rerunning the exact gateway file passed
all three; the final complete contract suite passed 111/111. Existing JSDOM HTMLMediaElement
not-implemented diagnostics remained non-failing and were not hidden or converted into skips.

## Crash, cancellation and privacy evidence

- Temporary SQLite/file roots plus controlled clocks prove one active claim, one expired recovery,
  stale-owner fencing, engine version persistence and no re-download during recovery.
- Synthetic executables cover nonzero exit, mismatched probe ID, missing/empty/non-audio output,
  symlink/root escape, multiple after_move records, stdout overflow and bounded process timeout.
  Assertions include the distinct sanitized failure code, no final file/event and staging cleanup.
- Boundary exceptions simulate claim/downloading/postprocessing/intent/published/receipt response loss.
  Three additional child processes exit immediately at pending fsync, final link and directory fsync,
  bypassing JavaScript finally; SQLite reopen recovers exactly one final file/event and removes the
  owned pending name. These are process-crash tests, not physical power-loss tests.
- Durable pending inode identity distinguishes a resumed own publication from an external same-source
  winner, including when the external file appeared after intent and before restart.
- Queued/running cancellation, cancellation after publication, SIGTERM, stalled engine acquisition,
  idle heartbeat and cleanup acknowledgement are covered. Existing final files are never removed.
- Duplicate source imports add no second event. A conflicting legacy payload is unchanged byte-for-byte.
  Mixed job siblings remain independent; only failed items can enter a retry job.
- Schema v3 migration preserves an existing MediaLink and its referencing import item. Backup/restore
  preserves pending rows and rejects tampered staging traversal. Pending links cannot become ready.
- Logger assertions reject synthetic private metadata, URL and filesystem names. Evidence contains no
  actual credentials, music files, personal metadata or raw process stderr/argv.

## Additional runtime probes

1. **Real MP3 verification:** a short synthetic tone was generated with real FFmpeg in a disposable,
   network-disabled/read-only container using an already available image. Local Node 24.20.0 ran the
   built worker with a deterministic seed fixture, and ffprobe received only the opened file's bytes
   through an isolated SSH/container invocation. MP3 publication, one pending event, source mismatch
   rejection, non-audio rejection and staging cleanup all passed. No YouTube or user media was used.
2. **Cross-filesystem publication:** built worker modules ran in a disposable Node 24.20.0 container
   with distinct staging/music tmpfs mounts. Device IDs were asserted different. Synthetic audio
   verification exercised copy/fsync/no-replace publication, one receipt and cleanup successfully.
   This probe tests filesystem behavior; the separate real-MP3 probe tests the actual audio decoder.

Remote environment/runtime and listening ports were inspected before these probes. Containers used no
published ports, network, production mounts or persistent volumes and removed themselves on exit.
Local smoke files were removed. Gateway harness containers/networks and child processes were cleaned.
Docker Desktop was started for the local contract run and left available; no existing service was
stopped. No browser tabs/dev servers, operational deployment, DNS or real library modifications.

## Remaining owner boundaries

- Step 04 must populate the exact gonic mapping before ready; this worker deliberately stops at registering.
- Step 07 supplies an immutable/versioned production engine; Step 09 wires its runtime and filesystem support.
- Real YouTube/nightly compatibility and deployment crash/power-loss behavior remain later runtime validation.
- If a process dies after linking but before the receipt, completion time is the first recovery observation
  of a confirmed publication; the lost syscall timestamp is not invented or replaced by filesystem mtime.
