# Phase 6 S05 — background inventory and reconciliation

Implementation complete; direct UI acceptance not applicable. Base `7c762a7`; branch `yellowgg2/tdd/phase-6/step-05-curation-inventory`.

Migration 019 adds a transaction-local source event outbox, private field fingerprints, consumed sequence and tombstones. SQLite triggers emit P3 publication/registration and P4 file_saved/succeeded events in the producer transaction. Persistent per-library BFS includes root songs/shortcuts and removes cycles/duplicates by opaque ID; bounded batches, cancellation and durable checkpoints resume unfinished work. List queries only read projections. Periodic sweeps reuse discovery and inspect actual digests rather than trusting stat changes; no additional scan scheduler is introduced.

The worker-only reconciler reuses P4 descriptor inspection, metadata helper, packet identity, relative-key rules, MediaLink binding and HMAC revisions under the shared fence. Required/audio changes invalidate completion, optional-only changes retain immutable receipts, and restoring old bytes never automatically completes a reopened review. Actual field fingerprints and consumed write events preserve or invalidate absence evidence. Only a completed directory traversal and exact current path permit ID rebinding; previous review history is tombstoned and the new ID starts unreviewed. Missing discovery members are tombstoned only after successful complete traversal. Unsupported/unreadable files stay unknown or stale with partial coverage.

## Verification

Pinned Node 24.20.0/npm 11.19.0; existing cached Python/FFmpeg.

- RED: inventory and real-file reconciliation tests each executed and failed for missing implementation.
- GREEN: owner/producer tests passed 72 tests across inventory, reconciliation, metadata reflection and import worker; migration/compatibility run passed 73 tests across 10 files. The final bounded cancellation enhancement passed all 4 focused tests.
- Actual HTTP adapter fixture proves getIndexes root child/shortcut and folder selector handling while legacy indexes DTO remains unchanged.
- Real synthetic MP3 tests cover optional receipt preservation, same-size/restored-mtime content changes, original-byte restore, audio replacement and verified opaque-ID rebinding. Domain tests cover partial-library failures, restart replay, cyclic/duplicate directories, no helper reads from lists, disappeared membership and batch cancellation.
- `tests/contract/curation-schema.test.ts`: 1 passed. Typecheck/build/format:check passed.

No runtime timers/volumes or production services activated; S10 owns lifecycle wiring. No UI/Gallery/localization changes. DOC_SYNC/ACCEPTANCE_SYNC complete, direct acceptance not_applicable. Fixture processes and temporary media belong to tests and are cleaned. Rulebook postflight `skipped(no_new_lesson)`, no central write/sync.
