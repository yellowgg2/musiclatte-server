# Metadata reflection and reference integrity

The metadata worker calls `beforeWrite` to capture the authenticated account's visible ordered
playlist IDs/occurrences and target star state. It persists this private baseline before any
file transaction. After file_saved, the reflector validates the saved file digest, performs the
shared scan cycle, locates exactly one configured path and verifies the same song ID, account
references and standard projection. A successful file transaction alone is never `succeeded`.

Imports and metadata share `registration_cycle` ownership/cooldown through `scan-coordinator`.
The extracted exact-path lookup preserves P3 traversal and per-visibility-round caching. The
scan remains full-library; narrow path lookup is not a scoped scan. Current metadata generation,
scan owner, deadline and file digest are checked before completion. Stale ownership cannot
publish success or release another owner's scan lock.

The standard adapter now preserves optional `genre`. Projection evidence separates all verified
file fields from standard index fields and file-only albumArtist/lyrics. gonic's scalar artist
and genre projections can represent one of multiple file values; their full arrays are not
claimed as standard verification. Empty title falls back to the filename including extension.
An absent track artist may fall back to an album artist. Missing standard values do not count
as positive evidence. Mixed folder albums can report another track's album metadata and remain
`reflection_mismatch`; the server does not retag or move files to conceal that limitation.

A changed song ID, ordered occurrence/star mismatch or missing baseline is `reference_conflict`.
The candidate ID is not made a new available MediaLink and no playlists, stars or aliases are
rewritten. Unreachable accounts are not treated as verified; inaccessible foreign-account state
is outside this evidence scope. Tests preserve duplicate occurrences [A,B,A].

Schema v10 adds bounded private reference/reflection evidence and a persisted reflection retry
deadline. A waiting reflector releases its file claim, allowing an authorized restore to run.
Recheck schedules only reflection, never another file write. An older job superseded by a known
saved edit/restore becomes a revision conflict; unrelated unknown bytes require manual recovery.
This distinction prevents an old pending reflector from treating the user's successful restore
as unexplained external corruption. Public change records contain IDs/revisions/field names,
not file paths, tag payloads, credentials or private reference snapshots.

## Verified gonic v0.22.0 cover limitation

The pinned handler [ServeGetCoverArt](https://github.com/sentriz/gonic/blob/v0.22.0/server/ctrlsubsonic/handlers_raw.go)
checks a disk cache keyed by cover ID, requested pixel size and format before rereading the MP3.
A scan does not make a warmed size observe the updated image. The
[cache ejector](https://github.com/sentriz/gonic/blob/v0.22.0/cache/cache.go) is size-based LRU,
not a revision-aware refresh guarantee. Browser cache busting alone cannot fix this server cache.

The actual isolated profile reproduced an exact cover-only mismatch at the already-requested
size. A previously unused size decoded the new embedded synthetic cover, diagnosing an upstream
cache limitation rather than a writer failure. This alternate size was diagnostic only; the
product does not change sizes to manufacture reflection success. Warmed-size mismatch remains
`reflecting` with `reflection_mismatch`, recheck and original restore. Restoring original bytes
also restored agreement with the warmed cover and preserved IDs/references/streams. Shared gonic
cache volumes were never deleted or altered by this implementation.

This is the Step 05 plan's explicit known-cache-mismatch path, not a claim that warmed native
covers update immediately. S06 capabilities/API and S08–S11 clients must preserve this honest
file-saved/index-mismatch distinction. The normal scalar/ID/reference/stream profile is verified;
blanket immediate cover-reflection support is not advertised. Native client caching remains a
separate concern. Clear tags/artwork can expose gonic folder/album fallback and are compared to
actual observations instead of being treated as automatic success.

Other primary evidence: [scanner](https://github.com/sentriz/gonic/blob/v0.22.0/scanner/scanner.go),
[tag projection](https://github.com/sentriz/gonic/blob/v0.22.0/server/ctrlsubsonic/spec/construct_by_tags.go),
[getSong](https://github.com/sentriz/gonic/blob/v0.22.0/server/ctrlsubsonic/handlers_common.go).
