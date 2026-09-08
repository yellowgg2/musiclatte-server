# Touch navigation heading focus correction — 2026-09-08

User supplied an iPhone Safari screenshot showing the page heading surrounded by a purple
rectangle on every tab, and requested an immediate correction. This is an ad-hoc acceptance
fix on the existing dirty worktree; prior MetadataAction and server cover-cache fixes preserved.
No branch switch, commit or push. Baseline HEAD f831c376.

Router retains programmatic page-heading focus and scroll position. A scoped input-modality
attribute suppresses only page-heading outlines after pointer input or initial programmatic
focus. Actual keyboard input restores the existing focus-visible rule. Capture-phase
pointerdown handles touch/mouse before route navigation; event listeners and the document
attribute are cleaned on unmount. Buttons, links, inputs, dialogs and their normal focus styles
are unchanged. No new component, Gallery state or localized copy.

## Verification

- RED: new login-shell regression failed at expected pointer modality (undefined).
- GREEN: `npm run test:unit -- apps/web/test/login-shell.test.tsx apps/web/test/library-ui.test.tsx apps/web/test/metadata-recovery-ui.test.tsx` —35 tests/3 files passed,exit0. Real heading focus after navigation, keyboard Enter, simulated touch pointer and cleanup are covered. Existing jsdom audio pause/load not-implemented notices are not real playback evidence.
- `npm run typecheck` and `npm run build` passed before interruption. Runtime Node24.20.0/npm11.19.0. No source changed after those checks.
- Chrome152 normal-entry local synthetic harness18511: KO Settings pointer navigation left the heading active with outline none. Keyboard Enter to Music left heading active with rgb(76,51,118) solid3px outline.
- At390×844: KO Settings screenshot showed no heading rectangle and scrollWidth390. EN Music pointer outline none; EN Settings Enter outline3px; Tab moved to Sign out button with its3px outline intact. DOM activeElement and computed CSS were observed through the browser. This is Chrome verification plus RTL touch events, not a substitute for physical Safari or VoiceOver.
- Temporary viewport reset and owned tab384350515 closed. Local harness no longer listens on18511 after interruption; no other local process was terminated.

## Isolated server handoff

The web-only test image was built and applied to the already authorized isolated stack on
http://192.168.129.119:18517. Image sha256:ac506a4728296447a6bfca948c0e78b50683bf3ec0fbf3541d87cbd6cabc972c,
healthy. HTTP-served JS and CSS both contain the fix. Existing API/gonic/worker services and
media were not recreated for this correction. A Safari page refresh is required to load the
new bundle, then navigate among tabs by touch. P4-UA-013 owns this physical confirmation;
VoiceOver012 remains pending. Stack retained for user validation. No production deployment.

## Gates

RED/GREEN, typecheck/build, automatic browser behavior and documentation sync complete.
Refactor skipped: no further behavior-preserving changes needed. Rulebook project lookup
returned no directly relevant safeguard; postflight skipped(no_new_lesson), a small scoped
modality correction with no high-cost new general lesson. No central YAML write/sync.
Existing Gallery baseline preserved: heading-only selector, no primitive semantics changed.
Final format:check and diff checks run after documentation sync.

## Source identity

- `apps/web/src/app/Router.tsx`: `3cc4201f1a4f26f8952b4b6b1f4853c229dfd5995a8c37ac304e02b6fd10052b`
- `apps/web/src/design/global.css`: `bf5e1aafdeaac2a5e94112651f5baaf15ab48a4a4ed2c95da2cc275a4abc05c3`
- `apps/web/test/login-shell.test.tsx`: `a994c1f5a7409c1f35d82440db6842e1617d4b6fbba0d6157a1d2f0735b20e29`

### 2026-09-08 Safari 제목 테두리 수정 사용자 확인

사용자 “어 잘되는거 확인했어”로 새로고침 후 탭 이동 시 제목 테두리 수정이 정상 동작함을 확인했다. P4-UA-013 passed. 이 응답은 제목 터치 탐색 범위에만 적용하며 복원 touch/motion005, 복원 후 Safari 화면006 및 실제 VoiceOver012를 대신 승인하지 않는다. 앱 커버008은 기존 accepted_limitation 종료 유지. 전체 acceptance_status pending. 코드 변경·commit/push 없음. 남은 웹/접근성 검수용 격리 LAN stack은 유지한다.

## Final acceptance closure - 2026-09-08

The user confirmed the restored purple cover in Safari. P4-UA-006 passed. Final count: 12 passed, 1 observed failure (008) closed as an explicitly user-accepted limitation. Zero outstanding required checks. acceptance_status passed applies to that agreed scope, not to native cover refresh success. Actual VoiceOver012, restoration touch/motion005 and Safari heading013 confirmations are complete. Gallery unchanged.

Cleanup completed: owned Compose project musiclatte-p4-acceptance down --volumes --remove-orphans exit0; zero owned containers/volumes; five owned test image tags removed. The owned remote /tmp/musiclatte-p4-acceptance-20260908 directory, including synthetic music, test credentials and private logs, was removed. Existing gonic-demo remains running. Latest Chrome inventory contains no owned test tabs; the user's tab is preserved. Local owned private fixture directory removed. LAN18517 is now stopped; this was not a production deployment. Source changes and public verification evidence remain in the workspace, with no commit/push.
