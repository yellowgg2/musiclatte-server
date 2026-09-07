# Phase 3 Step 02 verification

## Scope and gates

Completed branch setup, project/Step context, RED/GREEN, focused refactoring, localization parity,
document synchronization and gate check. No product UI changed: UI classification, Chrome flows,
Gallery/catalog updates and baseline approval are not applicable; review debt is zero. No user-only
verification remains for this Step. No devserver process or browser tab was created.

The isolated branch is `yellowgg2/tdd/phase-3/step-02-import-boundaries`. Step 01 was complete and the
worktree was clean before branch creation. Obsidian files are outside the repository's Git scope.
The session has no update_plan tool; gate status was tracked in execution and this completion record.

## RED evidence

- The first 12 boundary tests collected normally and failed assertions for the absent modules.
- Runtime configuration tests showed that enabled/malformed import settings were accepted before
  startup integration; the config module assertion also failed. RED typecheck passed.
- A real subprocess fixture showed that an early-exiting leader could leave a live child while the
  runner returned success. The regression now requires group cleanup and a safe failure.
- A configured root with a symlink in an ancestor initially passed resolution. The regression now
  requires a canonical root and rejects that alias.

All failures used assertion evidence, not import-collection or syntax errors. A macOS-provided
CoreFoundation child environment value was observed during GREEN; the test now directly verifies
absence of ambient HOME/PATH/NODE_OPTIONS/worker credentials while accepting OS-added metadata.

## Security fixture results

| Boundary          | Verified result                                                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source URLs       | watch/music/mobile/short/shorts identity parity; invalid hosts, ports, schemes, fragments, userinfo, redirect-looking paths, duplicate/unknown/playlist selectors rejected. |
| Policy            | immutable nested data; disabled without file; exact account lookup; unknown fields, duplicate IDs/users, unsafe paths and overlapping roots rejected.                       |
| File naming       | Unicode NFC and UTF-8 bounds; reserved names; stable video/channel suffixes; channel rename reuse; ambiguous channel collision; untouched legacy file.                      |
| File access       | dot/absolute/backslash aliases, root/ancestor/leaf symlinks and non-directory parents rejected.                                                                             |
| Publication       | full synthetic content; same-source valid duplicate only; conflicts preserved; concurrent winner never overwritten; invalid audio and in-scan staging rejected.             |
| Async replacement | injected verifier replacing the target parent with a symlink is rejected before writing outside; verifier error text is redacted.                                           |
| Process           | literal backticks, dollar substitution, semicolon and newline create no marker; bounded output/exit status; env/cwd allowlists and safe spawn failure.                      |
| Cancellation      | stdout/stderr byte overflow, pre-abort, graceful and TERM-resistant children, early leader exit; test-owned processes stopped.                                              |
| Runtime           | disabled/default, valid enabled probe, invalid boolean and missing policy/worker credentials; actual API startup rejects invalid imports.                                   |
| Compatibility     | existing authentication/storage/readiness and workspace/deployment contracts pass; no P3 capability producer or UI enabled.                                                 |

Audio/source verification is injected and uses synthetic bytes here; this is not a claim of real MP3,
yt-dlp, gonic scanning, power-loss, network-filesystem or hostile local-process verification. See
[the boundary architecture](../../architecture/import-boundaries.md) for the local filesystem trust
model and atomic link/unlink choice. Worker integration/crash recovery remains Step 03; live media and
deployment verification remain with their planned owners.

## Commands and results

Cwd: repository root. Session-local Node **24.20.0**, npm **11.19.0**, TypeScript **7.0.2**, Vitest
**5.0.0**; `.nvmrc`, `.node-version`, manifest/lockfile and deployment image remain aligned. No host
runtime or dependencies changed.

| Command                                                                                                                                                                                                                                                                     | Result                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `npm run format`                                                                                                                                                                                                                                                            | Exit 0 before verification; repository files only.            |
| `npm run test:unit -- apps/api/test/import-boundaries.test.ts apps/api/test/runtime.test.ts apps/api/test/deployment-runtime.test.ts`                                                                                                                                       | 3 files, 22 tests passed, exit 0.                             |
| `npm run test:unit -- apps/api/test/import-boundaries.test.ts apps/api/test/runtime.test.ts apps/api/test/deployment-runtime.test.ts apps/api/test/auth-runtime.test.ts apps/api/test/auth-api.test.ts apps/api/test/credential-vault.test.ts tests/unit/workspace.test.ts` | 7 files, 75 tests passed, exit 0.                             |
| `npm run test:contract -- tests/contract/workspace.test.ts tests/contract/deployment.test.ts`                                                                                                                                                                               | 2 files, 9 tests passed, exit 0.                              |
| `npm run typecheck`                                                                                                                                                                                                                                                         | All workspaces passed, exit 0.                                |
| `npm run build`                                                                                                                                                                                                                                                             | API/contracts/test-support and production web passed, exit 0. |
| `npm run format:check`                                                                                                                                                                                                                                                      | Passed, exit 0.                                               |
| `git diff --check`                                                                                                                                                                                                                                                          | Passed, exit 0.                                               |

KO/EN resource parity and placeholder completeness pass via tests/unit/workspace.test.ts. New visible
copy/locale keys: zero. The complete unrelated unit/contract suites were not run. Synthetic temporary
roots and child processes were cleaned up. No commit, push, deployment, existing service or volume
mutation was performed.
