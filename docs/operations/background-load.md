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
