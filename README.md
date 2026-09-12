# Musiclatte Server

[한국어](README.ko.md)

Source-only self-hosted gonic gateway and management API. S04 installs the stack; the React root is still empty, with product UI/Gallery awaiting later steps. Existing Musiclatte uses the same origin-root `/rest`; the management API is optional.

## Install a separate stack

Prerequisites: Docker Engine and Docker Compose v2, an existing readable music directory, and a chosen positive session lifetime. No host Node installation is needed for containers.

```sh
git clone https://github.com/yellowgg2/musiclatte-server.git
cd musiclatte-server
cp .env.example .env
# Set MUSIC_PATH, PUBLIC_ORIGIN, SESSION_MAX_AGE_SECONDS and a unique project name.
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

The gateway binds to `127.0.0.1:8080`, gonic administration to `127.0.0.1:4748`; API has no host port. A network-disabled one-shot helper assigns ownership only on empty gonic volumes; existing nonempty volumes with mismatched owners fail instead of being recursively changed. Six named volumes are scoped by `COMPOSE_PROJECT_NAME`; Docker owns their storage location (`docker volume inspect`). Keep that name stable and never reuse existing demo volumes. Music is read-only; match gonic UID/GID to read permissions without making the entire library world-writable. The API creates a private key only on empty first-run management storage and refuses a missing key beside existing data.

Before exposing **any** gateway through a reverse proxy or LAN, open the loopback gonic administration page and change the upstream initial administrator password. Retrieve initial-account instructions from upstream gonic documentation, not shared logs. For a remote host use an SSH tunnel, e.g. `ssh -L 4748:127.0.0.1:4748 <your-host>`, then open `http://127.0.0.1:4748`. Create a separate non-administrator listening account there. Never publish the admin port through a production reverse proxy or public interface. First-run account setup is required even though container installation is one command.

Production uses an operator-managed **HTTPS** reverse proxy forwarding the public origin to the loopback gateway. Configure its logs to omit credentials, request queries and private music metadata; do not proxy the administration port. `PUBLIC_ORIGIN` must match the exact HTTPS origin. This repository does not alter TLS, DNS or production services. Secure cookies are mandatory in production.

When the reverse proxy runs in a separate container and cannot reach host loopback, finish the loopback administrator bootstrap first, then set `LAN_BIND_ADDRESS`, `PRODUCTION_LAN_PORT`, and `ADMIN_SETUP_COMPLETE=true` and add `deploy/compose.production-lan.yaml`. The overlay preserves production mode and the HTTPS public origin while publishing the gateway on exactly one RFC 1918 host address. It does not publish gonic administration.

```sh
docker compose -f compose.yaml -f deploy/compose.production-lan.yaml config --quiet
docker compose -f compose.yaml -f deploy/compose.production-lan.yaml up -d --build
```

For isolated local HTTP testing only, use `docker compose -f compose.yaml -f deploy/compose.test.yaml up -d --build`; this explicitly uses development cookies and opts into the blank SPA. For a private LAN development exception, finish the loopback password change first, set the documented LAN variables and `ADMIN_SETUP_COMPLETE=true`, then use `docker compose -f compose.yaml -f deploy/compose.lan-development.yaml up -d --build`. The flag records operator confirmation; it does not change or verify a password. Never use this HTTP exception for production. Preserve existing Musiclatte profiles and add a separate opt-in profile using the gateway origin, without `/api` or an admin port.

If infrequent gonic account administration is needed from a trusted internal LAN, set `GONIC_LAN_ADMIN_PORT` and add `deploy/compose.lan-admin.yaml` to the startup command. It preserves the loopback administration port and adds a second port on the single `LAN_BIND_ADDRESS`; neither the base stack nor the LAN web overlay opens it. A network-disabled preflight must verify an RFC 1918 IPv4 address and exact `ADMIN_SETUP_COMPLETE=true` before gonic starts. Set that attestation only after changing the password, and restrict the port to the same private network at the firewall.

```sh
docker compose -f compose.yaml -f deploy/compose.lan-development.yaml -f deploy/compose.lan-admin.yaml config --quiet
docker compose -f compose.yaml -f deploy/compose.lan-development.yaml -f deploy/compose.lan-admin.yaml up -d --build
```

`/rest/*` preserves native responses and range streaming. `/api/*` and discovery return API responses, including errors, without SPA HTML. `/health/live` checks the gateway; `/health/ready` checks management storage and gonic connectivity without authenticating or scanning. Upstream outages can make readiness fail while standard routing and discovery remain independent. Container restarts and DNS re-resolution support recovery. S04 UI remains disabled unless `WEB_UI_ENABLED=true` is deliberately set for testing; production dev paths are excluded.

## Stop, upgrade and restore

`docker compose stop` stops only this project without removing volumes. Use `docker compose start` to resume it. Before upgrading, create a consistent stopped snapshot as described in [backup and restore](deploy/backup/README.md), then review source changes and run `docker compose up -d --build`. Keep the pinned gonic digest; changing it requires compatibility and migration checks. Restore an older image with its matching DB snapshot, never just downgrade the image. Do not run `down -v` as routine cleanup.

Gateway logs contain only status, byte count and duration; raw nginx error logs and gonic logs are disabled because they can include request credentials or private library metadata. API logs omit requests. Use health state and sanitized verification evidence for diagnosis. Before source publication, review tracked files and full history for secrets/media/private fixtures; run the deployment contracts below. No image registry push is part of installation. License choice remains pending.

## Develop and verify

Use Node **24.20.0** and npm **11.19.0** in a project-specific version manager or shell. `.nvmrc` and `.node-version` pin Node; no global runtime replacement is required.

```sh
npm ci
npm run typecheck
npm run test:unit -- tests/unit/workspace.test.ts apps/api/test/runtime.test.ts
npm run test:contract -- tests/contract/deployment.test.ts tests/contract/gateway-parity.test.ts
npm run build
```

Before starting the API, provision a private key once and export the required `PUBLIC_ORIGIN`, `GONIC_UPSTREAM`, `MANAGEMENT_DIRECTORY`, `CREDENTIAL_KEY_PATH`, and positive `SESSION_MAX_AGE_SECONDS` values. Follow the [authentication setup and API contract](docs/architecture/auth-api.md); `.env` is not loaded automatically, production requires HTTPS, and scan defaults to denied. Then run each development command in its own terminal:

```sh
npm run dev:web
npm run dev:api
```

Web defaults to `http://127.0.0.1:5173/` and deliberately renders an empty React root until Gallery approval. API defaults to `http://127.0.0.1:3000/health/live`, returning `{"status":"ok"}`. This is process liveness, not upstream readiness. Unknown paths return 404.

`npm run dev:web -- --port 5174` forwards Vite arguments. Set `PORT=3001 npm run dev:api` to use a different API port. After building, `npm run start -w @musiclatte/api` runs the compiled API.

See [runtime decisions](docs/architecture/runtime.md) for configuration, versions and official support references, and [S00 verification](docs/verification/phase-1/step-00.md) for foundation evidence, plus [S03 verification](docs/verification/phase-1/step-03.md) for authentication and compatibility results. Shared package declarations are prepared by `typecheck` before checking consumers. Build output and local agent configuration are ignored by Git and Docker.

No credentials, real music, private fixtures or runtime data belong in this repository. `.env.example` files contain safe defaults and placeholders that require operator configuration. A license has **not been selected**; no LICENSE or open-source license grant is declared. `UNLICENSED` is the npm package metadata value, and all workspaces are private to prevent package publication. Container installation and gateway verification are owned by Step 04.

## Formatting

Prettier 3.9.6 is pinned locally: `npm run format` writes readable formatting and `npm run format:check` verifies it. The shared settings use two spaces, a 100-column target and single quotes. Generated output, lockfiles, runtime data and unsupported shell/SQL/nginx files are excluded.

VS Code workspace settings enable format-on-save when the recommended Prettier extension is installed. Codex filesystem writes do not go through editor save hooks, so project `AGENTS.md` requires formatting before validation and a successful format check before completion. No formatter MCP or global Codex change is required.

## Optional YouTube imports

The base command remains `docker compose up -d --build`; imports are disabled by default. After initial gonic admin setup, create a dedicated scan-capable worker account. Start from the secret-free [`deploy/import-policy.example.json`](deploy/import-policy.example.json), which defaults `relativeRoot` to `jojo-music`, replace its placeholders and keep the resulting policy with the JSON credential outside the repository. `.env` contains only their absolute file paths (`IMPORT_CREDENTIAL_FILE`, `IMPORT_POLICY_FILE`). Follow the [private setup and policy format](docs/architecture/import-deployment.md). Use UID/GID 1000:1000 to share the API's private SQLite volume, and grant that worker narrowly scoped write access to the host music directory; API/gonic read it only. Never use root, recursive chown or world-writable music to fix permissions.

```sh
docker compose -f compose.yaml -f deploy/compose.imports.yaml config --quiet
docker compose -f compose.yaml -f deploy/compose.imports.yaml up -d --build
docker compose -f compose.yaml -f deploy/compose.imports.yaml exec worker node apps/api/dist/worker-entry.js --check-config
docker compose -f compose.yaml -f deploy/compose.imports.yaml exec worker node apps/api/dist/worker-entry.js --healthcheck
```

The same one-command startup builds all required worker tools locally. Check-config prints only a fixed valid/disabled/error status; health checks existing DB/heartbeat without credentials or network calls. First-run missing/mismatched private file permissions fail closed. Worker or nightly failures leave stored music and the existing gateway/API available. Web imports/recent/engine entry points remain disabled until their UI Steps 10–12.

Before updating, stop the worker and make the [matching management+key+gonic+engine+host-music backup](deploy/backup/README.md), then rebuild with the same two-file command. Staging is recoverable workspace, excluded from backup. Phase 3 currently uses schema v8 (initial migration v3); even base startup migrates the DB. Disabling the overlay preserves files but does not downgrade schema. A v2 rollback requires its matching pre-upgrade snapshot and old build. See the [deployment guide](docs/architecture/import-deployment.md) for update/rollback and volume initialization probes.

## Optional listening experience

The base stack passes mixes, local listening history, gonic scrobble forwarding, economy playback,
and artist information as explicit `false` flags. Enable the completed set with:

```sh
docker compose -f compose.yaml -f deploy/compose.listening.yaml config --quiet
docker compose -f compose.yaml -f deploy/compose.listening.yaml up -d --build
```

The overlay changes only API feature flags. It reuses gonic's existing ffmpeg cache and artist
lookup; it adds no provider account, key, daemon, or worker. With scrobble forwarding enabled,
qualified plays can be sent to an external service already connected by the user in gonic. Turning
the overlay off hides new entries and stops new local listening writes, but retains schema v21 and
existing data. A historical rollback requires the matching management DB/key and gonic/music
snapshot described in [backup and restore](deploy/backup/README.md); do not downgrade only an image.

## Optional metadata editing

Use `docker compose -f compose.yaml -f deploy/compose.metadata.yaml up -d --build` after configuring private policy and scan credentials. Metadata is independent of imports; add the imports overlay before the metadata overlay when both are needed. The API reads music only; the dedicated worker owns file writes and private backups. Follow the [metadata deployment guide](docs/architecture/metadata-deployment.md) and [matching v11 backup/restore procedure](deploy/backup/README.md). Worker downtime keeps existing music playback available. File save and gonic reflection are separate outcomes; warmed gonic cover caches can delay verified reflection. Web metadata entry points remain disabled until Phase 4 S09.

### Optional metadata automation

Apply `deploy/compose.automation.yaml` after the imports and metadata overlays. Set
`AUTOMATION_POLICY_FILE` to an absolute, owner-only `0600` JSON file (example shape below).
API, metadata worker and import worker must use the same UID/GID. The initializer creates a
private shared `media-fence` volume; API music remains read-only and metadata backups remain
worker-only. Without this overlay, automation remains disabled.

```json
{
  "schemaVersion": 1,
  "maxTokenAgeMs": 2592000000,
  "curation": {
    "policyVersion": "required-v1",
    "limits": {
      "claimLeaseMs": 600000,
      "maxTargets": 20,
      "snapshotMaxAgeMs": 600000,
      "snapshotMaxItems": 1000,
      "snapshotMaxCount": 100
    },
    "inventory": {
      "batchSize": 10,
      "itemTimeoutMs": 20000,
      "batchTimeMs": 60000,
      "retryIntervalMs": 600000,
      "maxRetryAttempts": 2,
      "sweepIntervalMs": 86400000,
      "maxQueueItems": 10000
    }
  }
}
```

The metadata worker fairly runs recovery, file writes, reflection and bounded inventory batches.
`itemTimeoutMs` limits one directory or track operation, while `batchTimeMs` limits the whole
inventory turn. A batch budget expiry or worker shutdown leaves the current item pending. An item
timeout or upstream failure is retried only after ordinary pending discovery, at
`retryIntervalMs`, up to `maxRetryAttempts` additional attempts. Exhausted items keep coverage
`partial` without blocking other work. Full sweeps are scheduled from the prior reconciliation
completion time. Checkpointed discovery and retry attempts resume after restart; restored
inventories are reverified immediately.

The legacy four-key inventory object (`batchSize`, `batchTimeMs`, `sweepIntervalMs`, and
`maxQueueItems`) remains accepted. It normalizes `itemTimeoutMs` to `batchTimeMs` with no retries.
Use the seven-key form above for production so item and batch deadlines have distinct ownership.
The source-only `tools/verification/automation-http-client.ts` uses an owner-only private config
with `api`, `origin`, `upstream`, `credentialPath`, `libraryId`, and `fixtureTitle`. The credential
file contains only `username` and `password`; use a dedicated synthetic fixture and never commit
these files. `automation-runtime-probe.ts` additionally requires an owned Linux `/tmp/musiclatte-p6-*`
workspace, matching `owner.json`, Compose project and `fixtureRelativeKey: imports/synthetic.mp3`.
It changes only that isolated fixture and project. These scripts are verification clients, not
an internal AI scheduler or a production deployment command.
