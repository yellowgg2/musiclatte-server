# Step 00 검증 — 2026-09-05

실행 cwd는 신규 `musiclatte-server` repository root. Node 24.20.0 / npm 11.19.0 / macOS arm64. Host global runtime은 변경하지 않았다.

| 단계                     | 정확한 명령                                                                       | 결과                                                                      |
| ------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 설치                     | `npm install`                                                                     | exit 0, exact dependencies와 lockfile 생성                                |
| RED type                 | `./node_modules/.bin/tsc --noEmit -p tsconfig.json`                               | exit 0, test/config 수집 타입 오류 없음                                   |
| RED unit/runtime         | `npm run test:unit -- tests/unit/workspace.test.ts apps/api/test/runtime.test.ts` | exit 1, 8개 중 구현 모듈 존재 assertion 6개 실패, 기존 설정 검사 2개 통과 |
| RED contract             | `npm run test:contract -- tests/contract/workspace.test.ts`                       | exit 1, 구현 모듈 존재 assertion 3개 실패; import/collection failure 아님 |
| clean install            | `npm ci`                                                                          | exit 0, audit 0 vulnerabilities; npm 기본 install-script 승인 안내는 남음 |
| GREEN/final type         | `npm run typecheck`                                                               | exit 0, root/test/config 및 4 workspace                                   |
| GREEN/final unit/runtime | `npm run test:unit -- tests/unit/workspace.test.ts apps/api/test/runtime.test.ts` | exit 0, 2 files / 8 tests                                                 |
| GREEN/final contract     | `npm run test:contract -- tests/contract/workspace.test.ts`                       | exit 0, 1 file / 3 tests                                                  |
| GREEN/final build        | `npm run build`                                                                   | exit 0, 4 workspace; Vite 12 transformed modules                          |

Focused 11개는 현재 전체 test inventory와 같다. 별도 중복 broader suite 실행은 하지 않았다. Vite config import 확장자 경고는 `.ts` import와 noEmit config의 `allowImportingTsExtensions`로 수정 후 typecheck/build를 재검증했다.

## 실제 process smoke

각각 독립 subprocess를 생성하고 HTTP로 관찰했다. 세 프로세스를 하나의 foreground shell에 순차 실행하지 않았다.

- `PORT=50056 npm run dev:api`: `http://127.0.0.1:50056/health/live` → HTTP 200, `{status: "ok"}`.
- `VITE_APP_BASE=/music/ VITE_API_ORIGIN=https://api.example.com npm run dev:web -- --port 50057`: `http://127.0.0.1:50057/music/` → HTTP 200, 빈 root와 base가 반영된 entry.
- `PORT=50058 NODE_ENV=production npm run start -w @musiclatte/api`: compiled API liveness → HTTP 200.
- 임시 `smoke-fixture.module.css`를 웹 dev server로 요청해 scoped class export를 확인했다.
- 초기 smoke에서 root npm script의 `--port` 전달이 실패했다. workspace npm invocation에 `--`를 추가한 뒤 동일 custom-port smoke가 통과했다.
- 완료 후 session이 만든 process group을 종료하고 세 포트가 닫힌 것을 확인했다. 임시 CSS fixture도 삭제했다.

실제 Chrome/UI review는 해당 없음: 제품 화면/공유 component/시각 변경 없음, Gallery baseline owner S05. UI review debt 0. 위 HTTP smoke는 Chrome 검증으로 표기하지 않는다. devserver 접속·실제 음악 CRUD는 이번 S00에 필요하지 않아 실행하지 않았다.

## 계약·위생

- health producer ↔ shared synthetic fixture를 Fastify inject로 비교. 알려지지 않은 API 및 `/rest`는 현재 404이며 기존 gonic/iOS/bot/서버를 변경하지 않았다.
- KO/EN 각 1개 key, 누락·빈 값·placeholder mismatch 0. count edge/error와 명시 timezone 날짜 검증 통과.
- Git 후보 파일에 local absolute path/private-key marker 없음. Git check-ignore로 root/nested agent 설정, env/data/media/build 제외 및 source/lock/example 보존 확인.
- Docker context에도 agent/env/media/data/generated 제외 규칙을 작성했다. 실제 Docker/Compose build는 S04 범위이며 이 검증에 포함하지 않는다.
- Production web은 빈 React root이며 test-support runtime을 소비하지 않는다. bundle에 임시 CSS fixture와 health test fixture가 포함되지 않았다.
- GitHub public remote 생성과 origin 연결만 수행했다. source commit/push 없음; license 미선택.
