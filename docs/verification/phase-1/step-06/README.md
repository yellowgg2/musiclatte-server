# S06 — 로그인·KO/EN Shell 검증

2026-09-05 완료. Branch: `yellowgg2/tdd/phase-1/step-06-login-shell`. Cwd: repository root. Node **24.20.0**, npm **11.19.0**, project-local pinned toolchain; host global runtime 변경 없음.

## 결과와 gate

| Gate                   | 결과 / 근거                                                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BRANCH_SETUP           | clean main에서 Step branch 생성, commit/push 없음                                                                                                           |
| PROJECT_DOC_CONTEXT    | Obsidian Step/overview/spec/User Story/design-system/catalog 및 S03 auth 계약 확인·동기화                                                                   |
| LESSONS_CONTEXT        | central search 1회 성공; 현재 변경에 직접 적용할 규칙 없음(배포 버전 정렬·popup rule은 범위 밖, Fastify rule은 applicability unknown)                       |
| RED / GREEN            | 초기 11 assertion failures → pass; 개발 fixture·재시도 loading·계정 scope 회귀를 추가해 최종 unit 14 pass. API proxy·실제 만료 쿠키 첫 재로그인도 RED→GREEN |
| PROJECT_SETUP          | web→contracts workspace dependency 명시, lockfile 동기화; 외부 package 다운로드 없음                                                                        |
| COMPONENT_GALLERY_SYNC | Action/TextField/StatusSurface reuse; shell/pages/LanguagePicker feature-local, shared-new 0, approved token/primitive 변경 0                               |
| UI_DESIGN_REVIEW       | CRITICAL/full, 현재 S06 `/login`, `/settings`, shell 및 관련 상태. core/forms/navigation/cards 검토, FATAL/MAJOR/MINOR 0, debt 0                            |
| UI_TEST                | 연결 Chrome 정상 entry에서 로그인·KO/EN·reload·expiry/재로그인·logout·guard·복구·keyboard·mobile pointer 확인                                               |
| MANUAL_UI_TEST         | N/A: S06 필수 흐름 모두 자동화 가능, 추가 사용자 확인 없음                                                                                                  |
| REFACTOR               | 세션 scope reset을 `setSession`에 모아 restore/CSRF recovery에 동일 적용; 영향 tests/typecheck/build 통과                                                   |
| LOCALIZATION           | KO/EN 새 key 36개; 동일 key·nonempty·placeholder 검증 통과                                                                                                  |
| DOC_SYNC               | Step/overview/spec/User Story/catalog/design-system와 code architecture/evidence 동기화                                                                     |
| LESSONS_LEARNED        | reconcile postflight `skipped(no_new_lesson)`; 3×HIGH 후보 없음, canonical write/sync N/A                                                                   |
| GATE_CHECK             | required gates 완료, 미해결 UI debt/사용자 확인 없음                                                                                                        |

`update_plan` tool은 이 세션에 제공되지 않아 gate 상태는 이 표와 진행 업데이트로 추적했다. UI_SANITY/defer는 CRITICAL/full이므로 적용하지 않았다. Gallery baseline은 기존 S05 `user-approved`를 유지하며 재승인 대상 변경이 없다.

## 실행 evidence

모든 명령은 repository root와 위 pinned runtime에서 exit 0. RED의 의도한 assertion failure는 exit 1이며 compile/collection 실패와 구분했다. 초기 test typing 문제는 RED 확정 전에 typecheck/build로 제거했다.

| 명령                                                                                                      | 결과                            |
| --------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `npm run test:unit -- apps/web/test/login-shell.test.tsx`                                                 | 14 tests pass                   |
| `npm run test:contract -- tests/contract/login-shell.test.ts tests/contract/production-exclusion.test.ts` | 8 tests pass                    |
| `npm run typecheck`                                                                                       | 전체 workspace pass             |
| `npm run build`                                                                                           | 전체 workspace pass             |
| `npm run test:unit`                                                                                       | 11 files / 121 tests pass       |
| `npm run test:contract`                                                                                   | 7 files / 76 tests pass         |
| `npm run format` → `npm run format:check`                                                                 | project Prettier 적용·검사 pass |

Actual S03 Fastify/session store/CSRF API와 기존 synthetic Subsonic harness를 연결했다. 브라우저/API 경로는 `http://127.0.0.1:5173` → Vite proxy → `http://127.0.0.1:3000`다. 합성 계정·disposable SQLite만 사용했고 실제 devserver/개인 음악/계정은 사용하지 않았다. 15초 expiry는 별도 preview 실행 설정이며 제품 수명은 S03 운영 설정을 따른다.

## Chrome full review와 행동

Chrome **152.0.7977.82**, macOS, 연결된 extension browser를 CUA REPL에서 제어했다. Desktop 1800×863(초기 캡처 1800×919도 존재), mobile 390×844, reflow 320×844. 200% 실제 Chrome zoom은 CSS viewport 900×431; reduced-motion은 DevTools에서 true와 `--motion-response: 0ms` 확인 후 false/140ms로 복원했다.

| 흐름 / 상태                 | 관찰 결과                                                                                  | evidence                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| KO 로그인 / 아이콘          | iOS 원본 복사본, label·password type·초기 focus·44px action                                | [desktop](login-ko-desktop.png), [mobile](login-ko-mobile.png), [DOM](dom-final.txt) |
| EN 인증 오류                | username 유지, password 비움, password focus와 재입력 복구                                 | [error](login-error-en-desktop.png) (아이콘 교체 전 행동 검증 캡처)                  |
| 로그인 → 언어 변경 → reload | account와 `/settings` 유지, KO 선호 복구                                                   | [KO mobile](settings-ko-mobile.png), [EN desktop](settings-en-desktop.png)           |
| mobile / 긴 EN / reflow     | width/scrollWidth=320, nav y=779..844, logout/locale 가림 없음                             | [320px](settings-en-320.png)                                                         |
| 자동 expiry / 재인증        | absolute timer로 signed-out·expiry 안내·username focus, 첫 올바른 submit 성공              | [expiry](expired-en-320.png), 실제 API contract regression                           |
| logout                      | desktop locator click와 mobile native Chrome AX click 모두 login 전환; reload도 signed-out | 정상 entry에서 실행, password/cookie 저장소 직접 조회 없음                           |
| 권한 거절                   | `forbidden`을 인증 실패와 다른 문구로 표시                                                 | [denied](login-denied-en-desktop.png)                                                |
| 로딩 / 일시 장애 / retry    | status→alert, retry 중 loading, 정상화 후 동일 계정 복구                                   | [loading](session-loading-en.png), [outage](session-outage-en.png)                   |
| 직접 `/music`               | 미구현 페이지 안내와 settings 복귀; nav에 미구현 entry 없음                                | [guard](unimplemented-route-en.png)                                                  |
| 200% / reduced-motion       | 가로 넘침 없이 스크롤·keyboard 접근, 비필수 전환 0ms                                       | [zoom](settings-en-200percent-full.png), [motion](settings-reduced-motion.png)       |
| dev-only shell              | actual AppShell/StatusSurface, 빈 상태도 동일 배치, music nav 비활성                       | [desktop](dev-shell-desktop.png), [mobile](dev-shell-mobile.png)                     |

추천 보완은 자동 적용했다: 재시도 loading/중복 activation 회귀와 session identity 변경 시 이전 capability 제거를 RED→GREEN으로 검증했다. 시각 baseline 실패 finding은 없었다. 이미지 파일은 합성 fixture/제품 UI만 포함한다. 모바일 viewport override의 전체창 screenshot 축소 문제는 explicit clip으로 해결했고, 모바일 포인터는 Chrome native accessibility를 사용했다. Bitwarden의 빈 overlay가 자동화를 일시 막아 Escape로 닫은 뒤 재개했으며 암호 저장 승인은 하지 않았다.

## 보존·인계·정리

- 기존 gonic `/rest`, iOS/bot code, S02 schema와 S03 API producer, S04 gateway 의미 보존.
- iOS `AppIcon.appiconset/aaa.png`는 원본 변경 없이 별도 웹 복사본만 32/180/192px resize. 기존 Gallery 승인 토큰은 유지.
- API/SPA base 분리, same-origin development proxy, 검증된 settings return path, cookie/CSRF memory-only, safe server error mapping.
- locale 선호만 localStorage에 저장. 비밀번호·session bearer는 저장하지 않으며 이전 계정 capability/late response는 다음 계정으로 이월하지 않는다.
- preview API/Vite와 임시 upstream/DB/control file, 세션 생성 Chrome tab 정리. zoom/viewport/reduced-motion 임시 변경 복원.
- S06 범위 완료이며 전체 P1 AC-01/07/08/09/10은 library/player/media 후속 owner까지 포함하므로 전체 완료로 표시하지 않는다. 다음 owner는 S07 library API.
- app repository commit/push/운영 배포 없음. Rulebook canonical write 및 별도 data repo sync 없음(no_new_lesson).
