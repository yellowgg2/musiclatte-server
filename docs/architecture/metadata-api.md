# Metadata API

Phase 4 S06 provides private `/api/v1` endpoints through the existing verified session.
The API reads music and enqueues work; only the metadata worker publishes final music files.
The existing `/rest`, audio Range/If-Range, and query-free cover GET/HEAD/304 routes retain their
behavior. Metadata and imports can be configured independently.

| Method and path                                 | Result                                                            |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| GET `/tracks/:id/metadata`                      | Actual tags, file revision, editable state, supported fields      |
| GET `/tracks/:id/metadata/cover/:frameId`       | Account/track/current-revision-bound APIC bytes                   |
| POST `/metadata-previews`                       | Validated target/field effects; no write guarantee                |
| POST `/metadata-covers`                         | Validated private upload token                                    |
| GET `/metadata-covers/:id`                      | Owner's validated uploaded image                                  |
| POST `/metadata-jobs`                           | 202 durable job or identical operation replay                     |
| GET `/metadata-jobs[?cursor=&limit=]`           | Account history, stable descending createdAt/id order             |
| GET `/metadata-jobs/:id`                        | Per-file progress, saved/reflected receipts and permitted actions |
| POST `/metadata-jobs/:id/retries`               | New child for failed/conflicted unsaved items only                |
| POST `/metadata-jobs/:id/rechecks`              | Durable, idempotent reflection scheduling; no file rewrite        |
| POST `/metadata-jobs/:id/restores`              | New scoped restore job with a fresh expected revision             |
| GET `/metadata-changes[?cursor=&limit=]`        | Managed-file snapshot followed by incremental changes             |
| GET/HEAD `/media/cover/:id/revisions/:revision` | Authorized managed cover generation; private,no-store             |

Request and response schemas/decoders live in `packages/contracts/src/metadata.ts`. One route
registration module shares the authentication boundary rather than duplicating it across job,
cover and change routers. All request bodies, params and queries are closed: unknown properties,
duplicate targets and malformed intent are rejected. Opaque upstream IDs allow 2048 characters;
managed IDs and frame handles use a separate bounded representation.

## Authorization and replay

Reads require current gonic access and exactly one configured library, including non-editors.
Writes additionally require that library's editors, exclusive ownership-preserving profile,
supported MP3 format/fields, fresh revision and worker availability. Restore requires a current
gonic administrator listed in restoreManagers. An owner can still read accepted history and
replay accepted operations while the worker or music mount is unavailable. Cross-account job,
backup and upload handles return 404; read-only permissions do not expose recovery actions that
the actor cannot execute. Worker prepublish authorization remains mandatory.

JSON POSTs, including preview, require a cookie session, configured Origin, web client marker
and CSRF token. Raw uploads share the identical Origin/CSRF guard. Session bearer GET support
remains the existing session protocol; mutating bearer requests are rejected. This is not PAT
or automation-token support.

Operation IDs reuse P2's `[A-Za-z0-9_-]{22,128}` rule. Canonical object keys, ordered target arrays,
operation kind and parent job bind the request digest. Identical replay is resolved before
write availability/revision checks; a changed valid body conflicts with 409. Retry/restore are
new lineage jobs. Recheck has an additive v11 durable mailbox and does not steal an active
reflector's lease. Job and recheck operation keys share the same principal namespace.

Before enqueue, the API resolves current account paths and validates the actual ID3 patch in
memory. Preview performs no candidate, backup or job creation and does not process a cover into
a music file. Invalid track fractions, invalid date preservation, ambiguous APIC selectors and
USLT byte limits fail before enqueue. Each job stays within one library. The configured limit
is bounded by 100; the validated default is 64. Submission is not a promise that later disk I/O
will succeed; those failures remain per-file worker receipts.

Legacy cover `set` and `clear` keep their exact selector behavior. The explicit `replaceAll` variant requires a validated JPEG upload and the explicit `clearAll` variant requires no upload. Their preview adds a per-target APIC removal count and either the verified JPEG digest or `null`; no image bytes or paths enter the response. Worker authorization retains the operation kind so the organization scope gate can be added without redefining the patch.

## Images and changes

Raw upload headers are `Content-Type: image/png|image/jpeg`, `X-Operation-Id`, and
`X-Metadata-Library-Id`, plus the normal cookie/Origin/web/CSRF headers. Only this parser accepts
up to 8 MiB; ordinary API JSON limits remain 16 KiB. Metadata preview/create/retry JSON endpoints
have their own 1 MiB limit for bounded lyrics/target arrays. FFprobe dimensions and FFmpeg decode
limit uploads to 16 million pixels. MIME must match actual bytes. A private canonical 0700
directory outside music stores O_EXCL/NOFOLLOW 0600 files. The helper checks the upload's recorded
digest again before using it; changing a valid image after upload does not change accepted intent.

At most four uploads decode concurrently per API process. A principal may retain at most 32
unreferenced uploads / 64 MiB. Unreferenced uploads expire after 24 hours; referenced uploads
remain while their job references exist. Cleanup on fresh uploads removes only expired
unreferenced entries and old owned orphan upload files. A background scheduler may call the same
cleanup function. Backup retention is independent. Images use whitelisted MIME, nosniff and
private,no-store; no binary payload or file path is returned in JSON.

Changes query only the management ledger, never the full upstream library. Initial pagination
selects the latest event per managed file at an asOf sequence; each returned item rechecks the
current account's exact upstream file binding. Skipped/inaccessible rows still advance the
bounded cursor. A cursor signs principal, instance, session policy, metadata policy, permitted
libraries and snapshot/delta position. `hasMore` indicates immediate pagination; `nextCursor`
always permits polling, including empty results. A transition from mismatch to verified advances
the event sequence, so another allowed client receives the reflected receipt without owning the
writer's job. Public changes contain only IDs, revisions, changed field names and save/reflection
state. They contain no usernames, tag values, relative file keys or backup identifiers.

A versioned cover URL requires a recorded generation associated with that cover ID and current
account access to its managed file. It forwards neither the generation nor old browser cache
validators/Range to gonic and begins with private,no-store. It cannot invalidate gonic's own
warmed ID+size cache. S05 verified that gonic v0.22.0 can retain the old cover after scan; the
file remains saved with reflection_mismatch and recheck/restore until actual reflection is
verified. An unused diagnostic size is not a product cache workaround.

## Runtime and capabilities

`METADATA_ENABLED` defaults false. Enabled API configuration uses `METADATA_POLICY_PATH`,
`METADATA_MUSIC_ROOT`, `METADATA_PYTHON`, `METADATA_HELPER_PATH`, `METADATA_FFMPEG`,
`METADATA_FFPROBE`, `METADATA_UPLOAD_ROOT`, and the verified profile
`METADATA_WRITE_PROFILE=posix-exclusive-mp3-id3v23-v24-v1`. The helper directory contains both
file_access.py and metadata.py. API configuration contains no scan credentials or backup path.
S07 owns installing these tools, worker startup/probe/heartbeat, and read-only API music mounts.

Metadata producers advertise only MP3 and the implemented field list. A validated profile and
idle/working heartbeat with age in `[0,30000)` are both required for available writes; version
output alone is insufficient. Permission is intersected with current gonic folders. A failed
scope probe advertises unknown permission/unavailability. Disabled is unsupported; nonallowed
is denied. Optional formats/fields/bulkFields descriptors retain the existing future-key decoder
behavior, while malformed known descriptors are rejected. Bulk descriptors remain empty until
S10 owns its consumer subset. Web metadata consumers remain disabled until S09; curation and
automation tokens remain disabled until P6. No UI or locale changes are part of S06.
