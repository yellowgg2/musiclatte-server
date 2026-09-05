# S03 인증·capability 검증 — 2026-09-05

- cwd: `/Users/incredibleyoung/Documents/code/musiclatte-server`
- branch: `yellowgg2/tdd/phase-1/step-03-auth-capabilities` (clean main에서 생성)
- runtime: Node 24.20.0 / npm 11.19.0, session-local toolchain PATH; host global 변경 없음
- UI 변경 없음: UI class/action, Chrome, Gallery/component 분류는 N/A, review debt 0. 새 승인/수동 확인 없음.

## RED → GREEN

| 단계/명령 | test 수/exit |
|---|---|
| RED `npm run test:unit -- apps/api/test/auth-api.test.ts` | 28 assertion failures / 1; HTTP route 미구현 |
| RED `npm run test:contract -- tests/contract/capabilities.test.ts` | 26 assertion failures / 1; route/decoder 미구현 |
| RED `npm run typecheck`, `npm run build` | 각각 0; collection/type/build 오류 없는 RED |
| runtime RED `npm run test:unit -- apps/api/test/auth-runtime.test.ts` | 13 assertion failures / 1; configured runtime 부재 |
| 추가 RED, 같은 auth-api/capabilities filter | cookie 삭제 1 failed+29 pass, known support 보존 1 failed+26 pass / 각 1 |
| GREEN `npm run test:unit -- apps/api/test/auth-api.test.ts apps/api/test/auth-runtime.test.ts` | 43 pass / 0 |
| GREEN `npm run test:contract -- tests/contract/capabilities.test.ts` | 27 pass / 0 |
| 최종 `npm run typecheck` | 0 |
| 최종 `npm run build` | 0 |
| 전체 `npm run test:unit` | 8 files / 98 pass / 0 |
| 전체 `npm run test:contract` | 3 files / 61 pass / 0 |
| `git diff --check` | 0 |

후속 타입 정리와 request logging 중복 옵션 제거 후 최종 typecheck/build 및 전체 suite를 통과했다. 별도 행동 보존 refactor는 필요하지 않아 skip했다. `tests/unit/workspace.test.ts`의 KO/EN key·빈 문자열·placeholder 검사를 포함하며 새 UI 문자열/locale key는 0개다. dependency 설치·lockfile·storage migration 변경 없음.

## 자동 HTTP 검증

실제 임시 SQLite/key + loopback HTTP fake upstream + Fastify.inject를 사용했다. password/native proof 검증, MAC transport 분리, session 복구/회전/logout/절대 expiry/policy 폐기, upstream auth40/HTTP401/identity 변경, 41/50/5xx/redirect/timeout, credential 정제와 schema type/unknown key, Origin/JSON/custom header/CSRF를 포함한다. 관리자 role을 로그인 뒤 바꾸고 scan 직전 다시 읽는 순서, 기본 deny, upstream scan50, 탐지 중 mutation 0개를 확인했다.

Discovery fixture는 stock gonic/Airsonic 없음, unknown key, 부분 지원/denied, malformed/unsupported version, 외부 API base와 traversal, 404/410/401/403/503/timeout 의미를 검사한다. 실제 계정 전환에서는 이전 upstream identity를 거절하며 새 session revision은 분리된다. UI 늦은 응답 폐기는 미래 client owner 범위다.

## 실제 gonic + compiled process 검증

원격 환경을 먼저 확인했다: Linux, host Node 22.23.2, 기존 `gonic-demo`와 port 4747. 원격 host Node/서비스/설정/볼륨은 변경하지 않았다. 세션 전용 SSH loopback tunnel과 **로컬 Node 24.20.0 compiled API child process**를 OS 임시 관리 DB/key·별도 ephemeral port로 실행했다.

14개 assertion pass: 공개 discovery/보호 API, password login, session 조회, random와 false private 기능/default scan deny capability, API 프로세스 종료·재시작 후 instance와 cookie 복구, cookie logout/폐기, native proof 교환·bearer 조회·logout, 정제된 404 및 로그 redaction. 로그는 입력 credential/token/CSRF/query canary를 포함하지 않았다. 실제 username/proof/media/metadata는 문서·fixture·Git에 기록하지 않았다.

upstream 요청은 identity와 size=1 random 읽기뿐이며 scan/write/음악 CRUD는 실행하지 않았다. private session 생성/폐기만 이번 작업의 임시 DB에서 수행했다. 임시 child process·DB/key·스크립트·SSH tunnel을 정리했고 tunnel listener가 남지 않은 것을 확인했다. 기존 gonic은 보존했다. 이는 S04 gateway/Compose, 실제 native 앱, S09 media, S10 청취 검증을 대신하지 않는다.

## Gate 결과

BRANCH_SETUP, PROJECT_DOC_CONTEXT, LESSONS_CONTEXT, RED, GREEN, LOCALIZATION, DOC_SYNC, GATE_CHECK 완료. PROJECT_SETUP 불필요, REFACTOR_OR_SKIP=skip(no separate behavioral cleanup needed). UI/Gallery/Chrome/MANUAL_UI_TEST 해당 없음. `update_plan` 도구가 제공되지 않아 실행 gate를 본 evidence와 대화에서 추적했다.

Central Rulebook의 Fastify hook completion 규칙을 async onRequest/onClose와 완료되는 inject/runtime 테스트에 적용했다. 검색 응답의 Fastify 환경 unknown은 실제 5.12.3 manifest와 canonical >=5 <6 제약으로 확인했다. 배포 이미지/팝업/벌크 결과 규칙은 이번 작업과 직접 관련 없어 제외했다. postflight는 신규 3×HIGH 후보 없음; canonical 추가 및 data repo sync 해당 없음. 프로젝트 lesson 파일 fallback을 만들지 않았다.

Obsidian Step/overview/Phase spec/User Story/capability 계약을 S03 결과에 맞춰 동기화했다. 제품 AC-01/09는 S06 이후 UI/consumer 검증이 남아 있으므로 전체 완료로 표시하지 않는다. 프로젝트 commit/push/배포는 수행하지 않았다.
