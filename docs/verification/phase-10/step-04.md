# Phase 10 Step 04 verification

Extended the installed `musiclatte-id3-organize` skill from one exact song to one explicitly
selected current-account favorites collection or owned playlist while preserving the one-song
research and mutation contract for every frozen item.

## TDD and skill validation

- RED: the installed-skill contract failed because the frontmatter allowed only one song and no
  collection routing reference existed.
- GREEN: the skill now routes collection-only preflight, sequential processing, item/batch failure
  policy, checkpoint resume, and safe final reporting through `references/batch-operation.md`.
- The reference keeps Apple Music exact-release JPEG priority, field-bound official evidence,
  unknown omission, lyrics prohibition, immediate accepted-job checkpointing, and no replay of
  succeeded items.
- The integrated `[A,B,A]` harness skips ambiguous `A`, resumes accepted `B` with the same stable
  operations, marks `B` succeeded, and finishes with total 2 / succeeded 1 / skipped 1 / blocked 0.
- Existing one-song client behavior, private journal boundaries, item/system failure tables, and
  source-account reference migration remain covered.
- Skill Creator quick validation passed against the resolved installed symlink source.

## Isolated devserver result

Runtime and occupied ports were inspected first. A dedicated `musiclatte-p10-s04` Compose project
used loopback ports 18840/18841, an isolated work/config directory, and new named volumes. A real
current-account favorites selection and a test-owned playlist with ordered `[A,B,A]` occurrences
produced this sanitized result:

```json
{
  "schemaVersion": 1,
  "status": "succeeded",
  "checks": {
    "favoritesFrozen": true,
    "ownedPlaylistFrozen": true,
    "occurrenceCount": 3,
    "uniqueTrackCount": 2,
    "duplicateOccurrenceCount": 1
  }
}
```

The initial isolated worker credential did not belong to the new upstream and correctly surfaced
as unavailable; both attempts performed their owned-resource cleanup. After provisioning the
isolated credential, the probe passed. Its test-owned playlist, added star, and PAT were removed in
`finally`. Containers, network, private credentials, and temporary source/config paths were then
removed; all 12 named volumes were retained and no existing volume or user media was deleted.

Phase 9 Step 08 remains the runtime evidence for the reused per-song final ID3v2.3, one-JPEG,
decoded-audio identity, managed-path, old-path absence, gonic binding, duplicate playlist/star
migration, and same-source reimport checks. Phase 10 adds selection and orchestration without
weakening or reimplementing those invariants.

## Final gates

- Contract: 2 files, 27 tests passed.
- Unit: 2 files, 9 tests passed.
- Typecheck, production build, format check, and `git diff --check` passed. Vite emitted only its
  pre-existing large-chunk advisory.
- Agent Rulebook postflight: `skipped(no_new_lesson)`; no reusable production-code lesson was added.
