# S01 verification — 2026-09-05

Implemented a typed read-only Subsonic adapter, source-derived synthetic fixture server and parity tests. This is S01 completion evidence; Phase 1 product AC-11 remains open for S04 native/gateway and S10 listening verification.

## Environment and commands

- cwd: `/Users/incredibleyoung/Documents/code/musiclatte-server`
- branch: `yellowgg2/tdd/phase-1/step-01-subsonic-adapter`, created from clean `main` before reading the Step.
- Every npm command used session-local `~/.cache/musiclatte-toolchain/node-v24.20.0-darwin-arm64/bin` first in PATH: Node `v24.20.0`, npm `11.19.0`; installed TypeScript `7.0.2`, Vitest `5.0.0`, Vite `8.2.2`.
- No dependency installation, host runtime change, deployment or source commit/push.

| Stage          | Exact command                                                     | Result                                                                                            |
| -------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| RED            | `npm run test:unit -- apps/api/test/subsonic-client.test.ts`      | 24 collected, 24 intended assertions failed, exit 1: missing adapter; no import/collection errors |
| RED            | `npm run test:contract -- tests/contract/subsonic-parity.test.ts` | 31 collected, 31 intended assertions failed, exit 1: missing adapter/protocol                     |
| RED            | `npm run typecheck`, `npm run build`                              | Both exit 0 before production implementation                                                      |
| GREEN/refactor | Same focused unit / contract commands                             | 24 / 31 passed, exit 0                                                                            |
| GREEN/refactor | `npm run typecheck`, `npm run build`                              | Exit 0 for all workspaces                                                                         |
| GATE_CHECK     | `npm run test:unit`                                               | 32 passed across 3 files, exit 0                                                                  |
| GATE_CHECK     | `npm run test:contract`                                           | 34 passed across 2 files, exit 0                                                                  |
| GATE_CHECK     | `git diff --check`                                                | Exit 0                                                                                            |

Initial GREEN typecheck found missing Node ambient types in test-support. Added explicit `types: ["node"]` using existing installed `@types/node`; subsequent typecheck/build passed. No runtime behavior was weakened. Test harness duplicate draft interfaces were replaced with actual exported types after GREEN.

## Evidence coverage

- Normal/empty metadata payloads, integer root IDs and opaque entity IDs, Unicode/query encoding, repeated native playlist parameters and duplicate ordering.
- HTTP/standard error distinction, codes 0/10/20/30/40/41/50/70/unknown, invalid wrapper/HTML/schema/identity, no raw/enc retry, no inferred capability from error 70.
- Fixed origin, unsafe origin rejection, redirect refusal, proof snapshot, credential/query-safe errors and diagnostic events, pre-abort, in-flight abort, header/body timeout.
- Server-only media request construction with GET/HEAD/Range/cover size; no transport or player implementation.
- Fixture server restricted to loopback, random port and read-only endpoint allowlist; all servers and sockets closed by test teardown.

## Existing demo read-only smoke

SSH inventory confirmed Linux, existing `gonic-demo`, image reference `sentriz/gonic:latest`, runtime `gonic -version` = `v0.22.0`, published port 4747. Remote Node `v22.23.2` was observed but not used to build or run this project. Local compiled adapter used the pinned Node through a session-owned loopback SSH forward.

11 checks passed: ping, currentUser (returned identity and admin role verified), folders, indexes, directory, random, search, artist, album, emptySearch, missingDirectory70. Output contained only check names and status. No credentials, request URLs, track IDs/titles, source payloads or other personal metadata were saved. Existing service/config/volumes were preserved; no scan, CRUD or media fetching was performed.

## Gates and limits

BRANCH_SETUP, PROJECT_DOC_CONTEXT, RED, GREEN, PROJECT_SETUP (Node types), REFACTOR (test type deduplication), LOCALIZATION and DOC_SYNC completed. LESSONS_CONTEXT skipped: returned Rulebook rules were deployment/UI/bulk/authenticated-ID topics, unrelated or compatibility unknown. Postflight: `skipped(no_new_lesson)`; the one immediate type-configuration fix does not meet 3×HIGH. No canonical write or Rulebook sync needed.

UI class/action, Chrome, Gallery/catalog and baseline approval are not applicable: no UI diff, new visible strings 0, UI review debt 0. KO/EN existing resources remain the locale contract. No manual user verification required for S01. Live gateway/native, media streaming and product AC checks remain with their planned owners.

Source/consumer manifest: `docs/architecture/subsonic-compatibility.md`. Actual symbols: `createSubsonicClient`, `SubsonicClient`, `SubsonicTokenProof`, `SubsonicError`, `decodeEnvelope`, payload decoders, `createFakeSubsonic`, `subsonicFixture`, `subsonicErrorFixture`.

## Final gate

All required S01 gates completed or explicitly skipped as above. Entire existing suite passed: unit 32 and contract 34. KO/EN matching nonempty keys and placeholder parity passed in the workspace unit tests. Session-owned SSH tunnel was terminated; temporary official-source checkout and RED logs were removed after recording evidence. No dev servers or browser tabs were created. No user approval or blocker remains for S01. Project source stays uncommitted/unpushed; local-only ignored AGENTS.md includes the user-authorized existing demo reference and default login information.
