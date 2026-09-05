# S04 — Compose and gateway verification

Completed 2026-09-05. Source branch: `yellowgg2/tdd/phase-1/step-04-compose-gateway`. No source commit/push, image publication, production deployment or DNS changes.

## Implementation and boundaries

- Root `compose.yaml`: web/gateway, API, digest-pinned gonic, and a network-disabled one-shot empty-volume ownership helper. The helper is not a P3 worker; long-running services use non-root UIDs. Music is read-only, gonic admin and gateway binds are loopback, API has no host port.
- Six project-scoped named volumes separate gonic data/cache/playlists/podcasts, management DB and key. Existing nonempty volume ownership is never recursively changed. `initializeContainerStorage` creates a key only for empty management storage and refuses missing/invalid keys beside existing data.
- `registerReadiness` probes management SQLite and bounded unauthenticated gonic connectivity; liveness and discovery are independent. It does not claim credential setup or scan readiness. Container health checks, restart policies and nginx Docker DNS re-resolution cover cold start/recovery.
- `deploy/gateway.conf`: `/rest/*` preserves URL/query/method/body/status/range/cache headers; API/discovery errors do not become SPA documents. The blank SPA requires explicit opt-in. Dev paths and test source are excluded; no product UI/shared component was added.
- Gateway access logs contain only status, bytes and duration; request-bearing nginx error logs and upstream gonic logs are disabled. API request logging remains disabled. Operators must apply the same redaction at their external TLS proxy.
- Default production requires an HTTPS public origin. `compose.test.yaml` is explicitly loopback HTTP development. `compose.lan-development.yaml` is a separate private-LAN HTTP exception with administrator-setup attestation; it cannot verify a human's password change. Base Compose never publishes externally. Admin password change is required before any external proxy or LAN bind.

## Automated evidence

CWD for npm commands: repository root. Local macOS arm64 and both API/build containers use **Node 24.20.0 / npm 11.19.0**. Vitest 5.0.0. All GREEN/final commands below exited 0 with nonzero test counts.

| Gate / command                                                                                     | Result                                                                                                                               |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| RED deployment contract                                                                            | 3 intended missing-artifact assertions; exit 1                                                                                       |
| RED gateway parity                                                                                 | 3 intended missing-gateway assertions; exit 1                                                                                        |
| RED deployment runtime                                                                             | 2 missing-initializer assertions and readiness 404 vs 200; exit 1                                                                    |
| RED volume ownership follow-up                                                                     | missing one-shot helper assertion; exit 1                                                                                            |
| RED typecheck/build                                                                                | passed, no collection/import/compiler failure used as RED                                                                            |
| `npm run test:unit -- apps/api/test/deployment-runtime.test.ts apps/api/test/auth-runtime.test.ts` | 16 passed                                                                                                                            |
| `npm run test:contract -- tests/contract/deployment.test.ts tests/contract/gateway-parity.test.ts` | 7 current cases; covered by final full contract run                                                                                  |
| `npm run test:unit`                                                                                | 101 passed, 9 files                                                                                                                  |
| `npm run test:contract`                                                                            | 68 passed, 5 files, including 3 real-nginx cases                                                                                     |
| `npm run typecheck`                                                                                | passed all workspaces                                                                                                                |
| `npm run build`                                                                                    | passed all workspaces, blank React production bundle                                                                                 |
| `docker compose config --quiet` + isolated HTTP override                                           | passed on devserver Compose 2.17.2 / Docker 23.0.2, Linux x86_64                                                                     |
| `docker compose … up -d --build`                                                                   | local source build/start passed; gonic/API/web healthy                                                                               |
| Production image inspection                                                                        | no project tests/test-support/API source or Vitest/TypeScript dev dependencies in final API image                                    |
| Source hygiene                                                                                     | 99 source candidates and Git history checked against private test credentials; no media/DB/key candidates; `git diff --check` passed |

Real nginx tests use a disposable user-defined Docker network and synthetic HTTP producer. They verify GET/POST/query, exact 206 bytes, Content-Range/Accept-Ranges/ETag/Cache-Control, native XML 403, API JSON 404/discovery/cookie headers, transport failure JSON 502, deep-link opt-in, dev/assets 404 and secret-free access/error logs. Config tests also reject missing LAN attestation and invalid UI option values. Production images were actually built and run, not inferred solely from config text.

## Isolated live gonic and native consumer

The existing demo stayed running on its original port/image/volumes. Two unique temporary projects used separate storage and free loopback ports 18080/14748; no existing music or service state was mutated. A self-generated 20-second sine-wave MP3 lived in a synthetic album subdirectory outside the repository and build context. No private music was copied. Root-level loose fixture files were moved into an album directory so this gonic scan found them.

Observed gonic: **v0.22.0**, `sentriz/gonic@sha256:516fd9645614ba3a596d86174216c3e944808b9ec970c581678713be4c8b1d49` (E-09). Gateway: nginx 1.28.0. No gonic/iOS/bot source changes.

Live HTTP checks passed: change initial admin password through loopback admin HTTP, reject the old password, create/authenticate a separate listener, `getUser.adminRole=false`, native `startScan` error 50, management scan 403 even with ALLOW_SCAN=true, admin scan of the synthetic library, music folders/indexes/search, session/discovery, and direct-gonic versus gateway **identical 206 status, Content-Range, Content-Type and 1024 media bytes**. Authenticated URLs and credentials were never persisted in repository evidence or service logs.

Native consumer: existing **Musiclatte 1.7 (17)** Debug Simulator build, installed without code changes in a new **iPhone 13 mini / iOS 26.5** device named `Codex-Musiclatte-S04`. Existing Simulator devices and saved server profiles were preserved.

- CUA normal entry: login to the separate loopback gateway → `music` folder → synthetic album → play the synthetic track.
- AX evidence: successful folder list, one-song album, `일시 정지 / 재생 중`, player position advancing to 8 seconds; conversation screenshot showed 15 seconds, then AX reached 20 seconds. This proves Simulator stream progress, not physical-speaker or real-iPhone/background audio quality.
- Native search: CUA's coordinate-click surface returned `noWindowsAvailable` for the search tab while AX actions remained available. User completed the same dedicated Simulator's `S04` search and replied **`done`**. This is user evidence, distinct from Codex HTTP search evidence.
- No web UI review, Gallery baseline or Chrome preview applies to this deployment-only diff. S05 Gallery approval and S10 physical-iPhone audio checks remain later owners. UI review debt: 0.

## Restart and restore

The tested commands correspond to the [backup recipe](../../../../deploy/backup/README.md).

1. Restarted only the new API/gonic containers. Readiness recovered; the pre-restart bearer, key and instance ID remained valid. Inspected gateway logs without disclosing credentials: all request records were status-only.
2. Stopped the new project's web/API/gonic together, archived gonic data/playlists/podcasts plus management DB/key with source mounts read-only. Music was immutable synthetic fixture; cache was excluded as reproducible.
3. Restored into a second new project's volumes using the same images and numeric ownership. All services became healthy; the same instance ID and snapshot-valid session survived.
4. Stopped restored web/API, called `bumpPolicyRevision()` offline, restarted, verified the old bearer became 401 and a fresh upstream login succeeded. Historical rollback cannot revive a revoked session.

Both test projects, their explicitly identified named/anonymous volumes, temporary source/credentials/music/archive files, SSH tunnel and dedicated Simulator were cleaned up. No `down -v` was used and no existing demo volume was removed. Downloaded base images/build cache remain reusable local tooling artifacts.

## Gate accounting

BRANCH_SETUP, PROJECT_DOC_CONTEXT, LESSONS_CONTEXT, RED, GREEN, PROJECT_SETUP (Docker images/empty-volume provisioning), native UI_TEST, MANUAL_UI_TEST (user search `done`), LOCALIZATION, DOC_SYNC, LESSONS_LEARNED and GATE_CHECK completed. `update_plan` was not available in this session's tool registry; gate status is recorded here. REFACTOR completed: user-requested pinned Prettier setup and repository formatting; no semantic code changes from formatting. Product UI sanity/full/defer, Gallery/catalog changes and Chrome preview are N/A; no approval remains.

Locale sources: existing `ko`/`en` JSON resources, unchanged product keys, 0 new visible keys, matching nonempty keys/placeholders verified by workspace tests. Both installation READMEs and backup/recovery guidance were updated. External Step/overview/phase/deployment contract were synchronized, with full product AC-10/11/12 left to their remaining UI/final consumer owners.

Central Rulebook search succeeded. Applied `typescript-align-local-node-contracts-with-the-deployment-image-001` to container/local exact runtime and clean install/build validation. Unrelated/unknown-compatibility matches were dropped. A repeated synthetic scan-fixture failure search returned no additional applicable safeguard. `yk-rulebook-reconcile mode=postflight`: **skipped(no_new_lesson)** because bounded configuration/fixture fixes did not meet all three HIGH thresholds; no canonical write or Rulebook repo sync was needed.

References: [nginx proxy semantics](https://nginx.org/en/docs/http/ngx_http_proxy_module.html), [Compose readiness dependencies](https://docs.docker.com/compose/how-tos/startup-order/), [gonic v0.22.0 source](https://github.com/sentriz/gonic/tree/v0.22.0). Source-only license choice is still undecided; no license grant or public image release was invented.

## Follow-up: readable source formatting

At the user's request, pinned Prettier 3.9.6, `.prettierrc.json`, `.prettierignore`, `.editorconfig`, `format`/`format:check` scripts and VS Code formatter settings/recommendation were added. Existing repository sources were formatted, including the previously compressed capability route. Project-local ignored `AGENTS.md` now requires format before validation and format:check before completion. No global Codex configuration, MCP service or hook was installed. Final format check, 101 unit tests, 68 contract tests, typecheck and build passed again after formatting. Runtime behavior and production image contents are unchanged by the development-only formatter.

## Resume audit

Resumed S04 after the separate `codex-config` Gitpush skill work. The S04 branch, completed Step/overview, native user confirmation, postflight outcome and resource cleanup records agree; no required gate or user confirmation remains. Node 24.20.0/npm 11.19.0, `npm run format:check` and `git diff --check` were checked again successfully. No runtime code changed during the skill work, so the completed unit/contract/typecheck/build and live-server evidence above remains applicable without repeating those runs. S05 remains a separate next Step. No Musiclatte source commit/push was performed.
