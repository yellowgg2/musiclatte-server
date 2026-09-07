# Recent downloads API

Phase 3 Step 06 adds `GET /api/v1/recent-downloads` over the management DownloadEvent ledger.
It does not enumerate the gonic library, invoke a scan, backfill legacy files or start playback.
The web recent consumer remains disabled until Step 11; the same wire schemas and synthetic
fixtures are available to the future P5 native consumer.

## Wire contract

`packages/contracts/src/recent.ts` owns the query/response schemas and the discriminated
`RecentDownloadItem`, `RecentDownloadFilter` and `RecentDownloadResponse` types.

| Field         | Contract                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `from`, `to`  | Both omitted or both UTC RFC3339 `Z` instants, with optional 1–3 fractional digits; calendar dates and `from < to` are validated |
| Default range | Server clock `to=now`, `from=now−7×24h`; inclusive start, exclusive end                                                          |
| `limit`       | Decimal string, default 50, maximum 100; no zero, leading zeros or coercion                                                      |
| `cursor`      | Opaque signed continuation; empty, malformed, changed or replayed tokens return 400                                              |
| Response      | `schemaVersion:1`, canonical millisecond UTC `filter`, fixed `asOf`, `items`, nullable `nextCursor`                              |
| Item          | Account-bound `eventId`, UTC `downloadCompletedAt`, optional `registeredAt`, `state`, and `song` only when ready                 |

Clients convert their local date-picker boundaries to UTC before submission. Offset-less dates,
local/offset timestamps, unknown keys, duplicate parameters, one-sided ranges and reversed/equal
ranges return the existing `invalid_request` envelope. Continuations may omit the original range
or repeat the equivalent instants; omitting it retains the original exact default range.
The response schema disallows `song` for registering/missing and requires a nondirectory song
and registration time for ready. Paths, source URLs, credentials and internal repository fields
are not projected to the wire.

## Snapshot and indexed storage

`createImportRepository.listRecent` executes `recentDownloadQuery`: one range seek per authorized
library using `download_events_recent(identity_key,library_id,download_completed_at DESC,id DESC)`.
It joins import items by their primary key, takes at most `limit+1` rows per library, merges with
SQLite-compatible binary ID ordering and keeps the global `limit+1`. MediaLink reads use exact
primary keys only for the returned page. There is no library/folder/tag crawl or management
history deletion on this path.

The HMAC uses a dedicated purpose and binds the instance/account fingerprint, sorted authorized
library IDs **and their folder/root mappings**, from/to, asOf, insertion high-water mark and final
`(downloadCompletedAt,eventId)` tuple. A library mapping change invalidates existing cursors.
Completion time is bounded by asOf as well as the requested range. The append-only ledger's
`MAX(rowid)` insertion fence also excludes later inserts with backdated or identical completion
times; a refreshed first page gets a new fence. The high-water lookup is an SQLite extremum lookup,
not a library scan. No new schema migration is required (schema v6).

Snapshot membership survives normal process restarts and new insertions. This relies on the
existing append-only event ledger: do not rebuild/renumber event rowids or use destructive ledger
maintenance while retaining old cursors; a restore/migration that changes that identity must
invalidate sessions/cursors. File and metadata availability is a current observation, not a file
lease: a later playback request can still encounter a subsequent external deletion.

## Current availability and authentication

Cookie and bearer reads both require the current session and current upstream identity. Responses
are verified again before return, so a logout/policy revision during network I/O discards the page.
The durable identity HMAC is identical to the imports producer's instance/username key.

- Unregistered events retain event/time with `state=registering` and no song.
- Registered candidates need an exact same-library MediaLink within the policy's relative root.
- The read-only resolver checks every path component, rejects symlinks/escapes/nonregular files,
  and checks the file again after upstream verification. It never creates directories or opens
  files for writing.
- `SubsonicClient.recentSong` calls **getSong(id)** with the current session proof. Its private
  decoder returns current public song metadata plus server-only path evidence. The public
  `getSong`/MusicEntry contract remains unchanged.
- Missing files, gonic code 70, a different song ID or a path that does not normalize to the exact
  MediaLink key yield `missing` without deleting history. Unsafe `..`/absolute/backslash paths
  cannot normalize into an accepted match.
- At most one getSong per candidate, four in flight, and one page-wide timeout (the configured
  Subsonic timeout). Error/disconnect aborts sibling work and pending work is awaited before return.
- HTTP 401/Subsonic 40 revoke the session and return 401; HTTP 403/Subsonic 50 return 403;
  timeout/network/503 return safe retryable 503. Failure does not mutate any player or queue state.

## Runtime and capability

`createConfiguredApp` supplies the ledger, policy and clock through imports options and passes
`recent.musicRoot` when imports are enabled. `IMPORT_MUSIC_ROOT` is an absolute server-owned path,
defaulting to `/music`; Step 09 owns its read-only API mount and the separate worker write mount.
Missing file/root observations return missing for stored candidates. An injected enabled service
with no resolver configuration fails registered candidates with `storage_unavailable`.

`library.recentDownloads` is supported when the imports policy is enabled, allowed only for users
with an authorized library, and available independently of worker heartbeat or engine health.
Unconfigured/disabled policies produce false/denied; enabled but unauthorized users get true/denied.
The endpoint always enforces permission even if a caller ignores capability discovery.

Fixtures: `packages/test-support/src/recent-fixtures.ts` exports empty/registering/ready/missing,
cursor/date responses and a standard error envelope. Synthetic cursors are decoder examples, not
valid authentication artifacts. Validation evidence is in `docs/verification/phase-3/step-06.md`.
