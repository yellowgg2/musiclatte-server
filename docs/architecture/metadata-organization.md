# Metadata organization

Metadata organization is an opt-in, account-scoped operation. Step 02 introduces only the
mutation-free `id3-managed-v1` path planner; file movement, durable jobs, gonic rebinding, and
reference migration are separate later boundaries.

## Operator configuration

`AUTOMATION_POLICY_PATH` may include an `organization` section with an explicit mapping from a
gonic username to one single-segment account directory. There is deliberately no fallback from
username to directory name. Absolute paths, slash or backslash separators, dot segments, control
characters, trailing dot/space, duplicate usernames, and Unicode/case-equivalent directory aliases
are rejected. Start from `deploy/automation-config.example.json` and keep the deployed copy private.

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
snapshot—not arbitrary destination segments. The planner requires the source below the mapped
`relativeRoot/accountDirectory`, validates the source as a real regular file beneath the canonical
music root, and inspects the destination without creating directories or moving bytes.

The result distinguishes `ready`, an exact already-managed `no_op`, and typed errors for missing
metadata, account/library violations, unsafe source or target components, Unicode/case-equivalent
collisions, existing destinations, and excessive input. Missing target parents are valid preview
state; symlink parents and collisions are not.

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
Before rename it revalidates the accepted account grant and current gonic user/library access,
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
