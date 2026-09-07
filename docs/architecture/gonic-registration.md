# gonic registration

Phase 3 Step 04 maps already published relative file keys to opaque gonic song IDs. No gonic
source, database, existing bot/native tree, media payload or standard `/rest` gateway is modified.

## Upstream evidence

The pinned gonic v0.22.0 sources are:

- [Scan and getSong handlers](https://github.com/sentriz/gonic/blob/v0.22.0/server/ctrlsubsonic/handlers_common.go):
  `ServeStartScan` checks admin, launches `ScanAndClean` asynchronously, and returns scan status.
  `ServeGetScanStatus` itself has no admin check and returns boolean `scanning` and integer `count`.
  `getSong` projects the authenticated account's song data.
- [Folder handlers](https://github.com/sentriz/gonic/blob/v0.22.0/server/ctrlsubsonic/handlers_by_folder.go):
  `getIndexes(musicFolderId)` selects that music root's immediate folders; `getMusicDirectory(id)`
  returns immediate folder and track children.
- [Folder constructors](https://github.com/sentriz/gonic/blob/v0.22.0/server/ctrlsubsonic/spec/construct_by_folder.go):
  index `artist.name` and directory child `title` represent folder `RightPath` segments, while leaf
  `TrackChild.path` joins the parent relative path and filename. A track's title can come from tags.

The implementation preserves the **full scan** limitation. Narrow traversal is a lookup strategy,
not a scoped scan. An idle status immediately after start is possible because launch is asynchronous;
zero visible matches are retried within the same bounded cycle without another start request.

## Runtime and privacy boundary

`createRegistrationService({database, scanClient, libraries, clock, ...})` is inert on construction.
`scanClient` is injected by the worker runtime with its fixed administrative token proof; the service
has no session repository, user credential, client-role or password conversion dependency.
`WorkerOptions.registration` accepts that same explicit configuration. The serial worker processes
its download queue first, then runs one registration cycle when no download claim is available.
Continuous download arrivals can therefore delay registration; durable rows remain pending.
Production process/configuration activation remains Step 09.

`registerPending(signal?)` claims a due job's published items from the DB and returns
`[{itemId, status: 'ready' | 'registration_pending'}]`. Dependencies are injected at construction,
and the caller does not supply unverified item/path records. `runOnce(signal?)` wraps this operation
with the worker's boolean did-work contract. Only `registering` items are eligible; failed downloads,
duplicates and ready items are never redownloaded or re-finalized by this service.

`SubsonicClient.getScanStatus()` returns public `ScanStatus`. `getSong(id)` returns existing
`MusicEntry` using that client's current-account proof. The existing contracts index re-exports
these types automatically. The server-only `registrationDirectory` decoder retains leaf `path`,
while directory folder names are decoded separately from track metadata. Public directory/song
projections continue to omit path and uncontrolled upstream fields. No web endpoint or capability
is enabled here. BFF `c=musiclatte-web`, native `c=musiclatte` and existing browse contracts stay intact.

## Durable cycle and exact lookup

Schema **v5** adds `registration_attempts` and `registration_cycle` to v4. Prior migrations and
existing item failure invariants are preserved. Registration failures live in their own table,
because `import_items.failure_code` belongs exclusively to terminal failed downloads.

1. A synchronous transaction selects one due job, records attempts and acquires the singleton cycle
   lease. The durable retry deadline is written before any network request, including a cooldown
   for a crash or uncertain start response. A second process cannot overlap this local cycle.
2. Read scan status. Join a running scan; otherwise call start once. Poll status within the deadline.
3. For each configured music folder, find the exact first relative-root segment in its indexes.
   Follow only matching directory segments. Zero or multiple folder matches fail closed.
4. Normalize POSIX leaf paths, reject absolute/traversal/backslash/control/drive syntax, and compare
   against the validated DB file key exactly. No case folding, Unicode folding, URL decoding, title,
   artist, album, creation-time or mtime fallback is used. `./` and repeated separators normalize;
   `..` is rejected rather than resolved.
5. Exactly one match commits MediaLink song ID, available state, incremented revision/validatedAt,
   DownloadEvent registeredAt and item ready/time in one transaction. Ownership and current
   item/media/library/file-key association are rechecked at commit. Event/unique-ID conflicts roll
   back the entire item transaction. Successful siblings remain independently ready.

Indexes and directories are cached across all items in one visibility round. Pending entries cause
another round with fresh responses; no unrelated branch or full-library song enumeration occurs.
Failure to decode a leaf path in a directory conservatively leaves affected items pending.

Default bounds are 120 seconds per cycle, 1 second status/visibility polling, and 30 seconds initial
retry delay. Per-item exponential backoff caps at one hour; a global cooldown also prevents another
job immediately retriggering scan after failure. The lease expires one second beyond the cycle
budget. Timeout/abort/HTTP error/admin denial/missing or ambiguous evidence never creates ready.
A restarted worker waits for persisted deadlines, joins a still-running upstream scan and resumes
exact lookup. Late stale-owner replies cannot commit or release a newer owner's lease.
Timers/listeners are cleaned in finally; service code performs no file/process I/O or logging.

These timing defaults are bounded synthetic-fixture policy, not a measured live-library SLA. Public
status has no scan generation/completion receipt and upstream cannot report every asynchronous scan
error to the caller. Concurrent external scan starters are outside the local singleton lock; exact
path validation remains the readiness evidence. Live tuning and end-to-end server checks belong to
Steps 13–14. Mapping validity is point-in-time; recent consumers must use their own account's getSong
and handle later missing/unavailable content in Step 06.

## Verification

`apps/api/test/gonic-registration.test.ts` uses real loopback HTTP, source-shaped synthetic scan/tree
responses and real temporary SQLite ledgers. It covers batching, delayed visibility, error/backoff,
reopen, stale ownership, rollback, backup/restore, private-path projection and proof separation.
`import-worker.test.ts` also verifies runtime registration after a real synthetic publication without
another engine acquisition or file/event. Detailed commands and counts are in
`docs/verification/phase-3/step-04.md`.
