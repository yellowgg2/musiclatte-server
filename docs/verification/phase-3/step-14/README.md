# S14 actual devserver verification — 2026-09-07

Status: **complete — device confirmation received and owned server resources removed**.
User completed dedicated web login. Earlier authentication and S04 blockers are resolved.
The TDD verification performed no project commit/push, production deployment, DNS change, or existing service replacement.
Private URLs, source metadata, credentials, media, and absolute remote paths are excluded.

## Verified source regressions

Each source defect reopened its owner and used a clean isolated branch from the original HEAD. Verified patches were transferred to the S14 worktree and rebuilt in the isolated server.

| Owner         | Defect and final behavior                                                                                                                                                                                                                                                                                                                                            | Evidence                                                                                                                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S04 / S14-B01 | Pinned gonic v0.22.0 serializes zero scan count with `omitempty`. Decode omitted count as zero; preserve strict scanning and malformed present-count rejection.                                                                                                                                                                                                      | RED: 3 intended failures/69 tests. GREEN: focused69 + worker46, contract55, typecheck/build. Fresh empty real gonic fixture automatically registered one published legal file: ready/event/link1, repeated work false. |
| S10 / S14-B02 | Bodyless web DELETE omitted the JSON Content-Type required by cookie mutation protection. Send the required header while preserving an empty body.                                                                                                                                                                                                                   | Production client→API regression RED1/12; GREEN27 units +6 contracts, typecheck/build. Real Chrome queued cancellation became cancelled, attempt0, request recorded; reload shows cancellation.                        |
| S12 / S14-B03 | Daily check coalescence keeps the same engine projection; UI incorrectly treated unchanged state as an unknown failure after30s. An independent non-checking GET now settles the acknowledgement and displays current status without claiming a new update. Restore requires the requested pointer or an independently confirmed identical already-restored pointer. | RED1/23; GREEN33 units +6 contracts, typecheck/build. Repeated restore RED1/24→GREEN; final live results below.                                                                                                        |

Original first import required a diagnostic scan before S04 was fixed; it is **not** a clean first-import pass. The subsequent fresh empty-gonic registration and normal new-library downloads used the fixed production decoder. A diagnostic live startScan counter based on an error-only logger was discarded; the integration fixture measures one HTTP startScan, while live evidence proves final registration without an intervening manual scan.

## Local gates

Node24.20.0/npm11.19.0, matching the deployment worker runtime. Host global Node unchanged.
Final S12-inclusive suite results are recorded below. Earlier S04+S10 full suite: unit572/42 files, contract131/20 files, typecheck/build exit0.
KO/EN409 keys each; missing/empty/placeholder mismatches0; no added product copy.
Source-shaped fixtures use only synthetic identifiers. No schema, gonic, native, or bot source changes.

## Actual server and browser flows

- Exact S13 isolated Compose project reused. Initial inventory: Linux x86_64, Docker23.0.2, Compose2.17.2; workerNode24.20.0, hostNode22.23.2 preserved. Initial517 tracked source hashes matched. Existing service ID/image/start/ports/normalized mounts remained unchanged.
- Worker/API/gonic/web healthy, live/ready HTTP200. Actual pinned nightly metadata/download/FFmpeg/after_move produced nonempty regular MP3; ffprobe codec, stable video/channel ID path and no-symlink assertions passed without exporting values.
- Chrome normal login, invalid URL refusal, repeated legal source in one submission→canonical item plus duplicate; all-duplicate reimport created no new event. Reload preserved durable job identity. Unauthorized account denied imports and engine UI before dedicated account login.
- Actual candidate2026.08.30.232658 activated from seed2026.08.19 after source validation. Previous restore returned active to seed; running/saved playback continued and later attempts used the restored version.
- Actual recent default7d and KO/EN custom single-day range, current-time snapshot and download order checked. New playlist creation and append to an existing playlist succeeded. The first test playlist intentionally contains two occurrences of the original song.
- Actual browser audio position advanced across Music/Imports/Settings and engine restore. Worker stop kept API readiness200 and standard stream206 with4096 audio bytes. Imports became scoped temporarily_unavailable; rejected admission added no job/event. Worker restart restored history.
- Mid-download worker termination recorded process_aborted, preserved existing ready media, and acknowledged staging cleanup. Failed-only retry created one child item. Dropping its accepted HTTP202 response and replaying from Chrome returned the exact same child job; no extra child was created. The child became ready.
- After-publication COMMIT and accepted startScan crash hooks both fired in the isolated worker. Production process recovery reached all published events/links without duplicate ready or publication records. Docker container restart count was not used as process-recovery evidence. Temporary NODE_OPTIONS/mount hooks were removed by recreating only the test worker.
- Page-boundary fixtures use the same approved legal sample in disjoint test library roots, yielding distinct files and gonic IDs. This does not prove distinct-source live partial-success behavior; synthetic owner tests retain that coverage. One later external download failure is retried only for its failed item.
- Actual queued cancellation after S10 fix: cancelled item, attempt0, recorded request, no publication; existing ready media retained.

## Engine failure and matching restore

- Persisted daily lastCheckedAt survived idle worker restart with no repeated update. Browser check_now shares that daily budget; the S12 coalescence correction is tracked above.
- Separate disposable engine root/management DB in the exact worker image prepared a real nightly candidate. Restarting its provider with a deliberately missing fixture FFmpeg dependency produced validation_failed/dependency_failed, cleared the candidate, and preserved active executable hash, manifest bytes, and next lease version. No live binary was damaged. Disposable container/root removed.
- Matching backup stopped only test writers and captured management DB+key, gonic data/playlists/podcasts, engine-data, and corresponding test music together. Fresh project-scoped volumes/root restored DB integrity, exact job/item/event/link/engine projections, key hash, and music hashes. Same opaque song ID and stream206/4096 bytes, all healthy/ready200.
- Restore experiment containers/volumes/network/image aliases/workdir/music/snapshots removed; residual restore resources0, existing baseline unchanged. This proves matching snapshot restoration, not arbitrary historical schema rollback.

## UI coverage

S10 header correction has no view/layout/copy change. S12 acknowledgement correction reuses the approved Action/StatusSurface and existing state presentation; no shared-new component or Gallery change. Prior S10–12 full reviews have FATAL0/MAJOR0/debt0. S12 correction is MICRO: existing state presentation, hierarchy, layout, copy, and components unchanged. Sanity review found no style/copy/accessibility changes; actual acknowledgement/recovery interactions were exercised in Chrome. No new full visual review is claimed.

User confirmed `phase 3 device done` for iPhone12Pro Safari KO/EN and Musiclatte after finding the named playlist. Native playlist readback retained the same two published file entries in original order. The extra requested reversal was not observed and is not claimed; it is not required by S14's original native read/stream/playlist compatibility acceptance.

All test-server resources and the agent-owned local web tunnel/tab are now removed. The user's existing administrator SSH shell/tab and phone profile were left under user control; their backend test account and server no longer exist. No new source changes or additional full-suite run were needed for this device/cleanup-only continuation.

## Rulebook postflight

Applied runtime alignment rule: `typescript-align-local-node-contracts-with-the-deployment-image-001` (local and imageNode24.20.0).
S14-B01/B02 exact searches returned no duplicate. Both outcomes: skipped, recurrence low for these specific optional-field/header fixes; debugging low, token cost high due actual integration setup; eligibility not met. Canonical write/research/sync not applicable. S14-B03 exact search also returned no duplicate; skipped because the specific acknowledgement predicate has low recurrence and low debugging cost (high integration-workflow token cost does not meet recurrence eligibility). All three fixes have focused/integration verification, no private data in candidate queries, no canonical write, and no central sync.

## Live results before teardown

- Actual final state:52 ready,52 DownloadEvents,52 available links with distinct gonic IDs. Historical terminal items remain: two failed (deliberate process abort and one external download failure), one cancelled, four duplicates. Both failed items have successful failed-only retry children; they are not silently rewritten as successful parents. Unacknowledged staging attempts0.
- First recent page50→load more51 preserved selection1. Selected the first row and last row across the page boundary→new playlist with2 entries. Read-only gonic playlist projection matched the expected distinct published file keys in order (positions1 and51 in the later52-event descending snapshot). These links already resolve to distinct gonic IDs. A scan-account REST attempt to read another owner's private playlist was denied and was not used as order evidence.
- A new successful retry arrived while the old recent snapshot was open; it stayed51. Reopening recent showed50→load more52, no old-snapshot insertion. The new playlist played with position100→189 and continued into its next track. Playback paused at handoff.
- KO/EN check_now after S12 correction returned to the existing independently read restored status, same lastCheckedAt/active version, button enabled, error0 beyond the old30s timeout. No new-version completion was claimed.
- Exact deployment source comparison:263 app/package/deployment/runtime files, mismatch0 before the final repeated-restore predicate; final two owner files then copied and web rebuilt. All test services healthy, existing normalized service baseline unchanged. Temporary crash hooks, response-loss proxy, empty-gonic fixture, engine-failure fixture, and matching-restore resources removed.
- The device LAN profile was held until the user changed the isolated administrator password. After the old credential was rejected, the profile was activated for device verification and removed during final cleanup. No production DNS change was made.
- Main S13 test stack, its52 legal sample copies and history, two test playlists, private account/policy, direct loopback tunnel, and main Chrome tab are intentionally retained until device verification. These resources were subsequently removed in the completion audit below.

## Final gate results

Local cwd: project root; Node24.20.0/npm11.19.0. `npm run test:unit`:574 tests/42 files, exit0. `npm run test:contract`:131 tests/20 files, exit0. `npm run typecheck` and `npm run build`:exit0. `npm run format:check` and `git diff --check`: exit0.

BRANCH_SETUP, owner RED/GREEN, refactor (only predicate simplification), API compatibility, MICRO sanity, actual Chrome interactions, KO/EN parity, DOC_SYNC and Rulebook postflight completed. MANUAL_UI_TEST completed from the user response, and owned-server cleanup completed from the audit below. GATE_CHECK and Phase3 acceptance are complete with the explicitly stated evidence limits. All isolated owner worktrees have been removed after byte-for-byte patch transfer checks; source changes remain reviewable in the main S14 worktree. No project or Rulebook commit/push.

Final Chrome repeated restore on the final build: independently observed active/previous/check time unchanged, restored status retained, error0 and restore button enabled beyond the former30s timeout. The handoff tab was subsequently closed during final cleanup.

## Device handoff activated — 2026-09-07

User confirmed the isolated administrator password change. A read-only probe rejected the former default credential with the expected authentication error. Activated only the existing test project's prepared LAN-development overlay after confirming its port was free; Compose config/start exit0. The workstation reached the device web entry and API readiness with HTTP200; authenticated standard REST ping also passed through that LAN entry. The previous existing-service baseline stayed unchanged and52 ready items were retained.

The device endpoint was held in the private environment file, which was removed during cleanup. Safari and native Musiclatte use the dedicated web account already used for imports, not the scan account. Retained a private two-entry playlist reference for checking a native order change after device feedback. User-only checklist: Safari KO/EN input/job/recent/selection/playlist/playback with keyboard overlap checks; native separate profile, same test playlist and streaming, then move the first entry to last so Codex can compare actual published-file order without asking the user to inspect opaque IDs. The user subsequently supplied `phase 3 device done`; stack/port/media cleanup completed afterward; no project commit/push or central Rulebook write/sync.

## Completion audit

- User evidence: `아 찾았다 phase 3 device done`. This confirms the handed-off Safari KO/EN keyboard/touch/import/recent/playlist/playback and native test-profile song/playlist playback checks. It is user-reported physical-device evidence, not an automated device recording.
- Before teardown, the two-entry native playlist matched the private pre-device reference exactly. The suggested native reorder was not observed; no reverse-order success is reported. Cross-page web playlist order and unique registered links were already independently verified.
- Revalidated the exact S13/S14 root and Compose ownership against the existing-service baseline. Four-file Compose `down --volumes --remove-orphans`:exit0. Removed6 test containers,8 project volumes,1 project network,3 owned API/worker/web image tags, and the private source/config/credential/backup/history/media root. Project containers/volumes/networks remaining0; remote test listeners closed. The52 sample copies and any device-added test data were in that removed root/volumes.
- Existing container IDs, image IDs, start times, ports and normalized mounts remained identical after cleanup; original music root remains present. Existing gonic/native/bot services were not restarted or replaced. Agent-owned local web SSH tunnel terminated and task-created Chrome tab closed. User-owned administrator SSH shell/tab and phone-side profile were preserved; they are not counted as agent-owned resources.
- Owner worktrees had already been removed after verified patch transfer. Main S14 worktree retains the three source fixes and sanitized evidence for review. Vault Step14/overview/Phase3 AC statuses synchronized to complete. No project commit/push.
- Final inherited source gate: unit574/42files, contract131/20files, typecheck/build exit0 under Node24.20.0/npm11.19.0. Documentation-only completion is followed by format/format-check/diff-check. Localization409 KO/EN keys, missing/empty/placeholder mismatches0; Gallery unchanged, review debt0.
- Completion postflight: skipped(no_new_lesson), no new candidate/fix in this device/cleanup turn. Earlier candidate outcomes remain recorded above. Central YAML write/sync not applicable.

Coverage limits: deterministic owner tests cover distinct-source mixed-success jobs, channel rename/long-title/path/security boundaries and detailed race permutations; the live import fixture used one approved source across separate roots. Matching snapshot restore does not claim arbitrary historical schema rollback. Physical-device flows are attested by the user. These distinctions are preserved in the acceptance evidence.
