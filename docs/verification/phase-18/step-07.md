# Phase 18 Step 07 verification

## Result

- `deploy/import-policy.example.json` is now a secret-free schema v2 example rooted at `jojo-music`, with an explicit safe default `watchExternalMp3: false`.
- The deployment contract fixes the existing imports overlay surface: no new environment key, host mount, public port, Docker socket, management signing-key mount, or writable secret. API `/music` remains read-only and worker `/music` remains writable.
- Import policy schema v1 remains valid and always watch-disabled. The activation guide requires API projection before worker restart and documents baseline completion, a synthetic new-file check, bounded retry, and non-destructive rollback.
- The recent architecture now describes direct MediaLink events and external provenance in management schema v31 while preserving public recent schema v1.
- `external-mp3-watch.md` documents account mapping, no-backfill baseline, stability/fd validation, internal dedupe, exact-path registration, fairness, recovery, diagnostics, and fixed limits.
- The Obsidian media/job contract records the same opt-in behavior and keeps existing-file backfill forbidden.
- P18-UA-001 and P18-UA-002 remain pending; no devserver or production deployment was performed.

## RED → GREEN evidence

- RED: the deployment contract failed 2 tests for the schema v1 example and missing architecture/operations documents.
- GREEN: the deployment contract passed 12/12 after the schema v2 example and documentation were added.
- Affected unit regression passed 207/207 across import, recent, external watch, registration, runtime, deployment, and backup owners.
- Recent/deployment/production-exclusion contract regression passed 25/25.
- Typecheck, production build, formatting, and `git diff --check` passed.

## Deployment invariants

| Surface                  | Contract                                                      |
| ------------------------ | ------------------------------------------------------------- |
| policy default           | schema v2, `jojo-music`, explicit watch false                 |
| legacy policy            | schema v1 accepted, watch disabled                            |
| API music mount          | existing `/music` read-only                                   |
| worker music mount       | existing `/music` writable                                    |
| worker secrets           | existing fixed Gonic credential only                          |
| worker management access | existing management data; no management signing key           |
| network/process access   | no new port or Docker socket                                  |
| rollback                 | disable watch, preserve database/history/observations/volumes |
| public API/UI            | recent schema v1 and existing web states unchanged            |

## Repository hygiene

- Changed paths contain no MP3, SQLite/database, runtime data, private policy, credential file, or generated artifact.
- Added lines were scanned for known private account names, private/LAN production addresses, production host roots, private-key headers, and non-placeholder password literals; no match remained.
- Documentation and fixtures use only placeholder or synthetic identities and logical container paths.
