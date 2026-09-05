# S07 — 음악 조회 API 검증

2026-09-05, branch `yellowgg2/tdd/phase-1/step-07-library-api`.
실행 cwd는 `/Users/incredibleyoung/Documents/code/musiclatte-server`이며 session-local
Node v24.20.0/npm 11.19.0을 사용했다. host global runtime은 변경하지 않았다.

## 결과

| Gate                               | 결과                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| BRANCH_SETUP / PROJECT_DOC_CONTEXT | clean main에서 Step branch 생성, Step/overview/Phase/route contract 확인                                                     |
| RED                                | 신규 unit 36개 중 35개가 미구현 route의 404 assertion으로 실패, contract 2개 동일 실패; 기존 catch-all 404에 맞는 1개만 통과 |
| GREEN                              | 신규 unit 36개·contract 9개 통과; 이후 전체 suite에서도 통과                                                                 |
| REFACTOR                           | 추가 production 추상화 불필요; shared HTTP fixture의 library 처리 범위를 명시적 endpoint로 한정하고 readiness 회귀 검증      |
| LOCALIZATION                       | KO/EN에 `error.upstream_incompatible` 한 키씩 추가; 기존 completeness/placeholder 검사 통과                                  |
| DOC_SYNC                           | Step·overview·Phase spec·route contract와 architecture 문서 동기화                                                           |
| GATE_CHECK                         | unit157 / contract85, typecheck/build/format-check 통과                                                                      |

`update_plan` tool은 이 세션에서 제공되지 않아 위 gate 표로 진행 상태를 추적했다.

제품 UI/rendering/interaction/layout 변경은 없고 신규 API 오류 번역만 준비했다.
UI class/action, Chrome Preview/UI_TEST/MANUAL_UI_TEST, Gallery/catalog 변경은 N/A다.
shared-new0, baseline 재승인 불필요, 새 review debt0, 사용자 확인 잔여0.
사용자가 count/offset 보존과 음악 조회 snapshot 예외를 명시적으로 승인했다.

## 명령과 evidence

모든 최종 명령은 exit0, test filter의 0개 실행 없음.

| Command                                                                                           | 결과                  |
| ------------------------------------------------------------------------------------------------- | --------------------- |
| `npm run test:unit -- apps/api/test/library-api.test.ts`                                          | 36개 pass             |
| `npm run test:unit -- apps/api/test/library-api.test.ts apps/api/test/auth-api.test.ts`           | 66개 pass             |
| `npm run test:unit -- apps/api/test/library-api.test.ts apps/api/test/deployment-runtime.test.ts` | 39개 pass             |
| `npm run test:contract -- tests/contract/library-api.test.ts`                                     | 9개 pass              |
| `npm run test:unit`                                                                               | 12 files / 157개 pass |
| `npm run test:contract`                                                                           | 8 files / 85개 pass   |
| `npm run typecheck`                                                                               | 전체 workspace pass   |
| `npm run build`                                                                                   | 전체 workspace pass   |
| `npm run format`, `npm run format:check`                                                          | repo 범위 pass        |
| `git diff --check`                                                                                | pass                  |

첫 전체 unit 실행에서 보조 HTTP 서버의 library 분기가 readiness용 ping 상태를 가리는 것을 발견했다.
fixture 분기를 명시적 music endpoint allowlist로 제한하고 기존 HTTP status 동작을 복원했다.
해당 focused39 및 최종 전체157로 수정 검증했다. production readiness 코드는 변경하지 않았다.

Fastify inject + 실제 synthetic gonic HTTP + 격리 SQLite로 인증/공유 library/루트와
인덱스/opaque ID/한글·특수문자 encoding/독립 count·offset/입력 거절/빈 결과/optional field/
권한·대상 없음·표준 오류·malformed payload·session 폐기를 검증했다.
실제 Fastify listen + fetch AbortController로 metadata 요청 도착 후 client disconnect를 발생시키고,
5초 upstream timeout보다 먼저 연결이 닫히며 session은 유효함을 검증했다. 포트0과 temp DB는 cleanup했다.

## 실제 gonic 읽기 전용 parity

SSH로 Linux runtime, 사용 중 listener, 기존 container를 먼저 확인했다. 기존 demo gonic v0.22.0,
포트4747에 session 전용 loopback SSH tunnel을 연결했다. remote Node v22.23.2는 사용/변경하지 않았고,
local compiled API와 Node24.20.0에서 별도 관리 DB·key를 사용했다.

61개 assertion 통과:

- session 로그인, root folder·musicFolderId index·최대12개씩의 제한된 directory 읽기.
- 한글·특수문자 metadata 존재 확인과 decoded upstream/BFF 구조 동등성.
- 한글·특수문자·영문 검색, song offset0/2의 독립 count/offset 응답 동등성.
- 검색 결과 artist/album 상세 동등성.
- random size2의 곡 목록과 존재하지 않는 합성 genre의 성공 빈 목록.

random 두 호출의 동일 곡/순서는 요구하지 않았다. 실제 음악 metadata·ID·인증값·query는
출력/fixture/이 문서에 복사하지 않았고 assertion 결과와 boolean만 남겼다.
scan·파일 CRUD·playlist·stream/playback·기존 서비스/설정/volume 변경은 없었다.
local API/DB/key 및 tunnel을 정리했고 임시 parity script도 삭제했다.

기존 iOS/bot/gonic tree, `/rest`와 배포 구성을 변경하지 않았다. 음악 화면·페이지 race는 S08,
media는 S09, 실제 playback·iPhone은 S10 소유이며 전체 제품 AC를 완료로 표시하지 않는다.
프로젝트 commit/push/운영 배포는 하지 않았다.
