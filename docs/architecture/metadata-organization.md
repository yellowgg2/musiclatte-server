# Metadata organization

Metadata organization is an opt-in, account-scoped operation. The authenticated PAT account is the
operator, while the configured account directory containing the source file remains the path owner.
Step 02 introduces only the
mutation-free `id3-managed-v1` path planner; file movement, durable jobs, gonic rebinding, and
reference migration are separate later boundaries.

## Operator configuration

`AUTOMATION_POLICY_PATH` may include an `organization` section with an explicit mapping from a
gonic username to one single-segment canonical account directory. An account may also declare
`legacyDirectories` (one to eight single-segment names) as source-only aliases. These let a file
still under an older directory be organized into the account's canonical `ID3-managed` directory;
they do not change the destination or migrate a whole directory. There is deliberately no fallback
from username to directory name. Absolute paths, slash or backslash separators, dot segments,
control characters, trailing dot/space, duplicate usernames, and Unicode/case-equivalent directory
names across both canonical and legacy mappings are rejected. Start from
`deploy/automation-config.example.json` and keep the deployed copy private.

The policy version is `id3-managed-v1`. A destination has this server-derived shape:

```text
<relativeRoot>/<accountDirectory>/ID3-managed/<albumArtist-or-artist>/<album>/<track - title>.mp3
```

The first album artist wins, otherwise the first artist wins. The numeric part before `/` in a
track number becomes a minimum two-digit prefix; the total never contributes to path identity.
Every metadata segment uses the existing NFC, illegal-character, reserved-name, trailing-dot/space,
and 160-byte media-name sanitizer.

## Preview boundary

The caller supplies identity, library authorization, current source key, and the current metadata
snapshot—not arbitrary destination segments. The PAT operator must have an explicit account
mapping, and the source must be below a configured canonical or legacy account directory. The
planner derives the destination account from that source directory, never from the operator's
directory. A legacy source always targets the owner's canonical directory.
It validates the source as a real regular file beneath the canonical music root and inspects the
destination without creating directories or moving bytes. A target under another account is
rejected, including when that other account belongs to the operator.

The result distinguishes `ready`, an exact already-managed `no_op`, and typed errors for missing
metadata, account/library violations, unsafe source or target components, Unicode-normalization or
ambiguous case-equivalent collisions, existing final destinations, and excessive input. A unique
NFC-stable case-only match for an intermediate target directory is reused with its existing on-disk
spelling so the immutable target key cannot create a second case alias. Missing target parents are
valid preview state; symlink parents and every equivalent final filename remain collisions.

## Durable operation ledger

Schema v23 separates immutable admission from mutable execution. `organization_jobs` owns the
actor/operation/request hashes, library, policy and metadata revision, and bounded source evidence.
Its one `organization_items` row owns the media link, immutable source/target keys and file/audio
identities, current stage, lease generation, encrypted accepted-work grant, baseline references,
and recovery owner. Attempts and events provide audit history; playlist/star checkpoints prevent a
completed reference mutation from being repeated. `organization_source_locations` later binds an
import source ID to the verified managed location.

The only normal path is:

```text
queued → validating → references_captured → moving → moved → scanning → rebound
       → migrating_references → verifying → succeeded
```

A failure before `moving` is terminal `failed` (or `conflict`). At or after the rename boundary it
is `recovery_required`, with a specific `filesystem`, `gonic`, `references`, or `verification`
owner. The repository uses a generation plus expiring owner lease, so an expired process cannot
commit a later checkpoint.

SQLite writer contention before the rename boundary is not a semantic operation failure. The
worker leaves the current pre-rename stage and lease generation reclaimable instead of writing a
terminal `failed` result. For jobs created by an older worker that already recorded one of the
recognized SQLite contention messages as `failed`, an exact submit replay may requeue only the same
job and item after current PAT, file, metadata revision, evidence, immutable intent, and absence of
a successor are all revalidated. The replay reseals the accepted grant and resumes from
`references_captured` when a baseline exists, otherwise from `queued`; every other terminal failure
remains terminal.

Accepted PAT work stores no raw token or upstream proof. A row-bound encrypted grant is tied to the
automation credential epoch and immutable organization intent. Revoking the PAT blocks new work but
does not erase an already accepted forward-recovery grant. Normal terminal completion clears it.
Offline restore invalidates all PATs and accepted grants, closes unfinished attempts, clears leases,
requeues work known to be before rename, and marks any possibly moved work `recovery_required`.

Backups validate organization rows and encrypted grants. A metadata backup refuses the ambiguous
`moving` stage; otherwise it snapshots the source key before move and target key after move. No
media bytes, cover bytes, lyrics text, passwords, or raw tokens enter the management database.

## Atomic move checkpoint

The metadata worker gives organization filesystem work one bounded turn per scheduler cycle.
Before rename it revalidates the accepted operator grant, current gonic user/library access, and
the source-derived account boundary for both the immutable source and target keys,
captures that account's star and playlist baseline, and durably records a v24 move preimage. A
crash after baseline capture resumes from `references_captured` without recapturing a possibly
changed post-move view.

Source and target file identities share the OS media-fence namespace used by import, metadata,
and curation. They are acquired in sorted order and the database publication state is checked
while held. The Python helper prepares and pins a real target-parent identity, performs only a
same-filesystem atomic rename, fsyncs the parents, and proves the source disappeared while file
and audio identities were preserved.

Injected crashes before rename classify as source-only; crashes immediately after rename or
after fsync classify as target-only. An expired hard-crash lease left in `moving` is promoted to
filesystem-owned recovery. Both paths present, neither path present, a replaced target parent, or
an identity mismatch never trigger an automatic reverse or overwrite.

## gonic and provenance continuity

After `moved`, the worker uses the shared scan lease and exact target-path lookup. It accepts both a
retained old opaque ID and a newly issued ID, but only after source absence, one exact candidate,
matching audio identity, and matching standard gonic/ID3 projection are proven. The stable
MediaLink ID is updated in place; historical metadata rows keep `original_track_id` while their
`current_track_id` follows the rebound song and restore reads the MediaLink's current target key.

The rebound transaction also moves the current curation track/file binding without mutating its
append-only receipt or event history. A fresh trusted snapshot reconciliation updates standard
field state. The import item that originally established the MediaLink supplies the YouTube source
ID for `organization_source_locations`; no raw source or media payload is copied into this mapping.

An explicitly approved target replacement still rejects any displaced alias with live metadata,
import, organization, or curation-claim work. A metadata `recovery_required` row is a terminal audit
checkpoint without a runnable claim, so it does not by itself keep the displaced alias active. Its
immutable history and backup remain preserved after the alias is retired; every nonterminal
metadata stage continues to block replacement.

Gonic may reuse the displaced destination's song ID when the replacement keeps the exact managed
path. The active source curation row owns that live ID after rebind. To satisfy the curation table's
all-history uniqueness constraint without deleting audit history, the displaced tombstoned row is
moved to a deterministic `musiclatte-retired:<curation-row-id>` internal identity only in this
reuse case. The replacement ledger retains the displaced Gonic song ID, and the tombstoned row
retains its immutable receipts and events.

The same successful replacement relation also authorizes a reference restore whose displaced
track ID equals the successor ID. That request performs no identity translation: it restores and
exactly reads back the authenticated account's saved favorite and playlist state for the reused
ID. Same-ID restores remain invalid for the source predecessor and for every relation without the
approved displaced-track match.

Organization status treats that source-location row as import provenance, not as universal success
evidence. A succeeded item must always match the current MediaLink track ID, relative key, policy,
and metadata watermark. When the same MediaLink has a qualifying import item in `registering`,
`ready`, or `duplicate`, status additionally requires the source location to match the selected
import source ID, managed key, and latest organization item. A legacy or externally imported
MediaLink with no qualifying import row may therefore be verified from the organization ledger
without creating a synthetic source ID or backfilling either provenance table.

## Account reference migration

After rebound, reference work reopens only the accepted token owner's account and replaces every
old song occurrence with the verified new song ID. Playlist order and duplicate occurrences are
preserved. A post-scan playlist is eligible only when its name and owner are unchanged and its
ordered members equal either the captured baseline, the baseline with all old occurrences removed,
or the exact desired new-ID list. Any other concurrent edit is `reference_conflict` and is never
overwritten.

An explicitly approved target replacement has two ledger-proven predecessor IDs: the source and
the displaced target. Reference restore treats only those two IDs as equivalent to the verified
successor. When a Gonic scan has collapsed overlapping predecessor occurrences to one successor,
that exact collapsed projection is also an eligible post-scan state; restore reconstructs every
captured occurrence in its original order. Ordinary organization jobs still admit only their one
old ID. For each account, restore an unstarred predecessor snapshot before a starred one, then
compare the combined source/displaced projection so the final favorite is their logical union.

Each playlist and the star state has a durable checkpoint written before the upstream operation.
Completed checkpoints are skipped on retry; incomplete conflict/failed checkpoints can be reclaimed
only with the same immutable baseline and desired value. A timeout after an upstream write is
resolved by exact authenticated readback rather than blind repetition. A deleted, read-only, or
otherwise changed playlist leaves the file and verified MediaLink at the managed target while the
job remains `recovery_required` for explicit forward recovery.

Final verification enumerates the target account's playlists containing the new ID and compares the
playlist ID set, metadata, full ordered occurrence lists, and star state with the captured baseline.
Only that exact result advances to `succeeded` and clears the accepted grant. Reference migration
does not call recent, scrobble, bookmark, listening-history, import, tag, or filesystem APIs.

## Metadata identity proof

Schema v25 keeps metadata reflection and organization identity replacement as independent audit
axes. Rebinding stores the item's new opaque song ID and records one durable
`replacement_pending` publication marker in the same transaction that updates the stable MediaLink
and every metadata current binding. Exact playlist/star verification uses a dedicated completion
operation; generic stage transitions cannot mark an item succeeded. That operation records
`succeeded` and one `replacement_verified` marker atomically.

Each first pending or verified marker reissues the latest existing `metadata_changes` row for the
same MediaLink with a fresh monotonic sequence. Revision, related IDs, cover generation, changed
fields, and the original reflection result are preserved. No metadata history means no synthetic
change row; a later normal snapshot derives identity status from the organization ledger.

Identity proof follows only organization edges for the same stable MediaLink. A unique chain of
succeeded `old_track_id → new_track_id` edges from the metadata item's original ID to its current
ID is verified. A succeeded prefix followed by one exact scanning/rebound/migrating/verifying edge
is pending. Missing evidence, failed/recovery-only edges, cycles, ambiguous succeeded branches, or
chains beyond 32 hops fail closed as unresolved. Organization success never rewrites the historical
metadata `reflection_result`.

## Public admission and status

The public boundary is a dedicated PAT-only candidate, preview, submit, status, and retry API.
Organization never accepts arbitrary paths: the request contains one opaque track ID, its current
revision, a succeeded same-token metadata job, `id3-managed-v1`, a stable operation ID, and bounded
HTTPS evidence descriptors. The server resolves the current MediaLink, rereads the actual MP3,
computes the destination, validates evidence against changed/present fields, then revalidates the
PAT immediately before sealing the immutable accepted-work grant.

Replay is bound to token identity plus the canonical body. The same operation/body returns the
original job; a changed body is a conflict. Status is limited to the exact submitting token and its
current library intersection, and exposes no current/target path, evidence URL, proof, file digest,
or raw row. Retry can only nudge an unleased `recovery_required` item toward its already recorded
filesystem, gonic, references, or verification owner. Successful work cannot be retried.

## Collection selection snapshot

`POST /api/v1/metadata-organization/selections` is a PAT-only, read-only boundary requiring both
`metadata:read` and `collections:read`. It reads either the current account's favorites or one
playlist whose owner exactly matches the canonical PAT username. A playlist that is missing or
owned by another account returns the same `not_found` result and does not reveal visibility.

The response freezes at most 1,000 occurrences. It keeps the first occurrence order, emits each
track once, and records every zero-based occurrence index, so `[A, B, A]` becomes `A:[0,2], B:[1]`
without losing playlist semantics. Empty collections are valid; oversized collections fail as a
whole with `selection_too_large` and are never truncated.

`selectionRevision` signs the credential context, source descriptor, ordered IDs, and occurrence
positions. The caller cannot supply it. The server revalidates the PAT after the single upstream
read, propagates client disconnect cancellation, and returns a strict DTO containing no path,
token, proof, upstream payload, or unrelated playlist data. Selection creates no metadata or
organization job and performs no filesystem, playlist, or favorite mutation.

## Whole-library unorganized snapshot

`POST /api/v1/metadata-organization/unorganized-selections` is a separate PAT-only boundary that
requires `metadata:read` and `media:organize`. Its body is exactly `{ "schemaVersion": 1 }`; account,
library, path, and filter selectors are rejected. The server uses only the principal's current
allowed-library intersection and requires every corresponding curation inventory run to be
`ready` with completed discovery. Otherwise it returns `inventory_incomplete` with only the
affected public library IDs and bounded coverage states, and creates no snapshot.

Schema v29 stores this selection in dedicated bounded parent/item tables, independent of the
legacy curation query snapshot pool. Organization policy may set `selection.snapshotMaxAgeMs`,
`selection.snapshotMaxItems`, and `selection.snapshotMaxCount`; safe defaults preserve older
private policy files. Creation walks current non-tombstoned inventory in stable library/track order,
classifies MediaLinks through the canonical organization-state projection in chunks of 100, and
stores only `needs_organization` rows. The parent retains the immutable inventory revision and all
five state counts. A capacity failure rolls back the parent and every ordinal instead of returning
a partial result.

Pages contain only MediaLink ID, current track ID, title, artist, and album. The cursor MAC binds
selection ID, next ordinal, principal scope, and inventory revision. A changed token, library or
policy scope fails with `snapshot_scope_changed`; expiry or a missing ordinal fails closed. Status
changes after capture do not rewrite the snapshot, so a sweep must revalidate each MediaLink through
the live status endpoint immediately before work. This boundary creates no jobs and touches no
filesystem or gonic endpoint.
