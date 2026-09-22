# Background load diagnostics

Use the local read-only status tool to compare aggregate worker and inventory load without copying
media, credentials, account names, library IDs, or paths into an artifact.

```sh
npm run verify:background-load-status -- /explicit/path/to/management.sqlite > before.json
# Wait through the observation window without changing policy or restarting services.
npm run verify:background-load-status -- /explicit/path/to/management.sqlite > after.json
```

The database path is mandatory and is never printed. The tool opens the existing database read-only
with a 100 ms timeout, validates the exact schema, performs aggregate `SELECT` queries, and closes
without migration, checkpoint, vacuum, repair, or a write transaction. Missing files, foreign
schemas, and read failures produce only a closed JSON error code and a nonzero exit.

## Reading two snapshots

- Compare `storageBytes.database` and `storageBytes.wal` with container CPU and block-I/O over the
  same interval. A growing WAL alone is not proof of a fault; correlate it with state-count movement.
- `workers.*.states` and `heartbeatAgeBuckets` distinguish stopped, active, and stale workers without
  exposing worker IDs. `over_1h` while a worker is expected to run warrants service-log inspection.
- `external.roots` and `external.observations` show aggregate state movement. Stable counts plus high
  write I/O suggest unnecessary persistence; increasing settling/registering counts indicate real
  admission work.
- `curation.runs` and `curation.queue` separate current generation work. Only
  `curation.failures.unresolved` is a current warning. `resolved` and `resolvedErrorCodes` retain
  closed history and must not be counted as active retries.
- Count gateway JSON error codes after redacting request details. Compare `storage_unavailable` with
  `upstream_unavailable`; do not infer codes from response byte lengths.

Never store usernames, account directories, library IDs, relative or absolute media paths, track
IDs, session/cookie/token values, encrypted proofs, metadata payloads, response bodies, or private
configuration beside these snapshots. Do not use production credentials to add HTTP sampling to
this tool. Deployment changes, private policy changes, and authenticated acceptance remain separate
authorized operations.

## Phase 19 production handoff

This is a runbook for a separately approved production change; completing the documentation does
not authorize a deployment. Use the production overlay order exactly as follows on every Compose
command: `compose.yaml`, `deploy/compose.imports.yaml`, `deploy/compose.listening.yaml`,
`deploy/compose.metadata.yaml`, `deploy/compose.automation.yaml`,
`deploy/compose.production-lan.yaml`, `deploy/compose.lan-admin.yaml`. Preserve all existing feature
flags, `SESSION_MAX_AGE_SECONDS=2592000`, the current LAN bindings, and the six-hour Gonic scheduled
scan. The external-watch six-hour safety reconciliation and the 30-day curation sweep are separate
clocks and do not replace that Gonic setting.
Preserve the six-hour Gonic scheduled scan.

### 1. Preflight and private backup

Record the current source commit and container image IDs in the owner-only deployment record. Check
occupied ports, five service health states (`web`, `api`, `gonic`, `worker`, `metadata-worker`), and
container CPU/block-I/O. Capture a first aggregate snapshot with this document's read-only tool. Run
SQLite `quick_check` through a read-only connection and require `ok`; do not copy a live SQLite main
file or invoke a WAL checkpoint. Count redacted gateway JSON error codes, especially
`storage_unavailable` and `upstream_unavailable`, without retaining request details or response
bodies.

Before any container or private-policy change, stop all three management-database code owners
(`api`, `worker`, and `metadata-worker`) together. Create a new mode-0700 directory below
`/mnt/user/appdata/musiclatte-server-private/backups/` and follow
[`deploy/backup/README.md`](../../deploy/backup/README.md) to snapshot the named management/key,
gonic, engine, metadata, and other configured volumes at one boundary. Never delete or recreate the
existing volumes wholesale. Copy the current private automation/import policy and their mode/owner
metadata into that directory without printing, diffing, or archiving their contents into Git or
logs. Record hashes privately so the matching code/config set can be selected for recovery.

### 2. Source and version-aligned recreate

The source contract remains: push local `main`, then in the production checkout run
`git pull --ff-only origin main`. Confirm the resulting commit before building. Because schema 32 is
shared by API, import worker, and metadata worker, do not start any one of them on the new code while
another still runs the old code. With the backup complete, build and recreate the three code owners
as one maintenance boundary using the full overlay list, then recreate/start `web` and `gonic`
without replacing their data volumes. Wait for all five health checks before exposing normal
traffic. A failed migration is recovered from the matched snapshot; it is not repaired by running an
old image against the new database.

### 3. Private policy transition

Code may start with the existing seven-key policy: omission of `batchCooldownMs` is compatible and
normalizes to a 60-second cooldown. This allows the code and private configuration to change in two
verified operations rather than requiring an unsafe simultaneous file replacement. After the new
code is healthy, prepare an owner-only replacement, validate it with the new image's config check,
publish it atomically, and recreate the consumers without displaying its contents.

The new inventory object must use these values:

```json
{
  "batchSize": 2,
  "itemTimeoutMs": 20000,
  "batchTimeMs": 30000,
  "batchCooldownMs": 60000,
  "retryIntervalMs": 600000,
  "maxRetryAttempts": 2,
  "sweepIntervalMs": 2592000000,
  "maxQueueItems": 10000
}
```

Do not change account mappings, credentials, feature flags, the session lifetime, or either six-hour
clock as part of this edit.

### 4. Post-deploy observation

Capture another read-only aggregate snapshot after startup and again after an unchanged observation
window. Require schema/integrity success and all five healthy services. Verify only redacted status
code aggregates for session, capabilities, favorites, cover, and stream requests; authenticated
sampling belongs to the separately approved acceptance run and must not persist cookies, tokens, or
bodies. Confirm:

- external roots return to `active`; an initial mapping refresh may trigger one bounded scan;
- unchanged observation counts do not produce a continuing write storm;
- curation batches have at least 60 seconds between starts and full sweep remains 30 days;
- current warnings use unresolved failures only, while resolved history remains separately counted;
- gateway error-code counts, CPU, block-I/O, database bytes, and WAL bytes are stable or explainable.

Do not declare success from a single health response. Retain the pre-change stack snapshot and old
private policies until the observation window and separate acceptance are complete.

### 5. Rollback

First stop `worker`, `metadata-worker`, and `api`, or disable external watch in an owner-only policy
while the worker remains stopped. Take a private snapshot of the failed state for diagnosis. A new
process keeps staged traversal data only in memory; if the aggregate shows an `incomplete staged
scan` (`baselining`/`blocked` roots or a persisted continuation without completion), never let old
code resume that state or use it as absence proof.

For binary/schema rollback, restore the matched pre-deploy database, key, policies, images, and
other named-volume snapshots into fresh recovery volumes as described by the backup guide. That
restored old-code database is the verified initialization of any incomplete root continuation; do
not hand-edit queue/observation rows or point the old binary at schema 32. Start gonic and API,
verify the restored boundary, then start import and metadata workers and allow a fresh conservative
root traversal. If only the new policy is rolled back while code remains current, restore the
matching seven-key policy atomically and recreate its consumers; its default cooldown remains 60
seconds.

Never use `down -v`, delete/recreate whole production volumes, mutate the read-only Musiclatte music
copy, or alter the original Airsonic library. A production rollback and acceptance remain separately
authorized operations.
