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

Before exposing **any** gateway through a reverse proxy or LAN, open the loopback gonic administration page and change the upstream initial administrator password. Retrieve initial-account instructions from upstream gonic documentation, not shared logs. For a remote host use an SSH tunnel, e.g. `ssh -L 4748:127.0.0.1:4748 <your-host>`, then open `http://127.0.0.1:4748`. Create a separate non-administrator listening account there. Never publish the admin port. First-run account setup is required even though container installation is one command.

Production uses an operator-managed **HTTPS** reverse proxy forwarding the public origin to the loopback gateway. Configure its logs to omit credentials, request queries and private music metadata; do not proxy the administration port. `PUBLIC_ORIGIN` must match the exact HTTPS origin. This repository does not alter TLS, DNS or production services. Secure cookies are mandatory in production.

For isolated local HTTP testing only, use `docker compose -f compose.yaml -f deploy/compose.test.yaml up -d --build`; this explicitly uses development cookies and opts into the blank SPA. For a private LAN development exception, finish the loopback password change first, set the documented LAN variables and `ADMIN_SETUP_COMPLETE=true`, then use `docker compose -f compose.yaml -f deploy/compose.lan-development.yaml up -d --build`. The flag records operator confirmation; it does not change or verify a password. Never use this HTTP exception for production. Preserve existing Musiclatte profiles and add a separate opt-in profile using the gateway origin, without `/api` or an admin port.

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
