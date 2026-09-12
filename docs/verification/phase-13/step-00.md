# Phase 13 Step 00 verification

Status: local and devserver implementation verified; production rollout pending.

## Implemented contract

- Legacy four-key inventory policies normalize to `itemTimeoutMs = batchTimeMs`, a disabled retry budget, and unchanged public policy version.
- Explicit seven-key policies separate per-item timeout, total batch budget, retry interval, retry ceiling, and full-sweep interval.
- Batch-budget expiry and external shutdown leave the in-flight queue row pending. Only an item deadline or upstream failure increments its durable attempt checkpoint.
- Ordinary pending tracks and directories are selected before due retries. Retry state survives worker restart and terminal failures do not busy-loop.
- Migration 026 adds queue retry checkpoints and the private `curation_inventory_failures` ledger while preserving existing version 25 queue rows.
- Full sweeps use `last_reconciled_at` after discovery completion instead of the original discovery start time.
- Batch summaries contain only processed/succeeded/retry-scheduled/terminal counts. Failure logs contain safe kind/code/cause values and no item identifier or raw exception text.

## TDD evidence

- RED: 8 intended failures across config normalization, retry columns/ledger, batch cancellation, completion-time sweep, and aggregate logging.
- GREEN focused: 42 tests passed across automation config, inventory, runtime, and session storage.
- API unit suite: 69 files and 754 tests passed.
- Contract: 3 files and 7 tests passed for automation deployment/roundtrip and curation schema.
- TypeScript typecheck passed under Node 24.20.0 and npm 11.19.0.
- Production build passed. Vite reported the pre-existing large-chunk advisory only.
- Prettier format/check and `git diff --check` passed.

The full workspace unit run reached 1,033 tests after exposing stale historical schema expectations. Those expectations and fixtures were aligned to schema 26. One unrelated pre-existing web playlist occurrence test still fails because its mocked song list never renders; it also reproduces when run separately and no web source was changed in this Step.

## Runtime rollout

- Devserver synthetic slow-item probe: passed in the pinned Node 24.20.0 build image. Config, inventory, and schema tests passed, including the Linux batch-budget timer case and version 25 queue upgrade. The unrelated runtime fixture requiring a host-specific ffmpeg path was excluded; the two changed runtime log tests passed separately. The dedicated work directory and image were removed afterward.
- Production private policy and management database backup: pending.
- Unraid worker rollout, health check, and inventory aggregate comparison: pending.
- Favorite ID3 batch resumption: pending until production inventory is stable.
