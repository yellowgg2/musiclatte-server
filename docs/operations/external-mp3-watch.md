# External MP3 watch operations

This feature uses the existing imports overlay. It adds no port, host mount, Docker socket, credential, or writable secret. The API keeps the `/music` bind read-only; the worker keeps the existing writable `/music` bind plus management/staging/engine storage and its fixed Gonic worker credential.

## Compatibility and activation

An existing schema v1 import policy remains valid and watch-disabled. Do not change it merely to preserve current behavior. To opt in, start from `deploy/import-policy.example.json`, keep `relativeRoot` at `jojo-music` unless the deployment intentionally uses another layout, replace only synthetic folder/user values, and set `watchExternalMp3` to `true` for the intended library.

Before editing the private policy:

1. Take the existing management/policy backup and record the current policy revision.
2. Confirm each allowed user maps to a unique account directory and that `<relativeRoot>/<account directory>` is the intended private destination.
3. Confirm the API is healthy so it can project current instance/account identities before worker observation.
4. Validate the unchanged overlay with `docker compose -f compose.yaml -f deploy/compose.imports.yaml config --quiet` and the worker `--check-config` probe.
5. Recreate the API first, wait for health, then recreate the worker. Do not expose or copy the signing key to the worker.

The first traversal is a baseline. Existing MP3 files are deliberately excluded and there is no backfill/reset command. Allow at least one complete traversal; large trees advance in bounded slices. Worker health confirms process/DB liveness, not baseline completion. Baseline completion evidence is the watched root becoming active with a completed scan in private management diagnostics; never print row paths or identity values into shared logs.

## Safe functional check

After baseline completion, use a newly named synthetic MP3 that you are authorized to store:

1. Copy it into the enabled user's account directory, not a shared/root folder.
2. Leave the file unchanged for at least 10 seconds. Watch hints normally start inventory after 250 ms. Watcher attachment is retried every 60 seconds, but that refresh does not run inventory. To test a deliberately missed event on an already active root, allow the six-hour safety reconciliation boundary; a missing or blocked root keeps its shorter durable retry.
3. Confirm recent history first shows `registering`, then `ready` only after Gonic scan and exact path registration.
4. Confirm another account cannot see the event and the public response contains no path, provenance, or username.
5. Delete the synthetic file and confirm the same history becomes `missing`; do not expect history deletion.

Registration failures retry from 30 seconds with exponential backoff up to one hour. Repeated copying or replacing at the same relative path does not create another event.

## Rollback

Set `watchExternalMp3` to `false`, recreate the API, wait for health/projection, and recreate the worker. This stops new observation and closes watchers. Preserve the management database, named volumes, existing DownloadEvents, observations, MediaLinks, and music files. Do not delete observations, reset baseline, remove volumes, or downgrade the database in place.

Before a binary rollback, stop the worker and retain a diagnostic snapshot. A persisted continuation
from an incomplete staged scan has no matching process-local fingerprint set after restart; old code
must not resume it or infer absence from it. Restore the matching pre-upgrade management/key snapshot
for the old binary into fresh recovery volumes, then let the restored worker begin a conservative
traversal from the root. Do not clear continuation or observation rows with ad-hoc SQL.

Existing external history continues through the unchanged recent contract and may be `ready` or `missing` according to current file/Gonic state. To roll back the whole release, use the normal matched backup/image procedure from the import deployment guide; production changes remain a separately authorized operation.
