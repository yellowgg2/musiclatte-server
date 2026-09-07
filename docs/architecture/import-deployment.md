# Imports deployment

Phase 3 adds an opt-in worker to the unchanged four-service base. `docker compose up -d --build` still runs volume-init/gonic/API/web with imports disabled. Use `docker compose -f compose.yaml -f deploy/compose.imports.yaml up -d --build` after private setup to add worker-volume-init and worker. No registry push, public worker port, Docker socket, or existing-service changes are involved.

The worker waits for healthy gonic/API and successful worker-volume-init. API/web/gonic do not depend on worker health. API holds only the read-only policy and music mount; gonic remains read-only. Only worker writes music, and only under validated library-relative roots. All long-running services remain non-root, drop capabilities and use no-new-privileges. API owns key provisioning; worker shares management-data but never mounts management-keys. Both processes use SQLite WAL/short synchronous transactions and the same schema v8.

## Private setup

Keep both files outside the checkout and Docker context, in a private operator directory. `IMPORT_POLICY_FILE` and `IMPORT_CREDENTIAL_FILE` in `.env` are absolute **paths**, never credential contents. Compose mounts the policy read-only and the worker credential as a read-only secret. Local Compose file secrets retain host ownership/modes; do not rely on secret `uid` remapping. Give UID 1000 read access, for example owner 1000 and mode 0600. The policy must be readable by API UID 1000 too. Never put passwords in `.env`, CLI arguments, images or logs.

Policy shape (replace synthetic IDs/usernames with the gonic folder ID and authorized users):

```json
{
  "schemaVersion": 1,
  "libraries": [
    { "id": "music", "musicFolderId": "1", "relativeRoot": "imports", "allowedUsers": ["listener"] }
  ],
  "engineManagers": ["operator"]
}
```

The credential file is a JSON object with exactly `username` and `password` string fields. Create a dedicated gonic account through the existing loopback/SSH admin setup with the scan permission needed by `startScan`, then write its credential privately. Complete initial gonic administrator password setup first; never deploy default passwords. Verify the configured account and music folder during Steps 13–14. Policy has no credential or host absolute root, only logical library mappings and usernames.

`IMPORT_UID`/`IMPORT_GID` default to 1000:1000. The current API image uses private management storage owned by 1000:1000, so keep this pair for the shared SQLite deployment. Other values intentionally fail closed against that storage and are not a supported way to bypass permissions. Prepare the host music directory for this numeric worker account with narrowly scoped owner/group/ACL access; gonic/API need read/traverse. Do not chmod music world-writable or chown the library recursively. Worker-volume-init runs as root without network **only** to set ownership/mode on empty staging and engine volumes. It rejects a nonempty owner mismatch and never mounts music or management data. Private engine/staging/management roots require owner-only mode and canonical, disjoint paths.

## Probes and lifecycle

```sh
docker compose -f compose.yaml -f deploy/compose.imports.yaml config --quiet
docker compose -f compose.yaml -f deploy/compose.imports.yaml run --rm --no-deps worker node apps/api/dist/worker-entry.js --check-config
docker compose -f compose.yaml -f deploy/compose.imports.yaml exec worker node apps/api/dist/worker-entry.js --healthcheck
```

The config probe requires initialized volumes (on first run, finish base startup and `run --rm --no-deps worker-volume-init` before probing). It validates enabled/disabled flags, policy/credential syntax, readable private files, permissions, writable/disjoint roots, seed SHA-256 and executable dependencies; it does not migrate DB, download, execute binaries or authenticate remotely. Output is `worker_config_valid`, `worker_disabled`, or redacted `worker_unavailable` with exit 1. Disabled normal run exits cleanly. Invalid CLI options fail closed.

Health opens existing SQLite read-only, validates current schema and checks an idle/working heartbeat no older than 30 seconds. It does not read credentials, run yt-dlp, access gonic or refresh the heartbeat. Unavailable/stale/future/stopped/missing DB returns exit 1 without diagnostic payload. API readiness remains independent. Health is process/DB liveness, not a guarantee that a particular external video can be downloaded.

Normal run initializes the persisted engine provider, starts durable download/registration and serial mailbox/daily-check maintenance. Daily claims are persisted/coalesced; `check_now` cannot bypass the interval. SIGINT/SIGTERM abort work, await child cleanup and close the DB. Restart uses recorded leases/intents; active/previous version files remain immutable. URLs, process args, raw child output, paths and credentials are not logged. No actual YouTube import is part of Step 09; writable live tests belong to Step 14.

## Build, updates and rollback

The source-only multi-stage worker image uses Node 24.20.0/npm 11.19.0, production API/contracts dependencies, Debian FFmpeg/ffprobe and a checksum-locked official standalone yt-dlp seed. See [exact versions](runtime.md). Linux amd64 and arm64 have separate official hashes; unsupported targets fail. Runtime nightly candidates live in `engine-data`, never replace the image seed, and activate only after validation. No host Python/FFmpeg/yt-dlp installation is needed. The official standalone executable extracts shared libraries, so only the worker tmpfs `/tmp` explicitly permits execution (`exec,mode=1777`); the container root remains read-only with dropped capabilities and no-new-privileges. Docker’s default noexec tmpfs fails with a shared-library mapping error.

Take the [matching backup](../../deploy/backup/README.md) before upgrading, then rebuild with the same two-file command. To disable new imports, stop worker using the overlay, then recreate API with base Compose; preserve volumes/music/engine. Removing the overlay does not reverse schema v8. To downgrade to v2 restore the matching pre-upgrade snapshot with its old build. Engine rollback uses the existing authorized API action, preserving running leases. Do not point an old image at new-schema storage.
