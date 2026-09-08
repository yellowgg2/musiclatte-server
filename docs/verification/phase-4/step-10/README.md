# Phase 4 Step 10 — Bulk metadata editor

Status: complete. Automated verification passed; the user confirmed S10 touch and reduced-motion interaction on 2026-09-08. Git handoff follows separately.

## Behavior and ownership

SelectionBar consumes the existing loaded selection, deduplicates song IDs, shows occurrence/file counts and enforces the 64-file limit. The feature-local loader shows unavailable reasons, requires explicit exclusion, and presents named song groups for explicit library selection. The existing editor preserves mixed and untouched values, sends only dirty set/clear operations, and previews titles, exclusions and per-file revisions. Only the seven advertised normal fields are enabled for bulk editing; cover and lyrics point to single-song editing.

Failed/conflicted unsaved items can be reviewed against fresh snapshots and the original patch before a new operation is submitted. Saved/reflecting items are excluded from rewrite retry. Selection, locale drafts and existing playback are preserved.

S10 also owns the additive actor/library-scoped `GET /api/v1/metadata-jobs/:id/items/:itemId/intent` producer and strict client decoder needed after history reload. Public job DTOs and the database schema are unchanged. A shared scan cooldown check before reflection claiming prevents persistent mismatches from repeatedly delaying later work; the atomic acquire/lease checks remain in place.

## Verification

Session-local Node 24.20.0 / npm 11.19.0. After formatting:

- Unit: 198 passed / 26 files (`apps/web/test`, `tests/unit/workspace.test.ts`, API metadata-api/reflection/runtime).
- Contract: 17 passed / 4 files (metadata-ui, metadata-api, playlist-ui, production-exclusion).
- Typecheck, build and format:check passed.
- Following the final source-only conflict-fixture extension: metadata-ui contract 5/5, typecheck, build and format:check passed again. Production source remained unchanged.
- RED covered missing bulk helpers, mixed-value initialization, loader and toolbar integration, fresh-revision retry, intent route/decoder and reflection claim during cooldown. GREEN retained the existing single-editor and player/selection regressions. No zero-test or skipped run is counted as success.

### Actual file roundtrip

An isolated devserver API/worker/gonic stack patched two generated MP3 files. `runtime.json` records the sanitized results: common album/year set, explicit genre clear, distinct titles/artists, original lyrics and other untouched ID3 frames including TXXX, audio payloads, stable IDs and same-operation identity all preserved/verified.

Earlier probes exceeded a 90-second observation window while scan cooldowns were queued; the final probe used a 360-second deadline and completed. No immediate-reflection SLA is claimed. Older mismatch jobs remained pending while later files verified after the fairness fix.

Observed gonic constraint: clearing an MP3 album frame can leave a fallback album value in the index. The file clear is real, but reflection remains `reflection_mismatch`; no false verified state or cache manipulation is used. S11 recovery inherits this limitation.

## UI review and remaining gate

See `browser.md`. STRUCTURAL/full/self, shared-new=0, Gallery change=none. Automated observations found two mobile layout issues, both fixed and rechecked. Full passed: FATAL0/MAJOR0/debt0. Touch/reduced-motion passed(user/manual) with explicit S10 confirmation; S09 evidence is separate.

Native window inspection failed with `cgWindowNotFound`, so touch/reduced-motion were verified manually by the user. Actual 200% zoom was verified automatically and restored. No S11 deferral.

## Postflight and resources

Central Rulebook postflight returned ambiguous/related dedup for the cooldown lesson candidate. No canonical lesson was added, no central file changed, and no Rulebook Git sync was needed. This is nonblocking.

The owned remote containers, volumes, temporary stack directory, synthetic media and S10 images were removed; existing gonic-demo remains running. The owned local source-only harness at `http://127.0.0.1:18501` was stopped after S10 user verification. It contains synthetic data and no production deployment. Obsidian Step/overview/catalog are outside this repository and excluded from Git.
