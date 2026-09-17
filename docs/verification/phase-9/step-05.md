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

## 2026-09-17 explicit managed-target replacement recovery

- RED: after an operator-backed duplicate overwrite moved a different verified source into an
  existing managed destination, registration repeatedly returned `conflict` because the stale
  destination MediaLink had terminal metadata and organization history.
- GREEN: schema v30 records one same-PAT, same-job target-replacement approval with an immutable
  request hash plus backup-receipt and reference-snapshot digests. Ordinary alias adoption remains
  same-audio and unowned; only the explicit approval branch may retire a managed different-audio
  alias.
- Safety: the exact target alias, verified MP3 projections, source binding, inactive claims and
  displaced work, and deterministic retired key are checked in one transaction. The displaced
  curation row is tombstoned while its audit history remains; the stable source MediaLink and
  curation row become the successor.
- CLI: the journal-bound replacement command reads only owner-private evidence files and transmits
  their SHA-256 digests, never local paths or evidence contents.
- Verification: focused organization storage unit tests, metadata organization API tests, and ID3
  client contract tests cover default conflict, scoped/idempotent approval, redacted responses,
  distinct-audio replacement, and preserved history.

## 2026-09-18 terminal displaced-metadata recovery

- RED: a digest-bound explicit replacement still failed during gonic rebind when the displaced
  MediaLink retained a terminal metadata `recovery_required` audit row.
- GREEN: only that terminal metadata stage is excluded from the displaced alias live-work guard.
  A `reflecting` metadata item remains blocking, while the same item at `recovery_required` permits
  the already approved replacement.
- Safety: exact alias identity, verified curation rows, approval digests, inactive import and
  organization work, no active curation claim, and retired-key collision checks remain unchanged.

## 2026-09-18 reused Gonic ID during replacement

- RED: after an exact-path replacement, Gonic reused the displaced destination song ID and the
  table-wide curation identity uniqueness constraint rejected the source rebind.
- GREEN: when and only when that ID is reused, the displaced tombstoned curation row receives a
  deterministic internal retired identity before the live source row claims the Gonic ID.
- Safety: the replacement ledger retains the real displaced song ID; both curation audit rows,
  immutable history, backup evidence, and active-row ownership remain intact.
