# Unraid import publication and repeated failure cards — 2026-11-06

Starting checkout: clean `372605913cdfc02c02f6c3d02370beb1bd5026f3`. The user confirmed continued
Unraid failures, requested one card for repeated failures of the same source, and authorized deploying
the completed correction.

## Storage correction

New production attempts still completed downloading/postprocessing before failing `publish_failed`.
The earlier diagnosis identified `createWorkerLedger.recordIdentity` rejecting a shfs inode outside
JavaScript's safe Number range. The correction uses bigint filesystem stats for all import file
identity comparisons, records bigint device/inode values directly into existing SQLite INTEGER
columns, and compares receipts inside SQLite. Unused identity columns are omitted from intent reads;
backup validation casts only identity columns to canonical decimal text. Source copy sizes use a
guarded exact Number conversion; file identity does not.

No schema migration is needed: schema v32 already has signed 64-bit INTEGER columns. Negative values
and values outside SQLite's signed 64-bit range remain rejected. Deploy API/import worker/metadata
worker together because they share these compiled storage helpers. Older binaries still decode large
receipts incorrectly; retain matching private database/key backups and the prior image set for recovery.

## Failure card presentation

For sources with failures, the view chooses the newest actual attempt per library/source and hides
older attempts and redundant request-duplicate cards. A newer successful/current attempt replaces the
old failure. Other songs in mixed jobs and other libraries remain visible. This is a read-only view
selection: API history and stored jobs are unchanged. View original import explicitly reveals and
focuses that job; a new mutation returns to the compact default. Shared components/tokens and all
KO/EN strings are reused; no Gallery or locale key changes.

Duplicate-only pages also retain one card when the original attempt is off-page. If mutation output
is folded into an existing attempt, accepted-result focus moves to that retained visible card.

## Verification

- Node 24.20.0 / npm 11.19.0, session-local toolchain.
- RED: an exact odd inode `11258999164501919n` was rejected with `worker_storage_invalid`; GREEN
  covers exact recording, adjacent-inode mismatch, negative rejection, database reopen and real
  backup/restore. The default-card Router regression first failed because older failure cards remained.
- Unit: affected worker/boundaries/storage/backup/API/registration and web UI/state files:
  **157 tests / 8 files**, exit 0 before the two review regressions; final web subset
  **23 tests / 2 files**, exit 0, includes duplicate-only pagination and folded-result focus.
- Contract: import API/UI, metadata schema and deployment: **21 tests / 4 files**, exit 0.
- Typecheck/build pass; build retains the existing large-chunk warning.
- Isolated **Unraid shfs** probe, outside the music library, with no production DB/music mounts:
  real FFmpeg generated synthetic audio; real ffprobe validated it; the patched worker published
  under the shared media fence using an actual inode above Number.MAX_SAFE_INTEGER. A deliberate
  crash after publication recovered to registering with one engine acquisition and one DownloadEvent.
  The stored decimal receipt exactly matched bigint stat. The temporary container was removed.
- Native Brave fallback (Chrome native window unavailable), synthetic normal `/login` → `/imports`:
  three same-source failed/request-duplicate jobs appeared as one card. View original import revealed
  the earlier job and focused its song heading. Existing unit tests verify retry, mixed successes,
  account/route state and library isolation. Full visual/device acceptance remains pending in the
  existing `IMPORT-COMPACT-UA-001–002` entries.

Local command/probe evidence is under ignored `artifact/imports-repair-20261106/`. It contains no
production media, titles, raw child output or credentials. Production backup/deployment results are
recorded separately after verification.

Rulebook search returned incompatible candidates; none were applied. The verified large-inode
mechanism is assessed separately for portable resolution capture. Independent review and final
format verification are recorded in the local completion evidence.
