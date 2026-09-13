# Phase 17 Step 06 verification

## Scope

- Private parent sweep journal with strict capture, runnable, blocked, and terminal states.
- Unorganized-only batch schema v3 with `mediaLinkId`, stable ordinal, deterministic operation IDs, and additive terminal outcomes.
- Sequential `sweep-start`, `sweep-next`, and `sweep-status` orchestration over the Phase 17 Step 05 snapshot API.
- Existing favorites and playlist batch v1/v2 decoding and commands remain supported.

## RED evidence

Before implementation, the focused sweep contract failed because `tools/id3-organize-sweep-journal.ts` and all three sweep commands were absent: 2 tests failed in `tests/contract/id3-organize-sweep.test.ts`.

## Recovery and security evidence

- A 1,001-item synthetic selection is captured without loss or duplication into private sibling shards of 1,000 and 1 item.
- Parent and child atomic writes cover `before_write`, `after_temp_fsync`, and `after_rename`; replay retains a valid old or new checkpoint and reuses the same media-link-bound operations.
- The first server page is durably written to a selection-specific child before the parent appears. An interruption can leave only an unreferenced selection-specific child, so a new selection cannot collide with or silently adopt it.
- Read validation rejects unsafe modes, symlinks, hard links, non-owner files, non-regular files, escaping/absolute shard references, unknown schema fields, and mismatched API/PAT fingerprints.
- Parent state contains only fingerprints, snapshot identity/times, summary, cursor, relative shard names, and aggregate counts. Tests verify it contains no PAT, absolute state path, evidence, lyrics, cover checkpoint, or media filesystem key.
- A snapshot expiry or scope change during capture produces a blocked parent and never makes the partial selection runnable. Final-page count mismatch is also blocked.

## Live-state and compatibility evidence

- A pending item is revalidated by `media_link` target immediately before research.
- `organized`, `processing`, `attention`, and `unknown` become `already_organized`, `deferred_processing`, `deferred_attention`, and `blocked_identity`, respectively, without a metadata or organization job request.
- Only `needs_organization` enters `researching`. Once the child owns workflow state or a recorded job, resume uses the same child/PAT fingerprint and does not discard it for another preflight.
- Status output contains aggregate counts and a numeric shard/item checkpoint, not titles, absolute paths, credentials, or an item listing. `completed_with_summary` reports exact non-success outcomes instead of claiming all files are organized.
- Legacy batch and reference-guard suites verify v1/v2 normalization, existing CLI behavior, and current-account reference binding alongside the unorganized child.

## Commands

```sh
export PATH="/Users/incredibleyoung/.cache/musiclatte-toolchain/node-v24.20.0-darwin-arm64/bin:$PATH"
npm run format
npm run test:contract -- tests/contract/id3-organize-sweep.test.ts
npm run test:contract -- tests/contract/id3-organize-batch.test.ts tests/contract/id3-organize-client.test.ts tests/contract/id3-organize-reference-guard.test.ts
npm run typecheck
npm run build
npm run format:check
git diff --check
```

All commands passed on 2026-09-14 with Node 24.20.0 and npm 11.19.0. The build retained only the existing Vite large-chunk warning.
