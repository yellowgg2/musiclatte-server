# S05 — Design Foundation & Component Gallery v0

2026-09-05. 구현·자동 검증·**Gallery 사용자 승인 완료**. S06 production UI는 시작하지 않았다.

## 구현과 소비 경계

- `apps/web/src/design/tokens.css`, `global.css`: 밝은 semantic palette, KO/EN system font, type/spacing/radius scale, 3px focus, reduced-motion.
- `apps/web/src/design/components/`: 실제 `Action`, `IconAction`, `TextField`, `StatusSurface`, `Artwork`와 각 CSS Module. 모두 baseline `shared-new`. 현재 consumer는 `src/dev/Gallery.tsx`, 첫 production consumer는 S06 예정.
- Gallery layout·상태 전환·synthetic inline artwork는 development-local. 미래 shell/player/job/bulk component는 구현하지 않았다.
- `main.tsx`는 기본 root를 비워 두고 DEV와 SPA base를 확인한 뒤 Gallery를 dynamic import한다. API origin 계약은 변경하지 않았다.
- `.dockerignore`는 `apps/web/src/dev` 전체를 제외한다. 실제 production CLI build의 assets/source map/manifest에 Gallery module·fixture가 없고, dev source가 없는 임시 build context에서도 build가 성공한다.
- Vite preview에서 `/__dev/gallery` 및 `/music/__dev/gallery`, slash/query 변형이 404다. nginx의 기존 개발 route deny 목록에도 `__dev`를 추가했다. 이번 Step에서 nginx container를 새로 실행하거나 운영 배포하지는 않았다.

## 검증 명령과 결과

cwd: musiclatte-server repo root. 모든 npm 명령은 session-local Node **v24.20.0**, npm **11.19.0**으로 실행했다. host global runtime은 변경하지 않았다.

| 명령                                                                   | 결과                                                                          |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `npm run test:unit -- apps/web/test/design-foundation.test.tsx`        | RED 6 assertion failures → GREEN 6 pass, exit 0                               |
| `npm run test:contract -- tests/contract/production-exclusion.test.ts` | 초기 RED 4 failures, Docker context 추가 RED 1 failure → GREEN 5 pass, exit 0 |
| `npm run typecheck`                                                    | 모든 workspace pass, exit 0                                                   |
| `npm run build`                                                        | 모든 workspace pass, exit 0; web production 15 modules, Gallery chunk 없음    |
| `npm run test:unit`                                                    | 10 files / 107 tests pass, exit 0                                             |
| `npm run test:contract`                                                | 6 files / 73 tests pass, exit 0                                               |
| `npm run format`, `npm run format:check`                               | repository source/document format 적용 후 check pass                          |
| `git diff --check`                                                     | pass                                                                          |

Test setup: Vitest 기존 config에 web TSX 범위를 추가하고 Testing Library React 16.3.3/user-event 14.6.7, jsdom 30.0.1을 exact devDependency로 추가했다. Production build 검증은 Vitest의 NODE_ENV와 dev server optimizer 영향을 분리하기 위해 `NODE_ENV=production`의 실제 Vite CLI child process를 사용한다. Source map 원문에 남는 DEV guard 문자열과 실제 emitted module/code를 구분한다.

## 실제 Chrome Preview

- Surface: 연결된 Chrome extension browser, `mcp__cua_repl`의 browser Playwright/viewport API. reduced-motion·page zoom은 같은 Chrome의 DevTools/native UI로 설정했다. 다른 browser/standalone Playwright는 사용하지 않았다.
- Entry: `http://127.0.0.1:5173/__dev/gallery`; deterministic `gallery-fixtures.ts`, marker `MUSICLATTE_GALLERY_V0`.
- Chrome DevTools에서 152를 관찰했다. `chrome://version`은 browser URL policy에 차단되어 정확한 patch version은 확인하지 않았다.
- Desktop: 실제 window content 1800×863 CSS px. Mobile: viewport override 390×844, reflow 320×844. 모두 밝은 테마, KO/EN.
- UI route: **CRITICAL / full**, checkpoint S05, covers `[step-05]`. Screenshot review를 defer하지 않았고 review debt는 0이다.
- 공통 core/forms/cards와 project design-system 기준을 screenshot·실제 DOM·interaction으로 검토했다. Web platform pack은 없어 다른 platform 규칙을 대체 적용하지 않았다. UI_BASELINE PASS, 잔여 FATAL/MAJOR/MINOR finding 0. 최종 시각 방향은 2026-09-05 사용자 `gallery approved` 응답으로 승인됐다.

| 검증                     | 관찰 / evidence                                                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 전체 inventory / KO·EN   | [Desktop KO](desktop-ko.png), [Desktop EN](desktop-en.png), [KO DOM](desktop-ko-dom.txt)                                                                                     |
| Mobile / 긴 번역         | [Mobile EN](mobile-en.png), [Mobile KO](mobile-ko.png), [EN DOM](mobile-en-dom.txt); 390px에서 overflow/clipped content 0                                                    |
| 320px reflow             | [KO](reflow-320-ko.png), [EN](reflow-320-en.png); 두 언어 모두 scrollWidth=innerWidth=320                                                                                    |
| 실제 200% page zoom      | Chrome toolbar 200% 확인; CSS viewport 900×431, scrollWidth=900, clipping 0; [Viewport capture](zoom-200-en-viewport.png)                                                    |
| Keyboard / disabled      | Enter로 Action 실행, Space로 Favorite toggle; disabled/busy 두 버튼을 Tab이 건너뛰고 long action으로 이동; focus outline 3px 확인                                            |
| TextField                | label/help/error ID 연결, aria-invalid=true; `latte` 입력 후 Enter 제출; 중간 삽입 결과 `lkoatte`, caret=3; [Focus](focus-ko.png), [KO interaction DOM](keyboard-ko-dom.txt) |
| Locale state 보존        | KO→EN→KO 전환 후 입력·favorite·submit·recovery state 유지, labels/description/accessible names 변경; [Final DOM](final-interaction-dom.txt)                                  |
| Error recovery / pointer | Mobile EN에서 Try again 클릭 → Connected again, 기존 다른 상태 유지; [Interaction](mobile-en-interaction.png)                                                                |
| Artwork                  | 실제 available/loading/missing/failure 각 120×120; missing/failure에도 frame 유지; synthetic data URI 외 network/media 없음                                                  |
| Contrast                 | [실제 CSS token 및 ratio](contrast.json): text/surface 14.8, secondary/background 5.46, on-accent 6.73, field border 3.69, focus 10.28                                       |
| Reduced motion           | Chrome DevTools prefers-reduced-motion: reduce → token 0ms, 모든 main button transition 0s; [값](reduced-motion.json), [화면](reduced-motion.png)                            |
| Console / root           | inspected Chrome error/warn logs 없음; 정상 `/` entry의 body text는 빈 값. 코드에서도 root.render(null) 유지                                                                 |

320px/mobile은 responsive viewport 검증이다. 실제 iPhone media·software keyboard·물리 touch·native IME 입력 보증은 이 S05 evidence에 포함하지 않는다. S10 실제 iPhone media owner를 대체하지 않는다.

## Localization / 문서 / 상태

- 실제 registry `src/i18n/index.ts`의 ko/en 유지. 기존 JSON resources에 `gallery.*` **65 keys**씩 추가했다. 전체 key equality, nonempty values, placeholder equality는 기존 workspace test로 통과했다.
- Obsidian Step/overview/Phase 1 spec/design-system/component-catalog를 actual symbol·검증·사용자 승인 완료 상태로 동기화했다. vault는 app repo Git 대상 밖이다.
- 추가 행동 보존 refactor는 필요 없어 skip했다. 기능 구현·typecheck/build·focused/broader verification은 완료했다.
- **최종 GATE_CHECK PASS: S05 required gate 완료, 미완료 gate 0, review debt 0.** 자동화 가능한 UI_TEST는 완료했다. 별도 USER_ONLY_REQUIRED 기능 테스트는 없다.
- 사용자 응답: 2026-09-05 **`gallery approved`**. catalog baseline `approved`, review `user-approved`; S05와 AC-02 완료. S06는 미착수다.

## Resource / Git

- Dev command: `npm run dev:web -- --host 127.0.0.1`. 이번 session이 만든 Vite PID 82414, port 5173, loopback only.
- 사용자 승인 후 이 dev server와 Gallery handoff tab을 정리했다. 임시 test directories/preview servers/검증용 tabs도 정리했다.
- 임시 viewport override·page zoom·reduced-motion emulation을 원래 상태로 복원했다. 사용자 기존 process/tab/data는 변경하지 않았다.
- Branch: `yellowgg2/tdd/phase-1/step-05-gallery`. 프로젝트 commit/push/운영 배포 없음.

## 최종 gate 기록

사용자 승인 후 변경은 문서 상태 동기화뿐이다. 기존 focused 11·전체 unit107/contract73·typecheck/build·Chrome evidence를 유지하고 format:check와 diff check를 다시 확인했다. BRANCH_SETUP/PROJECT_DOC_CONTEXT/RED/GREEN/COMPONENT_GALLERY_SYNC/UI_DESIGN_REVIEW/UI_TEST/LOCALIZATION/DOC_SYNC/GATE_CHECK 완료. REFACTOR는 추가 개선 불필요로 skip, 별도 MANUAL_UI_TEST는 해당 없음. commit/push 없음.
