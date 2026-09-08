# Phase 4 Step 11 — Metadata recovery and original restore

Status: implementation complete; final acceptance pending in the Phase 4 Obsidian `ui-acceptance.md`. Baseline: S11-source-194b6e82a9a4a4ec. Separate authorized Git handoff follows.

## Behavior and ownership

Conflict review compares the original submitted intent with a newly read snapshot. Opening the editor uses only current values; old changes are not replayed. Saving still requires a new summary and operation. Saved items use the recheck endpoint, which performs library lookup without rewriting tags. Unsupported or unavailable recovery actions are not invented.

Restore review names the song, original backup time, current file revision and changed original/current fields, including lyrics and cover descriptors. It warns that the entire file is restored and all later edits are undone. Cancel performs no write. A revision conflict invalidates the comparison and requires explicit reload. An uncertain network response retains the operation identity for a safe resend. Accepted restore is a durable job; completion is announced only after file restoration and library verification succeed.

S11 owns the additive actor/library-scoped `GET /api/v1/metadata-jobs/:id/items/:itemId/restore-preview` producer, strict contract/client decoder, and schema v12 `metadata_backup_previews` migration. The worker projects digest-verified original tag summaries from private backups, including historical backups. The API receives no backup mount, bytes or private paths. Current values are freshly resolved with restore permission and revision checks. Public job/restore request contracts and the existing writer remain intact.

Projection work is bounded to one backup read per worker cycle. Corrupt backups are deferred, and a rotating bounded query prevents more than 64 corrupt entries from blocking later valid backups. No original backup is modified by indexing.

## Verification

Node 24.20.0 / npm 11.19.0, session-local toolchain; Vitest RED → GREEN.

- Full unit suite: 664 tests / 56 files passed.
- Full contract suite: 153 tests / 25 files passed.
- Typecheck, build and format:check passed after production changes.
- Subsequent corrupt-backup fairness regression: RED reproduced starvation beyond the first 64 entries; GREEN passed. Metadata runtime/worker regressions: 12 tests / 2 files passed. Typecheck/build passed again.
- Final source-only long/partial scenario additions: metadata-ui contract 7 tests / 1 file and typecheck passed.
- Recovery UI tests cover recheck-only dispatch, original comparison/revision fence, cancel, fresh conflict draft, unavailable actions, conflict invalidation, and uncertain-response operation reuse. API tests cover pending projection, scoped original/current data, foreign item and removed restore permission. Migration regression fixtures cover v12.

No zero-test or skipped run is counted as success. Browser/media behavior is reported separately from jsdom tests.

## Actual server roundtrip

An isolated API/worker/gonic/web stack used two generated three-minute MP3 files with synthetic lyrics, APIC and TXXX. Chrome played a song while saving a new title, then changed album/year on both songs. New title search, existing lyrics/covers and stable IDs were verified. Chrome accepted both bulk-item restores; a final restore reversed the earlier single edit. All three restore jobs reached `succeeded`.

Both whole-file SHA-256 hashes matched the originals exactly after restoration, covering audio and untouched frames. Original tags/lyrics and indexed titles matched. The `[A, B, A]` playlist occurrence order, star, both gateway streams and cover responses remained valid. `runtime.json` contains only sanitized results. Runtime Node 24.20.0, gonic v0.22.0, schema v12; owned services healthy and existing gonic-demo preserved.

S04/S05/S07 evidence remains the writer/reflection/runtime prerequisite. Known gonic warmed-cover cache and album-clear fallback limitations remain: a mismatch is not reported as verified, caches are not deleted, and no native cache improvement is claimed. This roundtrip preserved cover content; actual changed-cover behavior on iPhone remains a separate observation.

## Review, postflight and resources

See `browser.md` and `native-checklist.md`. STRUCTURAL/full/self, shared-new=0, Gallery change=none. Observed residual FATAL0/MAJOR0; full pass is pending actual 200% zoom, touch/reduced-motion and device requirements. S09/S10 approvals do not satisfy S11.

Rulebook postflight: `skipped(no_new_lesson)`. This cycle's quick signature/fixture corrections and bounded-query fix did not meet the required high debugging/token cost threshold. Canonical write, exact re-search and sync: not applicable. Registry search/prepare/add tools were available. Existing popup-scroller and player-error guidance was reused; no project lesson file was accessed.

The isolated test stack was retained during user observations and has now been cleaned up. Existing services and real music are preserved. The source-only recovery harness was stopped; future acceptance must start a fresh fixture. Obsidian Step/overview/catalog stay outside repository Git.

### Device feedback follow-up

The user confirmed Musiclatte 1.8 on iPhone 12 Pro / iOS 26.6.1: playback continued during title change; Favorites showed the new title while now-playing retained the previous title. After original restoration, Favorites, playback/seek and the repeated playlist order were confirmed normal. Safari entry exposed a mobile action alignment issue, now fixed and deployed to the isolated test web with 40 affected tests, typecheck/build/format verification. See browser/native evidence for the precise remaining Safari and Chrome gates.

## Final implementation handoff — 2026-09-08

The updated shared deferred-acceptance contract applies to this unfinished legacy Step. Remaining visual/device checks moved to Phase 4 `ui-acceptance.md` P4-UA-001–010; pending/stale checks are not passed and no longer block authorized implementation Git. S09/S10 decisions/evidence are preserved.

The user confirmed the Safari alignment fix and initial playback. Native now-playing title remaining stale is a recorded observation; Favorites changed/restored title, playback/seek and repeated playlist order were confirmed. Safari cross-edit/restore, software keyboard, changed-cover native refresh and final zoom/motion/affected-row matrix remain pending.

Final complete source: unit664/56 files, contract153/25 files, typecheck/build passed. Final Prettier/format:check is part of Git handoff. Rulebook remains skipped(no_new_lesson); no canonical write/sync.

Owned local harness and remote S11 containers, volumes, tagged images, synthetic media/playlist/star/private test directory were removed. Existing gonic-demo remains running. The earlier LAN test URL is no longer live; future acceptance must start a fresh isolated fixture. Existing runtime evidence remains valid, not a claim that unexecuted device checks passed.
