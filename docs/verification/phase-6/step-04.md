# Phase 6 S04 — shared publication fence

Implementation complete; direct UI acceptance not applicable. Base `da9d141`; branch `yellowgg2/tdd/phase-6/step-04-media-serialization`.

The extracted Python flock module checks canonical root identity, ownership/mode, nofollow regular single-link lock files and linked inode identity. Existing P4 backup/candidate/rename/ack retains one process and uses the shared namespace when configured; omitted shared root preserves the private-root fallback. Recovery acknowledgements now include the worker's durable DB classification before releasing the shared lock. The read-only holder supports bounded IPC, explicit validation, EOF/crash release and no media writes.

Migration 018 adds durable publication generation, dirty marker and observed digest. Generation does not replace the OS lock or item lease. P3 shared mode obtains the fence before publication checks, writes the dirty marker before rename, retains the fence through exact-file readback, binding/event commit and recovery. File IO happens outside SQLite transactions in shared mode. Registration commits use the same optional protection. Existing session editor admission rejects active curation reservations. `verifyLockedSnapshot` retains the fence across before/after file observations and a short caller-owned receipt transaction; an uncooperative external writer's detected change rejects completion.

## Verification

Pinned Node 24.20.0/npm 11.19.0, existing cached Python/FFmpeg synthetic fixture tools.

- RED: new media fence test executed and failed for the absent implementation.
- GREEN: 9 affected unit files passed 122 tests, covering actual competing child processes, SIGSTOP/SIGCONT/SIGKILL, lease-independent lock ownership, pre-rename and post-rename lost ack, recovery while another process is excluded, durable dirty generations, stale generation rejection, P3 crash/restart publication and existing backup/worker/registration behavior.
- Additional migration/compatibility unit checks passed 25 tests across 5 files. Shared root must be separate from music and private data roots. The injected external writer changes bytes between verification observations and never commits a receipt.
- `tests/contract/metadata-api.test.ts` passes unchanged consumer behavior. Typecheck/build/format:check pass.

No production cutover. S10 owns explicit shared runtime volume/config and startup probes for all writers; automation activation must require that configuration. Filesystem cooperation is required for flock serialization; arbitrary external writers are handled by before/after digest verification and later reconciliation, not a claim of universal atomicity. Dirty state remains until inventory verifies current fields/audio/binding. Offline restore rotates generations and marks publication state dirty.

No UI/Gallery/locale changes. DOC_SYNC/ACCEPTANCE_SYNC complete, direct acceptance not_applicable. Tests own and clean helper processes and temporary artifacts. Rulebook postflight `skipped(no_new_lesson)`; no central write/sync.
