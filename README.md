# Musiclatte Server

[한국어](README.ko.md)

Source-only TypeScript music web/API project. Steps 00–03 provide the workspace, fixed gonic adapter, encrypted session storage, authentication/discovery/capability APIs and guarded admin scan. The React entry remains blank; product music browsing, playback, Gallery and deployment are later steps.

Use Node **24.20.0** and npm **11.19.0** in a project-specific version manager or shell. `.nvmrc` and `.node-version` pin Node; no global runtime replacement is required.

```sh
npm ci
npm run typecheck
npm run test:unit -- tests/unit/workspace.test.ts apps/api/test/runtime.test.ts
npm run test:contract -- tests/contract/workspace.test.ts
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

No credentials, real music, private fixtures or runtime data belong in this repository. `.env.example` files contain safe defaults and placeholders that require operator configuration. A license has **not been selected**; no LICENSE or open-source license grant is declared. `UNLICENSED` is the npm package metadata value, and all workspaces are private to prevent package publication. Container installation belongs to Step 04.
