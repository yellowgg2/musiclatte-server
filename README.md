# Musiclatte Server

[한국어](README.ko.md)

Source-only TypeScript foundation for a future music web client and API. Step 00 is implemented: four npm workspaces, a blank React entry, Fastify process liveness, KO/EN locale helpers and unit/contract tests. Music browsing, authentication, playback, Gallery and deployment are not implemented yet.

Use Node **24.20.0** and npm **11.19.0** in a project-specific version manager or shell. `.nvmrc` and `.node-version` pin Node; no global runtime replacement is required.

```sh
npm ci
npm run typecheck
npm run test:unit -- tests/unit/workspace.test.ts apps/api/test/runtime.test.ts
npm run test:contract -- tests/contract/workspace.test.ts
npm run build
```

Run each development command in its own terminal:

```sh
npm run dev:web
npm run dev:api
```

Web defaults to `http://127.0.0.1:5173/` and deliberately renders an empty React root until Gallery approval. API defaults to `http://127.0.0.1:3000/health/live`, returning `{"status":"ok"}`. This is process liveness, not upstream readiness. Unknown paths return 404.

`npm run dev:web -- --port 5174` forwards Vite arguments. Set `PORT=3001 npm run dev:api` to use a different API port. After building, `npm run start -w @musiclatte/api` runs the compiled API.

See [runtime decisions](docs/architecture/runtime.md) for configuration, versions and official support references, and [S00 verification](docs/verification/phase-1/step-00.md) for evidence. Shared package declarations are prepared by `typecheck` before checking consumers. Build output and local agent configuration are ignored by Git and Docker.

No credentials, real music, private fixtures or runtime data belong in this repository. `.env.example` files contain only safe defaults. A license has **not been selected**; no LICENSE or open-source license grant is declared. `UNLICENSED` is the npm package metadata value, and all workspaces are private to prevent package publication. Container installation belongs to Step 04.
