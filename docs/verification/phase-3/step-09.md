# Phase 3 Step 09 — Imports deployment verification

Date: 2026-09-07. Branch: `yellowgg2/tdd/phase-3/step-09-imports-deployment`.
Working directory: `/Users/incredibleyoung/Documents/code/musiclatte-server`.
Runtime: session-local Node **24.20.0**, npm **11.19.0**; manifests, `.nvmrc`, `.node-version`, image and actual execution agree. Host global Node was not changed.

## Changes and RED → GREEN

- `worker-entry.ts` separates normal run, `--check-config`, `--healthcheck` and invalid CLI handling. `worker-runtime.ts` wires private credential/config, persistent engine initialization, download/registration, serial engine mailbox/check scheduling, abort and DB cleanup.
- API consumes policy alone (`readApiImportConfig`); its private scan account credential is never mounted. A real configured API without worker credentials previously failed startup; it now remains ready with imports enabled and no live worker.
- Initial focused RED: unit 2 failures / 5 tests and contract 2 failures / 8 tests, for missing runtime/overlay/image and the API credential dependency. No collection/type errors.
- Additional RED: registration blocked in `getScanStatus` exposed `stopped`/no heartbeat. Registration now owns an idle heartbeat timer while awaiting the scan and cleans it on shutdown. Worker regression passes including heartbeat advancement.
- Real Linux RED: default noexec Docker tmpfs caused official standalone yt-dlp to fail mapping `libz.so.1`. Same non-root/read-only/cap-drop/no-new-privileges container passed with `/tmp:exec,mode=1777`. A Compose contract failed before adding this exact worker-only option, then passed.
- Additional RED: private import configuration/store paths were not Git-ignored, then ignored in Git and Docker. Disabled CLI with an absent optional seed manifest failed; it now exits 0 with `worker_disabled` without reading overlay files.
- Refactor: API policy-only config is separated from worker credential validation; no unrelated behavior changes. Base Compose is unchanged, API/gonic music mounts remain read-only, only worker has writable music. No iOS/gonic/bot source changes.

## Commands and outcomes

Use the session-local toolchain bin directory first on PATH. All commands below ran from the repository root, exit 0 unless explicitly described as RED.

| Command                                                                                                                                                                  | Evidence                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run format`                                                                                                                                                         | Applied pinned Prettier to repository inputs only                                                                                                                              |
| `npm run test:unit -- apps/api/test/deployment-runtime.test.ts apps/api/test/runtime.test.ts apps/api/test/import-worker.test.ts apps/api/test/engine-lifecycle.test.ts` | 4 files, **90 passed**, including config permissions, invalid/disabled/missing inputs, stale/future/stopped health, long registration and actual worker loop restart           |
| `npm run test:unit`                                                                                                                                                      | **507 passed**, 37 files; existing jsdom unimplemented media/scroll diagnostics are non-failing                                                                                |
| `npm run test:contract`                                                                                                                                                  | **121 passed**, 17 files; includes deployment, actual nginx gateway, production exclusion, workspace, imports/capability and locale parity                                     |
| `npm run typecheck`                                                                                                                                                      | Root/test and all workspaces passed                                                                                                                                            |
| `npm run build`                                                                                                                                                          | API/contracts/test-support/web production builds passed                                                                                                                        |
| `npm run format:check`                                                                                                                                                   | Passed                                                                                                                                                                         |
| `git diff --check`                                                                                                                                                       | Passed                                                                                                                                                                         |
| `docker compose -f compose.yaml config --quiet`                                                                                                                          | Passed with synthetic required environment                                                                                                                                     |
| `docker compose -f compose.yaml -f deploy/compose.imports.yaml config --quiet`                                                                                           | Passed with synthetic policy/credential paths; JSON contract verifies exact unchanged base gonic/web/volume-init, API dependency independence, mounts, ports and extra volumes |
| `docker build -f deploy/worker.Dockerfile -t musiclatte-s09-worker .`                                                                                                    | Source-only Linux arm64 build passed; no registry push                                                                                                                         |

Final local worker image ID: `sha256:00603c4c1740fd540305ad5faeaa29ffe6889efd430440fc4065e5f17d6b7c00`.
Actual image tools: Node 24.20.0, npm 11.19.0, yt-dlp 2026.08.19, FFmpeg 5.1.9-0+deb12u1. Image filesystem probes confirmed no `apps/api/src`, `node_modules/vitest` or `node_modules/@musiclatte/test-support`. Official arm64 artifact hash was verified during build; both amd64/arm64 fixed hashes match official release `SHA2-256SUMS`. amd64 was not executed on this arm64 host.

## Isolated container evidence

Synthetic private files only; unique `musiclatte-s09-*` containers/volumes, **network none**, no published ports, no devserver or real music access. Probes used the built image with `--read-only --cap-drop ALL --security-opt no-new-privileges:true --tmpfs /tmp:exec,mode=1777`. The one-shot initializer ran root only with CHOWN/FOWNER/DAC_OVERRIDE, its script read-only, and only test staging/engine mounts.

1. Empty staging/engine initialized to numeric 1000:1000, mode 0700. Writing an owned marker and rerunning preserved it. Changing IMPORT_UID to 1001 with nonempty staging returned nonzero without recursive chown.
2. Canonical owned management/music/staging/engine plus mode-0600 synthetic policy and credential passed `node apps/api/dist/worker-entry.js --check-config`: exactly `worker_config_valid`. A missing credential returned exit 1 and only `worker_unavailable`.
3. Normal worker initialized the real standalone seed with no network and became healthy. Nightly network failure did not prevent heartbeat. `--healthcheck` passed while running; after SIGTERM, container exited 0 and health returned 1. Two process lifetimes preserved the active engine. Logs contained no synthetic credential values.
4. While stopped, management and engine volumes were copied with numeric ownership into **new** volumes; staging was empty and initialized afresh. Restored worker became healthy and exited 0 on SIGTERM. Original volumes were not overwritten.
5. All owned containers and volumes were removed. The temporary local worker image/tag was removed after final verification. No browser/tab/devserver or host music resources were created.

The unit suite covers matching management/key backup validation; the container smoke checks engine+management and empty-staging restoration. Whole-stack matching gonic/music live recovery, actual YouTube import, writable sample and iPhone playback remain Step 14 responsibilities. This step did not deploy the imports overlay on devserver or change DNS/TLS.

## Gates and documentation

- BRANCH_SETUP, PROJECT_DOC_CONTEXT, LESSONS_CONTEXT, RED, GREEN, LOCALIZATION, DOC_SYNC and GATE_CHECK completed. `update_plan` was not registered; gate evidence is recorded here.
- No product UI/copy/component diff: UI route/review/test/Gallery/manual gates are not applicable, review debt **0**, existing Gallery approval unchanged. Browser cleanup not applicable.
- KO/EN README setup/probe/UID/credential/update/rollback complete. Existing `ko.json`/`en.json` remain unchanged with matching nonempty keys; no new UI strings.
- Backup docs explicitly distinguish initial v3 migration and current v8 from pre-P3 v2, require matching management+key+gonic+engine+host music, exclude staging, and forbid image-only schema downgrade.
- Obsidian Step 09, Phase 3 overview and deployment contract synchronized with actual implementation and verification. Vault files remain outside repository commits.
- Rulebook lookup selected only `typescript-align-local-node-contracts-with-the-deployment-image-001`; GREEN/image/command checks apply the exact project-pinned runtime. Two unknown-compatibility foreign rules were dropped.
- `yk-rulebook-reconcile`, mode=postflight, project=musiclatte-server, context Node24.20.0/npm11.19.0/TypeScript7.0.2: **skipped(no_new_lesson)**. The bounded fixes did not meet high debugging/token cost capture eligibility. Canonical write/index/re-search/sync: not applicable; no local lesson/outbox created.
- No pending user-only confirmation for Step 09. Project commit/push not performed; separate Rulebook data repo unchanged.
