# Account import paths and replacement — 2026-09-09

New authenticated API jobs save to `relativeRoot/account/channel/title.mp3`. The configured library
root remains authoritative (for example `imports/listener/Channel/Song.mp3`). Channel/title ID
suffixes are absent; existing character normalization is retained. A verified MP3 replaces the same
path atomically. Existing files are not moved and old jobs retain legacy recovery behavior.

## Verification

Working directory: musiclatte-server repository. Session-local Node 24.20.0, npm 11.19.0;
no global runtime changes. Synthetic child downloader/ffprobe processes and temporary filesystem/DB
fixtures exercise publication; no personal media or live YouTube download is included.

- RED: account replacement test failed before implementation because the account column did not exist;
  46 existing worker tests passed in that run.
- `npm run test:unit -- apps/api/test`: **499 passed / 33 files**, exit 0.
- `npm run test:contract -- tests/contract/import-api.test.ts tests/contract/recent-downloads-api.test.ts tests/contract/metadata-api.test.ts tests/contract/metadata-schema.test.ts`:
  **12 passed / 4 files**, exit 0.
- Broader `npm run test:contract`: **150 passed, 3 failed**. All failures are gateway-parity Docker
  setup/cleanup; `docker info` confirms the local Docker daemon is not running. Gateway configuration
  is unchanged. This is an environment limitation, not a passing whole-contract-suite result.
- `npm run typecheck`, `npm run build`, `npm run format`, `npm run format:check` and
  `git diff --check`: exit 0.

Covered outcomes: account-separated admission and durable directory ownership, character cleanup,
different source IDs replacing the same final path, completed-source redownload, stable media binding
with revision increment, download/validation failure preserving original bytes, interrupted publication
recovery without another download/event, old schemas/jobs and legacy no-replace recovery.

Schema v13 adds nullable `import_jobs.account_directory`; old rows remain null. New retries preserve
that field. Pending inode receipts distinguish a completed rename from the previous file. Active metadata
work fences publication; old media bindings become unavailable until gonic registration revalidates them.

No UI/components/localization changes; UI acceptance is not expanded by this backend change.
Obsidian Phase 3 overview, relevant Steps and media/jobs contract synchronized outside repo Git.
Rulebook search found no applicable task-specific rule; postflight `skipped(no_new_lesson)`, no canonical
write or sync. No deployment, commit or push performed. Existing devserver version is unchanged.

## Same-port devserver deployment

On the user's subsequent explicit deployment request, source `7d5f0a3` was pushed to `origin/main`
and built on devserver in `source-7d5f0a3`. The existing `musiclatte-p5-acceptance` project was
updated with all four Compose overlays and the same private environment. LAN gateway18517,
loopback gateway18516 and loopback admin18515 were preserved.

Before migration, all five project services were stopped after confirming no active import/metadata
items. A private consistent archive of mounted project volumes, music and private configuration was
verified in `backup-before-7d5f0a3`, outside source/build contexts; old source and image IDs remain.
All five services are healthy. Management schema13, quick_check=ok and zero foreign-key violations
were verified. Gateway root, live/ready health and authenticated imports each returned200; the
existing bearer session remains valid, zero import jobs and one allowed library remain.
The separate gonic-demo4747 container remained running throughout. No live download was initiated.
