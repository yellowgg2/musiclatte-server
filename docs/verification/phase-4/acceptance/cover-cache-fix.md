# Cover cache correction — 2026-09-08

User requested fixing the observed native/Safari stale cover before continuing acceptance.
Baseline HEAD f831c3763ba7f88cbf19858e0c323030360cac41 plus existing uncommitted MetadataAction
acceptance correction, preserved. No commit/push. No gonic/iOS/bot source tree changes.

## Implementation and boundary

Metadata worker invalidates exact related tr-/al- cover filenames only after full scan, same
track identity, reference checks, current saved digest and owned lease. Normal-size decoded
cover verification remains mandatory. The optional cache directory is canonical, writable,
disjoint from data roots and inode/device fenced. Unknown IDs or matching symlinks/directories
fail closed; unrelated track images, unknown suffixes and audio survive. LRU ENOENT is tolerated.

Compose supplies a separate cover-only volume to pinned gonic0.22.0 and the worker. API has no
cache mount; gonic DB/audio cache and existing demo4747 remain untouched. Initializer enforces
matching UID/GID and preserves nonempty ownership. Docker23.0.2/Compose2.17.2 successfully started
this overlay. It avoids unsupported volume-subpath configuration. Native protocol IDs and HTTP
headers are unchanged, so a client's own cached images still need physical revalidation.

## Automated evidence

Local cwd: /Users/incredibleyoung/Documents/code/musiclatte-server. Session-local Node24.20.0,
npm11.19.0, pinned Vitest5.0.0. All commands use the prescribed PATH.

- RED: reflection refreshed-cover stayed reflecting; cache-failure incorrectly succeeded.
  New filesystem adapter existence/safety suite also failed before implementation.
- GREEN: `npm run test:unit -- apps/api/test/metadata-reflection.test.ts apps/api/test/metadata-cover-cache.test.ts apps/api/test/metadata-runtime.test.ts apps/api/test/gonic-registration.test.ts apps/api/test/import-worker.test.ts` — 90 tests,5 files passed,exit0.
  Includes lease loss during async snapshot, stale file/identity, safe targeted eviction,
  repeated edit/restore eviction, unrelated image/audio retention and root/symlink rejection.
- `npm run test:contract -- tests/contract/metadata-deployment.test.ts tests/contract/subsonic-parity.test.ts tests/contract/playlist-api.test.ts tests/contract/favorites-api.test.ts` — 48 tests,4 files passed,exit0.
- `npm run typecheck`, `npm run build` passed after final code changes. Format applied before
  verification; final format:check is recorded at handoff. No whole-repo test sweep claimed.

## Actual isolated runtime

Final worker image sha256:487925df182f9ce9c6feb1bf12cc0e189f524510be433595eeef26b23946c843.
Owned LAN gateway remains http://192.168.129.119:18517. Only generated fixtures were changed.

Initial fixture diagnosis corrected two test-data errors: replacement-cover.png inside the
music directory was eligible as an external album cover, and the original v2.3 MP3 incorrectly
contained the v2.4 TDRC frame. Thus the earlier green album screenshot alone did not prove the
edited embedded cover had propagated. The stale song response was independently real. The
PNG was moved to the private directory. Original user-observed files were restored to exact
original bytes; correcting them in place triggered the expected external-change recovery fence,
so that attempted test was not counted as a pass and its ledger was not bypassed or deleted.

Final independent `Acceptance Cover Check` fixture uses a proper TYER frame in v2.3, a separate
subfolder, purple embedded cover and no external cover file. The private operation identities
and observations are in cover-fix-isolated.json, not Git. Actual sequence:

| Observation                                               | Result                                                 |
| --------------------------------------------------------- | ------------------------------------------------------ |
| Warm song and album at32/64/300/600 before edit           | Every response purple RGB105,80,139                    |
| Real revision-fenced cover edit                           | succeeded; every same-size response green RGB36,123,88 |
| BFF actual coverGeneration URL + future If-Modified-Since | 200, private/no-store, green pixels                    |
| Changed raw stream bytes10000–10031                       | 206,32 bytes, Content-Range present                    |
| Old/current track ID                                      | Equal                                                  |
| Fresh preview + revision-fenced original restore          | succeeded; all8 responses purple                       |
| Restored full MP3 SHA256                                  | Exact baseline match                                   |
| Restored BFF coverGeneration URL                          | 200, private/no-store, purple; same track ID           |

Both cover jobs reached fully verified success on the final fixture. Earlier malformed-fixture
jobs and recovery states remain evidence, not erased or reclassified as successful.

## Gates and handoff

Branch setup skipped: this was an ad-hoc bug-fix request, not an explicitly selected Step
implementation; existing dirty acceptance work was retained. S05/overview read and synchronized.
Serena initialized. Rulebook project lookup found no directly applicable new safeguard beyond
existing toolchain instructions; postflight skipped(no_new_lesson): upstream cache behavior was
already known/documented and fixture setup mistakes are one-off, low-cost corrections. No
central YAML write/sync, no project lesson file. New UI/copy/Gallery/localization not applicable.
Backend integration and rendered real Compose verification own this correction.

P4-UA-006/008 are stale pending actual user revalidation of the changed server; prior failure
screenshots remain historical evidence. P4-UA-005 touch/motion and012 VoiceOver remain pending.
The test stack, synthetic fixtures and private credentials are retained specifically for device
handoff. Acceptance Cover Check is restored to purple for initial app/Safari cache warming.
No new browser tabs/local servers remain from this fix. Existing user services are preserved.

## Source identity

- `apps/api/src/metadata/gonic-cover-cache.ts`: `f7f734c5734dd43c3c2124da0500eec3801f3741e3a6b9e7d11cde7db48d1f75`
- `apps/api/src/metadata/reflection.ts`: `c28d642c1d5f33df3ce4d49242f57e55ebe8ff57cca673ecbb792553705d52b7`
- `apps/api/src/metadata-worker-runtime.ts`: `461a39375f21377c09946cc24bd45be5ff48fdaa38fb3ca614cbbe3cc65d2a65`
- `apps/api/src/metadata/runtime-config.ts`: `a639643c12ce8f100976325c09461e01038abe63c12a38786855527d34d3c7c6`
- `deploy/compose.metadata.yaml`: `feacedc7d249c2fdd2d3bfa75b52cc2291025af6ca2c36683da7ac6b8ddf4119`
- `deploy/initialize-metadata-volumes.sh`: `ce9c7602d928592b584b43507df95e29443bdca9cc7df9614031911162b662f1`

### 2026-09-08 수정 후 실제 기기 커버 재검수 시작

사용자 “어 모두 보라색이 보여”로 Musiclatte 앱과 Safari의 `Acceptance Cover Check` 원본 커버를 확인했다. 이는 수정 후 원본 baseline만 확인한 결과다. 같은 곡에 새 revision-fenced 커버 변경을 수행했고 job succeeded, 기존32/64/300/600 크기의 곡·앨범 응답 모두 초록RGB36,123,88로 확인했다. 사용자 변경 상태 관찰 전에는 복원하지 않는다. 006/008 수정 후 재검수는 계속 stale이며 passed로 변경하지 않는다. private cover-device-recheck.json에 요청 identity와 원본 hash를 보존했다. 소유 LAN18517 stack은 앱 검색 재진입·Safari 새로고침 관찰을 위해 유지한다.

### 2026-09-08 Safari 갱신 확인·native 제한 수용으로 종료

사용자는 Safari 커버 초록색 갱신을 확인했고, Musiclatte 앱은 보라색이 남는다고 보고했다. 서버 정상 응답과 Safari 갱신은 확인됐지만 앱의 어느 캐시 계층이 원인인지는 추가 조사하지 않았다. 사용자가 앱은 현재 수준에서 마무리하자고 명시하여 P4-UA-008은 failed + accepted_limitation으로 종료한다. 미갱신을 성공으로 바꾸지 않으며 추가 앱 수정/반복 검수는 현재 범위에서 제외한다.

검수용 독립 곡을 fresh preview/revision으로 복원했다. restore succeeded, 기존32/64/300/600 곡·앨범 응답 모두 원본 보라색, 전체 파일 SHA256 원본 일치. private cover-device-recheck.json에 사용자 결과와 복원 identity/result 보존. 006의 Safari 변경 하위 결과는 passed이며 복원 후 실제 화면은 미수신,005/012 접근성 관련 범위는 별도 pending이므로 전체 acceptance_status를 passed로 올리지 않는다. 소유 LAN stack은 남아 있는 웹/접근성 검수 인계용으로 유지하며 앱 커버 재검수를 요구하지 않는다. source 변경·commit/push 없음.

## Final acceptance closure - 2026-09-08

The user confirmed the restored purple cover in Safari. P4-UA-006 passed. Final count: 12 passed, 1 observed failure (008) closed as an explicitly user-accepted limitation. Zero outstanding required checks. acceptance_status passed applies to that agreed scope, not to native cover refresh success. Actual VoiceOver012, restoration touch/motion005 and Safari heading013 confirmations are complete. Gallery unchanged.

Cleanup completed: owned Compose project musiclatte-p4-acceptance down --volumes --remove-orphans exit0; zero owned containers/volumes; five owned test image tags removed. The owned remote /tmp/musiclatte-p4-acceptance-20260908 directory, including synthetic music, test credentials and private logs, was removed. Existing gonic-demo remains running. Latest Chrome inventory contains no owned test tabs; the user's tab is preserved. Local owned private fixture directory removed. LAN18517 is now stopped; this was not a production deployment. Source changes and public verification evidence remain in the workspace, with no commit/push.
