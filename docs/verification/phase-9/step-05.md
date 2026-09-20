# Phase 9 Step 05 verification

- RED: organization scan/registration did not exist, and the current import migration assertion
  still expected schema v21 instead of the Phase 9 schema.
- GREEN: a bounded organization registration adapter shares the scan coordinator, resolves exactly
  one target path, verifies source absence plus audio/ID3 projection, and supports retained or new
  gonic song IDs.
- Stable binding: one lease-fenced transaction updates the existing MediaLink path/song/revision,
  all metadata `current_track_id` values, and the current curation track/file binding. Original
  metadata IDs and append-only curation/download history remain unchanged.
- Provenance/import: the completed rebound records the existing import source ID at the managed
  key. Import workers check that mapping before engine acquisition for both legacy and account jobs,
  validate the managed file as a duplicate, and mark a missing/mismatched mapping unavailable
  without falling back to the legacy path.
- Current readers: historical metadata work and recent-download projection resolve through the
  rebound MediaLink key and song ID.
- Failure matrix: zero/multiple exact candidates, audio mismatch, projection mismatch, timeout, and
  lost ownership retain gonic-owned recovery. A contending process cannot release another scan
  owner.
- Unit: focused organization, curation, import, and recent suites — 107/107 passed; extended
  organization storage suite — 5/5 passed.
- Contract: `automation-roundtrip.test.ts` — 1/1 passed; existing metadata/curation HTTP behavior is
  unchanged and no organization route is public yet.
- Rulebook: runtime/deployment alignment remains satisfied; postflight is
  `skipped(no_new_lesson)`.

Final gates: project formatting, focused unit/contract tests, typecheck, build, `format:check`, and
`git diff --check`.

## 2026-09-14 stale destination binding recovery

- An authorized cleanup found two same-release MP3s at the planned managed destination. The
  unorganized source matched the official store duration, while the existing managed file was
  longer. Both accounts had zero references to the managed file; the source had one owned-playlist
  occurrence in the secondary account.
- After the managed file was deleted and Gonic scanned, the source organization moved correctly and
  received one exact-path Gonic candidate, but registration could not rebind because the deleted
  file's old MediaLink still uniquely reserved the target key. The worker was paused after an
  owner-only management DB/WAL and policy backup passed integrity validation.
- The single stale MediaLink was moved to a deterministic unavailable retired key, its missing Gonic
  ID was cleared, and its curation row was tombstoned in one transaction with an append-only
  operator audit event. No Gonic DB row, unrelated MediaLink, reference, or media file was edited.
- After the worker restarted healthy, the existing organization job immediately rebound and
  succeeded. The secondary playlist occurrence was restored to the new track and the final ID3 plus
  one-front-JPEG checks passed. This is a bounded production recovery record, not a general license
  to merge duration-mismatched destination collisions automatically.
