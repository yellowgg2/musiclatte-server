# Phase 9 Step 04 verification

- RED: scheduler organization turns and durable-baseline resume initially failed; the organization
  file store and worker modules were absent before this Step.
- GREEN: schema v24 move preimages, canonical two-file fences, descriptor-relative target-parent
  preparation, atomic same-filesystem rename, parent fsync, post-move identity verification, and
  filesystem-owned forward recovery are implemented.
- Unit: `media-fence.test.ts`, `organization-file-store.test.ts`, `organization-worker.test.ts`,
  `curation-publication-race.test.ts`, `organization-storage.test.ts`, and
  `metadata-runtime.test.ts` — 22/22 passed.
- Fault matrix: injected `before_rename` is source-only; `after_rename` and `after_fsync` are
  target-only; both, neither, and identity mismatch are ambiguous. An expired `moving` lease is
  reclaimed as filesystem-owned recovery.
- Race/safety: opposite source/target request order does not deadlock; active publication,
  existing and Unicode/case-equivalent targets, symlink parents, replaced target-parent inode,
  unsafe root permissions, and identity changes fail before source loss.
- Preservation: real filesystem assertions confirm source absence and unchanged target bytes,
  device/inode, mode, uid/gid, and audio identity after a successful move.
- Privacy: fixtures contain synthetic bytes only and test output contains no real media path,
  metadata, or payload.
- gonic rebinding and playlist/star mutation: intentionally deferred to Steps 05 and 06.
- Rulebook: runtime/deployment alignment remains satisfied; postflight is
  `skipped(no_new_lesson)`.

Final gates: project formatting, focused unit tests, typecheck, build, `format:check`, and
`git diff --check`.
