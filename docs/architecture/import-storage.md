# Import storage

Phase 3 raises the management SQLite database from schema v2 to v3. The database remains a
management ledger: audio payloads, raw URLs, credentials, executable bytes, and host absolute
paths are not stored.

## Schema ownership

- `import_jobs` owns opaque job identity, HMAC identity/operation/request fingerprints, library
  scope, retry ancestry, creation time, and cancellation intent. Job status is derived from item
  stages and is not persisted as a mutable summary.
- `import_items` owns stable input order, canonical source ID, observed title/channel fields,
  stage, failure, attempt, lease, engine version, media link, and stage timestamps.
- `media_links` maps one validated POSIX relative file key to one gonic song ID within a library.
  Repository and SQL constraints reject absolute, drive-prefixed, backslash, empty-segment, and
  traversal keys.
- `download_events` records one final-file publication per import item. Registration time is
  written only when the exact library-scoped media link completes the item.
- `engine_state` and `worker_state` are singleton rows. They store version/check/health state,
  never executable or credential payloads.

Migration `003-imports.sql` is applied under the existing `BEGIN IMMEDIATE` startup migration.
Both v1 and v2 databases advance through every sequential migration, while foreign and future
application schemas still fail closed. Existing instance, session, and playlist-operation rows are
not rewritten.

## Repository transaction boundary

`createImportRepository`, `createMediaLinkRepository`, `createEngineRepository`, and
`createWorkerStateRepository` are synchronous. SQLite transactions contain only claim, query,
and transition work; callers perform network, process, and filesystem I/O outside them. The shared
`ManagementDatabase.transaction` guard rejects async callbacks and thenables.

Import creation uses `(identity_key, operation_id_hash)` as its replay key. The same request hash
returns the original job; another request hash reports conflict. A retry copies only explicitly
selected failed items into a child job and does not update the source job, successful items, media
links, or download events.

## Item transitions

| Current                                     | Operation            | Next                             | Required state                                         |
| ------------------------------------------- | -------------------- | -------------------------------- | ------------------------------------------------------ |
| queued or expired nonterminal               | `claimNext`          | resolving or same recovery stage | new owner, future lease, fixed engine version          |
| resolving                                   | `advanceItem`        | downloading                      | observed title/channel/channel ID                      |
| downloading                                 | `advanceItem`        | postprocessing                   | current unexpired lease owner                          |
| postprocessing                              | `advanceItem`        | publishing                       | current unexpired lease owner                          |
| publishing                                  | `recordPublished`    | registering                      | unique event inserted atomically                       |
| registering                                 | `finishRegistration` | ready                            | same-library media link and event registration         |
| resolving/downloading/postprocessing        | `failItem`           | failed                           | nonempty failure code                                  |
| resolving                                   | `markDuplicate`      | duplicate                        | existing same-library media link                       |
| queued/resolving/downloading/postprocessing | `requestCancel`      | cancelled                        | lease cleared                                          |
| publishing/registering                      | `requestCancel`      | unchanged                        | published file is preserved and registration continues |

At the exact expiry instant a lease is expired for both renewal and reclaim. Terminal
`ready`, `failed`, `cancelled`, and `duplicate` rows are never claimable.

## Bounded query indexes

- `download_events_recent(identity_key, library_id, download_completed_at DESC, id DESC)`
- `import_items_runnable(stage, lease_expires_at, id)`
- `import_items_source_duplicate(source_id, stage, id)`

Focused tests use `EXPLAIN QUERY PLAN` and require each query to name its intended index.

## Backup and restore

Online backup still couples the SQLite snapshot with its immutable credential key and restores
only to a new offline directory. Snapshot verification now decodes all v3 rows and checks
job/item/event/media library and identity relationships, retry ancestry scope, singleton state,
`quick_check`, and foreign keys. A structurally valid row whose event scope differs from its job
is rejected before restore publication.
