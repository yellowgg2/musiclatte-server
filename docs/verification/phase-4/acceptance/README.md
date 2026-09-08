# Phase 4 acceptance

2026-09-08. Browser acceptance completed for the conditions below; device/user acceptance remains pending.

## Identity and coverage

Production source: `f831c3763ba7f88cbf19858e0c323030360cac41`, clean at entry. No production code changed in this pass. Existing S11 source baseline `S11-source-194b6e82a9a4a4ec` and its unit664/contract153/typecheck/build evidence remain applicable. New documentation is outside that source identity.

Spec AC01–08/11 retain the existing implementation/runtime evidence. AC09/10 remain open. P4-UA-001/002/007/009 retain their prior passed evidence; P4-UA-003/004/005/006/008 remain pending and P4-UA-010 remains stale until its complete affected-consumer matrix runs. S09/S10 and the approved Gallery baseline are preserved. No global component semantics or cross-Phase implementation changed.

## Executed ordinary UI inspection

Connected Chrome, synthetic source-only `metadata-ui-harness.ts --scenario recovery:long --port 18511`, Node24.20.0. Existing local fixture session was accepted by the harness. Screenshots and accessibility trees were returned in the acceptance conversation; no real-library content was used.

- `/metadata-jobs/recovery-long`: normal desktop screenshot, long-title and 60-line lyric restore comparison. Named comparison region has initial focus; title/current/original fields, whole-file warning and separate cancel/restore footer are present. The content scrolls independently from the footer. This reuses P4-UA-002 evidence and is not a fresh full-matrix pass.
- `/__dev/gallery`: actual KO Gallery rendered with existing foundation, actions and named fields. Its prior user approval is unchanged. No new Gallery component is required.
- `/music/folders/folder?musicFolderId=music`: desktop and 390×844 KO screenshots. Long title remains in its row; mobile metadata action is right aligned. Opening the second song metadata disclosure shows its edit action within the viewport.
- `/playlists/duplicates`: 390×844 KO ordinary screenshot with A/B/A occurrences and right-aligned metadata actions. Recent downloads, EN, selection/error and the complete affected-consumer matrix are not yet covered; P4-UA-010 stays stale.

No new reproducible FATAL/MAJOR issue was observed in this limited pass. This is not `UI_BASELINE: PASS` or approval of unexecuted accessibility/device conditions.

## Sequencing and remaining work

The user was shown the restore screen and existing Gallery, then asked for design feedback. P4-UA-011 owns that response; no response is inferred from elapsed time. The skill requires ordinary design feedback before the expensive final matrix. Actual 200% zoom, reduced-motion and detailed accessible-state checks have not run in this pass. Native Chrome tab selection and its zoom menu now respond, so the earlier native-control limitation is not assumed to remain a blocker. Actual zoom and browser-version evidence still need collection.

The current harness does not advertise recent downloads; a suitable synthetic recent/favorite/error fixture is needed to finish P4-UA-010. Do not mark unavailable routes passed. Final matrix should retain KO/EN, relevant desktop/mobile sizes, actual browser zoom distinct from 320 CSS px reflow, keyboard focus/semantics and reduced-motion. Final screen-reader/device procedures follow stabilization of the UI.

Read-only `ssh devserver` inspection confirmed the existing gonic-demo on port4747 and host Node22.23.2. No remote changes were made. The former S11 stack is absent; native/Safari edit/restore/changed-cover checks require a fresh isolated real runtime. The localhost synthetic harness cannot prove those results.

## Handoff and resources

Local harness18511 is retained only for design feedback, exec session9282. Owned restore and Gallery tabs are retained for that feedback; the temporary row tab is closed. The temporary viewport override is reset. Existing user tabs/services/media are untouched. After feedback, resume the pending matrix and prepare the isolated device fixture; clean the owned harness/tabs after observation. No commit/push.

## Design response and final browser pass

The user supplied the restore screenshot and, after clarification of its purpose, said “아 그렇다면 잘보이는것 같아”. P4-UA-011 is passed for the restore comparison design only. This does not approve unexecuted device checks or reapprove the unchanged Gallery.

Chrome installed version **152.0.7977.83**, read from the running app installation Info.plist. Source baseline is f831c376 plus the MetadataAction change below; SHA-256 of the final MetadataAction.tsx: `13fb8b5f238e835034e5d0037f4eab21cd7ac46ed260912b650c5690403eac44`. No commit was created.

### P4-UA-003 — passed

Actual Chrome native zoom menu was used, with toolbar accessibility explicitly reporting **200%**. The real 1800×952 content area became 900×476 CSS px, devicePixelRatio4; document scrollWidth900. This was browser zoom, not a viewport substitute.

KO and EN `/metadata-jobs/recovery-long` screenshots retained the named comparison region, heading, warning and cancel/restore footer. EN pointer scrolling reached the original final lyric with the footer separate; region height278, scrollHeight2583 and final scrollTop2305.25. Tab from the restore action wrapped to the named region; Escape closed the dialog and restored focus to Review original restore in both locales. End did not move the region through this tool path, so End is not counted as fresh keyboard-scrolling evidence. Prior P4-UA-002 keyboard scrolling evidence is preserved. The native menu was used to restore100%; the zoom toolbar indicator disappeared.

### P4-UA-004 — passed for automated scope

A focused pairwise matrix covered EN recovery dialog and KO expanded player under actual DevTools `Emulate CSS prefers-reduced-motion: reduce`. Computed `--motion-response` changed140ms→0ms; EN dialog buttons had transitionDuration0s. The dialog remained aria-modal=true with the named region focused, full action labels, Tab wrapping and Escape/focus return. EN390 screenshot and DOM width390 showed no horizontal overflow.

KO player opened during actual synthetic audio playback with a named playback-position slider, explicit play/pause/next/repeat/queue controls, and its close button initially focused. The slider received ArrowRight input and the player continued to show an advancing value. Expanded-player close and navigation back to history preserved the active mini-player. No actual VoiceOver reading or physical touch result is claimed. Approved unchanged token-contrast evidence and current locale/consumer tests are reused. DevTools docked screenshot scaling was unsuitable for a player visual conclusion; the real accessible interaction and computed motion condition are the evidence for that surface. EN dialog screenshot is the visual motion-layout evidence. Closing owned DevTools restored the computed motion token to140ms. Temporary device toolbar and viewport overrides were reset.

### P4-UA-010 — passed after a reproduced fix

A temporary loopback harness18512 wrapped the existing recovery:long fixture with authenticated `library.recentDownloads` and `favorites.songs` capability responses. Recent ready entries reused the actual synthetic A/B/C song DTOs and recent response schema. Favorite writes intentionally returned503. No real metadata was involved. Wrapper source is retained privately at `/tmp/musiclatte-p4-acceptance/rows.mts` during handoff; the production exclusion boundary is unchanged.

Observed MAJOR/NAV-004: opening a row menu then entering selection mode left the menu covering the fixed selection actions at320px. The regression test failed RED with aria-expanded still true. MetadataAction now dismisses on outside activation and local Escape; Escape restores trigger focus. Clicks inside its editor dialog preserve that dialog and its focus-return target. No CSS, token, copy, restore design or Gallery semantics changed.

GREEN browser checks: recent EN320 and folder EN390 menu→selection set every row menu aria-expanded=false and preserved the selection bar; document width equaled viewport width. Playlist EN390 and KO320 repeated that transition with the A/B/A order intact. Recent KO320 expanded menu stayed within the viewport; EN320 selected-state labels/count and cancel remained visible. Folder EN390503 feedback wrapped within its row, explicitly restored prior favorite state and exposed a working retry. Recent EN1800×863 and playlist KO1800×863 ordinary screenshots retained the row columns and actions. Prior KO folder390 and playlist390 ordinary inspection plus S11 favorites alignment evidence remain applicable. These are focused combinations, not a claim that every Cartesian combination was rerun.

MetadataAction consumers share the dismissal change; folder/recent/playlist were exercised and the existing favorites/single/bulk/recovery regressions cover its other entry paths. P4-UA-009's approved alignment/playback and P4-UA-001/002's unchanged recovery view remain valid. No cross-Phase global primitive or Gallery was changed.

## Verification after correction

- RED: new outside-dismiss regression failed as expected.
- GREEN: metadata-single-ui12 passed; affected unit60/7 files passed; metadata-ui contract7/1 file passed. No zero-test filters or skips counted.
- Typecheck initially caught an unsupported Testing Library `exact` option in the new assertion; it was removed. Final typecheck and build passed.
- Format applied; final format:check recorded at handoff. No backend/native implementation changed.

## Current user handoff (supersedes initial resources section)

P4-UA-005/006/008 remain pending: actual iPhone keyboard/touch/motion experience, Safari playback during desktop edit/restore, and Musiclatte changed-cover/search refresh with the warmed gonic-cache limitation. P4-UA-012 separately owns real screen-reader reading/operation; automated DOM evidence does not pass it.

A new private devserver project `musiclatte-p4-acceptance` was built from f831c376 plus the exact MetadataAction file. Remote directory `/tmp/musiclatte-p4-acceptance-20260908`; generated Acceptance Studio1/2 MP3s with lyrics and purple original/green replacement cover only. API/worker/web health passed, pinned gonic0.22.0. The existing gonic-demo4747 is untouched. Admin18513 and gateway18514 bind **loopback only**. An owned SSH tunnel forwards the same ports locally (exec58177). No LAN exposure or production deployment occurred.

Initial account password setup is the remaining actual prerequisite for the LAN device fixture. The browser's password-change form is open for user handoff. The proposed temporary password is stored only in a0600 local private file and a0600 remote candidate credential file, not in this evidence or Git. Browser policy requires the user to enter and submit a new credential. After the user confirms submission, verify the candidate works and the old credential fails, update the owned worker secret, then enable only the prepared isolated LAN testing profile. No password approval or submission is inferred.

The setup tab, remote stack and SSH tunnel remain specifically for this handoff. Local synthetic harnesses18511/18512 and their tabs are cleaned up. Temporary local private fixture/evidence/password files remain in the0700 handoff directory until user/device results are received, then remove only owned resources. No commit/push.

## 2026-09-08 password setup verified; Safari playback handoff

The user reported password setup complete. A real Subsonic probe accepted the candidate credential and rejected the prior credential. The owned worker secret was updated and that worker recreated; no credential values were logged or added to Git.

The existing LAN-development overlay was enabled only for `musiclatte-p4-acceptance`: gateway `http://192.168.129.119:18517`, admin remains loopback18513. Authenticated session, API readiness, web entry and metadata capability passed; exactly two generated Acceptance Studio songs were indexed. Chrome on the workstation displayed the real LAN login page. No existing service was changed.

User P4-UA-006 first action: on the same LAN, iPhone12Pro Safari opens the gateway, signs in with the configured test account, searches `Acceptance Studio 1` and starts playback. User should report playback started before Codex changes title/cover. This is preparation, not a passed device result. After that report, change the synthetic song through the real API, observe continued Safari playback/seek and refresh, then restore and observe again. P4-UA-005/008/012 remain pending for the separately documented keyboard/native cover/VoiceOver flows.

The completed password tab and owned SSH tunnel58177 were closed. The LAN login tab and isolated remote stack remain for device observation. Private test password/candidate and owned synthetic files remain only until final cleanup. No commit/push.

## Safari playback/title observation in progress

The user reported “재생 중” after the iPhone Safari entry instructions. This confirms initial playback only. Codex submitted one revision-fenced title edit for generated `Acceptance Studio 1`, changing it to `Acceptance Studio 1 — Safari 확인`; the operation and original file digest are retained privately in the owned test directory for idempotency and later restore.

File snapshot and actual gonic getSong title match the new title. The job remains `reflecting` with `reflection_mismatch`; restore is available. No completed/fully-verified claim is made, and no cache was cleared. Continued playback/seek and refreshed Safari title observations remain pending. Do not restore before collecting the changed-state observation. Cover replacement has not yet run.

## Safari changed-state confirmed; original restoration observation pending

The user replied “어 둘다 잘되” to continued playback/seek and refreshed changed-title checks. Record both as actual Safari changed-state observations within P4-UA-006 only.

Codex loaded a fresh restore preview/snapshot and submitted a revision-fenced original restore with a persisted operation identity. Original whole-file SHA-256 matches; actual gonic getSong title returned to `Acceptance Studio 1`. The durable restore job remains `reflecting` / `reflection_mismatch`; this is not a full library-verification success. Neither cache nor existing music was modified to mask that state.

Next user observations: refresh Safari and play/seek the restored original; then open Music information → Edit music information → Lyrics body, bring up the software keyboard, enter a temporary character and scroll to the final field and Review changes/Cancel controls. Check visibility and touch access, then cancel without saving. No result is inferred until reported. Changed-cover observation and real screen-reader operation remain separate pending items. Owned test stack remains for these checks.

## Safari restoration and keyboard confirmed; extra lyrics save recovered

The user reported “1. 잘됨 / 2. 잘됨. 저장까지 했어 ㅠㅠ”. This confirms original-title refresh and playback/seek after restoration (P4-UA-006 title cycle), and access to the last field and lower actions with the actual software keyboard (P4-UA-005 keyboard scope). The user also saved the temporary lyrics. Cancellation was not performed and is not counted.

The actual job list identified one new edit on the same generated song with changedFields=[lyrics]. Codex used a fresh preview/revision to restore it, persisting operation identity privately in keyboard-restore.json. Whole-file SHA-256 equals the initial original digest. Latest restore status is reflecting, not a fully verified library success. Earlier title edit/restore jobs were observed failed/conflict after subsequent editing; this does not change the independently checked file restoration but remains a durable-state limitation. No existing music or cache was modified.

Recovery touch/motion, changed-cover Safari/native observation and real VoiceOver remain pending (005/006/008/012). Owned isolated LAN stack and private fixture remain handed off for these device checks. No commit/push.

### 2026-09-08 원본 커버 확인·교체 관찰 대기

사용자 “어 잘보여”로 Musiclatte 앱의 보라색 원본 커버 확인(P4-UA-008 baseline). 동일 synthetic 곡의 Front 커버를 revision-fenced API로 초록 PNG로 교체했고 실제 MP3에 replacement PNG bytes가 포함됨을 확인했다. job reflecting, native/Safari 갱신은 아직 관찰하지 않아 006/008 pending 유지. private cover-check.json에 재개 identity 보존. cache 삭제 없이 검색 재진입/화면 새로고침 결과를 수신한 다음 원본 복원한다. 소유 LAN 테스트 stack은 기기 검수용으로 유지한다.

### 2026-09-08 native changed-cover partial refresh failure

User screenshot after search re-entry shows edited Acceptance Studio 1 still purple, unchanged Studio 2 purple, album green. P4-UA-008 failed for changed song-cover refresh; do not count album success as song success. Authenticated direct gateway Subsonic getSong/getAlbum/getCoverArt probe confirms different song/album coverArt IDs and returned PNG first pixels: song RGB(105,80,139), album RGB(36,123,88). The stale song image is served by the backend, so this is not solely inferred native app caching. This is consistent with the existing gonic warmed-cover limitation; no cache was cleared and no workaround is claimed. Actual Safari observation remains pending before original restore. Private response bytes and operation identity remain in the owned test directory; no private IDs/auth URLs logged. Owned LAN stack retained for remaining observation.

### 2026-09-08 Safari 커버 갱신 실패 확인·원본 파일 복구

사용자 Safari screenshot에서도 Acceptance Studio 1 곡 커버가 보라색으로 남아 있다. 앨범 행은 일반 아이콘이므로 앨범 이미지 색상은 판정하지 않는다. P4-UA-006 changed-cover 갱신 실패, P4-UA-008 native 실패와 같은 서버 응답 문제로 관찰된다. 앞선 직접 API에서 곡 커버 보라색/앨범 초록색이 확인되었으므로 사용자에게 반복 새로고침이나 앱 캐시 삭제를 요구하지 않는다.

실제 fresh restore preview/revision으로 cover 변경을 되돌렸다. 원본 전체 파일 SHA256 일치, 최신 restore job reflecting. 파일 복원과 라이브러리 전체 검증을 구분하며 UI 복원 결과는 추정하지 않는다. private cover-check.json에 요청 identity와 결과 보존. 커버 반영 문제 owner는 S05 gonic reflection/upstream compatibility이며 S11은 실패/한계 표시에 책임이 있다. 현 범위에서 기존 gonic/iOS tree를 수정하거나 검수를 통과로 바꾸지 않는다. 005 복원 touch/motion 및 012 실제 VoiceOver는 pending. acceptance_status pending 유지; 소유 테스트 stack은 남은 기기 검수용으로 인계 유지.

## Cover cache correction

See [cover-cache-fix.md](cover-cache-fix.md) for the user-requested fix, RED/GREEN and real warmed-cache edit/restore evidence. Backend correction verified; physical Safari/native006/008 revalidation remains stale. Independent Acceptance Cover Check is restored to purple and retained for device handoff.

### 2026-09-08 Safari 갱신 확인·native 제한 수용으로 종료

사용자는 Safari 커버 초록색 갱신을 확인했고, Musiclatte 앱은 보라색이 남는다고 보고했다. 서버 정상 응답과 Safari 갱신은 확인됐지만 앱의 어느 캐시 계층이 원인인지는 추가 조사하지 않았다. 사용자가 앱은 현재 수준에서 마무리하자고 명시하여 P4-UA-008은 failed + accepted_limitation으로 종료한다. 미갱신을 성공으로 바꾸지 않으며 추가 앱 수정/반복 검수는 현재 범위에서 제외한다.

검수용 독립 곡을 fresh preview/revision으로 복원했다. restore succeeded, 기존32/64/300/600 곡·앨범 응답 모두 원본 보라색, 전체 파일 SHA256 원본 일치. private cover-device-recheck.json에 사용자 결과와 복원 identity/result 보존. 006의 Safari 변경 하위 결과는 passed이며 복원 후 실제 화면은 미수신,005/012 접근성 관련 범위는 별도 pending이므로 전체 acceptance_status를 passed로 올리지 않는다. 소유 LAN stack은 남아 있는 웹/접근성 검수 인계용으로 유지하며 앱 커버 재검수를 요구하지 않는다. source 변경·commit/push 없음.

## Mobile heading focus correction

See [heading-focus-fix.md](heading-focus-fix.md). Scoped pointer/keyboard heading presentation corrected and isolated web bundle updated. Automatic checks passed; physical Safari confirmation is P4-UA-013 pending.

### 2026-09-08 복원 화면 터치·모션 사용자 확인

사용자 “조작은 편해 열고 닫는 움직임도 좋고”로 iPhone Safari 원본 복원 검토 화면의 터치 조작 및 열기/닫기 움직임을 확인했다. 기존 키보드/마지막 필드/하단 조작 확인과 합쳐 P4-UA-005 passed. VoiceOver012 및006 복원 후 화면 관찰은 별도 pending. 008 앱 커버는 accepted_limitation 종료,013 제목 테두리는 passed 유지. 전체 acceptance_status pending. 코드 변경·commit/push 없음. 소유 격리 LAN stack은 남은 웹/접근성 검수용으로 유지한다.

### 2026-09-08 VoiceOver 사용자 확인

사용자 “VoiceOver 정상”으로 직전 요청한 실제 복원 검토 화면 읽기·조작과 취소 후 초점 복귀를 확인했다. P4-UA-012 passed. 접근성005/012 및 제목 포커스013 확인 완료. 008 앱 커버는 사용자 accepted_limitation 종료 유지. 006의 커버 복원 후 실제 Safari 화면 관찰은 미수신이라 전체 acceptance_status pending을 유지한다. 코드 변경·commit/push 없음. 소유 LAN stack은 마지막 Safari 관찰을 위해 유지한다.

## Final acceptance closure - 2026-09-08

The user confirmed the restored purple cover in Safari. P4-UA-006 passed. Final count: 12 passed, 1 observed failure (008) closed as an explicitly user-accepted limitation. Zero outstanding required checks. acceptance_status passed applies to that agreed scope, not to native cover refresh success. Actual VoiceOver012, restoration touch/motion005 and Safari heading013 confirmations are complete. Gallery unchanged.

Cleanup completed: owned Compose project musiclatte-p4-acceptance down --volumes --remove-orphans exit0; zero owned containers/volumes; five owned test image tags removed. The owned remote /tmp/musiclatte-p4-acceptance-20260908 directory, including synthetic music, test credentials and private logs, was removed. Existing gonic-demo remains running. Latest Chrome inventory contains no owned test tabs; the user's tab is preserved. Local owned private fixture directory removed. LAN18517 is now stopped; this was not a production deployment. Source changes and public verification evidence remain in the workspace, with no commit/push.
