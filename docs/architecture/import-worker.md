# Durable import worker

## Account imports (2026-09-09)

New API jobs use schema v13 `account_directory` and the path/overwrite contract in
[import boundaries](import-boundaries.md). This supersedes the original no-overwrite/ready-source
short-circuit behavior below for new jobs. Null account directories retain the legacy behavior for
in-flight recovery. Completed-source reimports create fresh events; active same-account requests
still deduplicate. No existing media is moved and no devserver deployment is implied by this change.

`createWorkerRunner` in `apps/api/src/imports/worker-runner.ts` is inert until `runOnce()` or
`run(signal)` is called. It receives the management database, canonical disjoint music/staging roots,
a server-owned library mapping, clock, ffprobe executable and `acquireEngine(sourceId)` provider.
The provider returns `{ version, executable }`; the worker snapshots that pair for the attempt.
Engine acquisition and each process invocation have bounded deadlines. Step 07 owns production engine
provision/activation, Step 09 owns deployment/entry wiring, and Step 04 owns gonic registration.
No API capability, web route, gonic/bot/native tree or deployment changes here.

## Durable state and schema

Schema v4 migrates v3 rather than editing its released migration. The MediaLink table is rebuilt
without changing existing keys, revisions or gonic IDs. `gonic_song_id` can be null only when
availability is `unavailable`. Migration disables foreign-key enforcement only for the table rebuild,
checks every foreign key before commit, then enables enforcement before returning the connection.
A pending link cannot satisfy `finishRegistration`.

`import_attempts` retains attempt number, an opaque staging-directory key, pinned engine version,
start time and cleanup acknowledgement. The partial cleanup index excludes historical cleaned rows.
`import_publish_intents` records the exact final/staged keys, UUID event/media IDs, intended time,
new/duplicate disposition and pending device/inode identity. No payload bytes or raw input URL enter
SQLite. Backup verification includes the new rows and rejects unsafe recovery keys.

`createWorkerLedger` in `imports/worker-state.ts` owns synchronous, short SQLite transactions.
A claim holds a random owner token and increments the item attempt. A transaction prevents two
active download workers, even for different items. Expired work can be reclaimed; registering/ready/
duplicate items are excluded from this worker. Each transition retains observed timestamps and
metadata using the import repository. Heartbeats renew the lease and update worker health; an idle
loop reports idle. A stale owner cannot commit file publication, update the receipt, or clear another
worker's health row. Process, audio validation, copy and fsync occur outside transactions.

## Downloader boundary

`createDownloader().run` reconstructs a canonical single-video URL from the validated source ID.
The metadata invocation uses `--no-playlist --dump-single-json --skip-download`. Strict decoding
requires the exact requested ID, bounded nonempty title/channel and a safe stable channel/uploader ID.
Config, plugins and cache are disabled. Download options select `bestaudio/best`, extract MP3, embed
metadata/thumbnail, set a source-ID comment tag, and request JSON-escaped `after_move` filepath.
Output and intermediate files are confined to an opaque, attempt-owned staging directory.

Exit zero alone is insufficient: exactly one after_move record must equal the fixed expected MP3
path. The worker checks canonical root, every path component, extension, non-symlink regular file,
one link, nonzero size, opened/visible inode identity and stable file stats. ffprobe reads the already
opened descriptor via `pipe:0`, with only the pipe protocol enabled. Its bounded JSON must report an
MP3 audio stream, MP3 format and matching embedded source ID. This also verifies duplicate candidates.
Only observed stages are persisted; no percentage or ETA is fabricated. Postprocessing means the
returned artifact is undergoing final validation, not a guessed FFmpeg completion percentage.

All child processes use the Step 02 no-shell process-group runner. Abort/timeout/output overflow
terminate the owned group before rejection. Worker logger events contain fixed stages/failure codes
and optional validated opaque UUIDs; raw metadata, URL, paths, argv, stderr and thrown error messages
are never sent to it. Logger exceptions cannot alter cleanup or ledger state.

## Publication and crash matrix

Publication uses the existing cross-filesystem copy primitive: create an exclusive pending file in
the final directory, bounded copy, file fsync, persist its device/inode, check lease synchronously,
atomic no-replace link, directory fsync, pending unlink and directory fsync. Node replacing rename is
not used. The durable intent event UUID owns the exact `.import-UUID.pending` name. Recovery removes
only this pending name after checking its type/link identity, including the two-link state following
a crash immediately after final link creation.

| Crash/condition                                           | Recovery                                                                                     | New event               |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------- |
| Claim, metadata, download, postprocessing; no intent      | Clean recorded staging after reclaim; failed `worker_interrupted`, or cancelled if requested | None                    |
| Intent/pending copy/fsync; no final                       | Resume publishing the saved validated staging artifact; never reacquire/download             | One after publication   |
| Intent with missing artifact and no final                 | Clean owned staging; failed and eligible for explicit retry                                  | None                    |
| Link or directory fsync; pending name remains             | Remove only owned pending link, validate exact final audio/source and compare durable inode  | One for own publication |
| Final exists after publish but before DB receipt          | Validate exact final and durable inode; resume same intent                                   | One                     |
| External same-source final wins, including before restart | Verified duplicate; preserve final                                                           | None                    |
| Same-name wrong-source/invalid file before intent         | Fail closed; preserve existing bytes                                                         | None                    |
| Receipt committed; response lost                          | Registering excluded from download claims; clean unacknowledged staging                      | Existing event only     |
| Final file may exist but reconciliation fails             | Keep publishing/intent for recovery; preserve all final files                                | None until confirmed    |

The receipt transaction creates or finds the pending MediaLink, inserts the item's unique DownloadEvent
and transitions to registering while releasing the download lease. `registeredAt` and `gonicSongId`
remain null. A duplicate has a MediaLink but does not manufacture a DownloadEvent.
`downloadCompletedAt` is the UTC observation time at the first successful receipt transaction, stable
across replay. If a process dies between linking and recording, recovery records when it first confirms
the completed publication; it cannot recover the exact lost link syscall time. No upload date or file
mtime is substituted.

## Cancellation, retry and shutdown

Queued items cancel immediately. Active pre-publication items retain ownership until the process group
has exited and owned staging has been cleaned; only then do they become cancelled. At/after durable
publish intent, cancellation preserves the final payload and allows publication reconciliation.
SIGTERM or an AbortSignal stops the explicitly started loop and its child group. An unpublished
interrupted attempt is failed; an uncertain published attempt retains its intent/lease for recovery.
Only this loop's signal listener and this owner's health row are removed. Engine acquisition can be
aborted even if the provider remains pending.

Retries copy only failed items into a new child job. Existing successful, duplicate and registering
siblings are preserved. A mixed job with registration pending remains running until Step 04 resolves
that work; terminal mixed outcomes derive partial using the existing repository.

## Verification and limits

See `docs/verification/phase-3/step-03.md`. Tests include actual process exit before/after atomic link,
SQLite reopen, controlled lease expiry, synthetic executable failures, real temporary files, and
separate real FFmpeg/ffprobe synthetic-MP3 smoke. A process exit is not a physical power-loss test.
Local POSIX hard-link/directory-fsync support and operator-controlled roots remain required; deployment
filesystem/power-loss behavior and actual YouTube/nightly compatibility belong to later owners.

CLI references: [yt-dlp options and metadata](https://github.com/yt-dlp/yt-dlp#modifying-metadata),
[ffprobe structured output](https://ffmpeg.org/ffprobe.html#Main-options).

## Step 04 registration extension

Optional `WorkerOptions.registration` injects a fixed worker scan client and library mappings.
When no download claim remains, the worker runs one durable registration batch; restart can complete
previously published files without acquiring an engine. Schema v5 adds registration scheduling to
v4, preserving publication tables and receipts. See [gonic registration](gonic-registration.md).

## Managed-source continuity

Phase 9 adds a server-owned source-to-managed-location ledger after a verified organization
rebind. Before acquiring an engine or deriving a legacy channel path, the worker checks this
mapping for every job, including account replacement jobs. A mapped file must still pass the
existing embedded source-ID/audio validation. A valid file becomes a duplicate receipt using the
stable MediaLink and is never overwritten or downloaded again.

If the managed file is absent or no longer matches its source, the worker marks that MediaLink
unavailable and fails the item explicitly. It does not fall back to the historical path planner,
recreate a legacy copy, or replace curated ID3/APIC bytes. The mapping lookup is limited to rebound
or later organization states (including explicit recovery) and does not expose source IDs publicly.
