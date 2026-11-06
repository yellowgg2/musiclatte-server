# Compact imports and publication diagnosis — 2026-11-06

The imports list now leads with song titles, combines channel and stage, and places dates and
original-import links in a small footer. Item retry, job cancellation, original-job navigation and
focus targets remain available. Request duplicates have their own KO/EN label so they do not imply
that a file has already been saved. Shared Action/StatusSurface/field tokens are reused; the layout
is feature-local and introduces no shared component or Gallery change.

Duplicate requests previously had no observed metadata and displayed the video ID. Repository reads
now inherit observations from the exact original item, scoped to the same account, library and
source. Existing duplicates also pick up observations recorded after admission. No schema migration,
network metadata lookup or production database mutation is involved. Sources without any observed
metadata still use their video ID until information is available.

## Verification

Runtime: session-local Node 24.20.0 / npm 11.19.0. Starting checkout: clean
`c8e639c2a26fead86aea79cb22c0116d310a1f7a`; this is an ad-hoc change, with no branch, commit or push.

- RED: duplicate detail omitted title/channel after the original resolved; GREEN verifies detail,
  history and account isolation. RED: song-title headings were absent. RED: request duplicates used
  the imported-file label. Their focused regressions pass after the changes.
- Unit: `npm run test:unit -- apps/api/test/import-api.test.ts apps/api/test/import-storage.test.ts apps/api/test/import-worker.test.ts apps/api/test/import-boundaries.test.ts apps/web/test/import-ui.test.tsx apps/web/test/import-state.test.ts`
  passes **121 tests / 6 files**. Concurrent API admissions while downloading return 202 with
  queued/queued/duplicate results; the active download remains intact, a second worker cannot claim
  another item, and the next queued item can run after a failure. Router submission also preserves
  the running song and unlocks the input after admission.
- Contract: `npm run test:contract -- tests/contract/import-api.test.ts tests/contract/import-ui.test.ts`
  passes **6 tests / 2 files**.
- `npm run typecheck` and `npm run build` pass. Build retains the existing large-chunk warning.
- Native Chrome via `cua_repl`, normal `/login` → `/imports`, synthetic preview only, dedicated
  loopback ports 3009/5179: title/stage/retry presentation, failed-only retry, original-job anchor,
  input of a mix/index URL while another job is running, preserved original rows, and 320px iframe
  retry were verified by accessible state and screenshots. The browser access host was unavailable;
  native Chrome was used. No real downloader or media was used in this UI check.
- Final KO/EN, zoom/theme/reflow and screen-reader acceptance remains separate in the Obsidian
  ad-hoc UI acceptance index. These basic runtime checks do not mark that matrix passed.

Local command logs are under ignored `artifact/imports-compact-20261106/`.

## Unraid import failure: diagnosis only

Both user-reported sources reached downloading, postprocessing and publishing, then failed with
`publish_failed` before registration. Playlist/index context was already stripped successfully.
Disk space, directory access, mount writability, synthetic copy and fsync were healthy.

The Unraid shfs mount assigned a synthetic pending file an inode above JavaScript's safe-integer
range. Production `createWorkerLedger.recordIdentity` rejected it as `worker_storage_invalid`;
production `publishMediaFile` mapped that exception to `publish_failed`. The direct probe reproduced
both errors, attempted zero production database writes, removed its temporary source/pending file,
and left the real final target absent. Existing media and deployment/configuration were unchanged.

This storage compatibility defect is diagnosed, **not fixed** by the UI change. A storage correction
must preserve exact 64-bit file identity through publication, receipts, recovery and backup instead
of weakening the integer guard or accepting rounded numbers. There was no Unraid deployment.

Rulebook search returned incompatible candidates; none were applied. No new resolution was captured:
the storage defect has no verified fix, and the UI/title changes are project-specific behavior.
