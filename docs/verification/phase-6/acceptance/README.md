# Phase 6 acceptance — design and automatic verification

2026-09-09. Status: **pending**. Compact-list design approved; focused checks and token-focus fix verified. Full automatic matrix and actual Safari results remain pending. VoiceOver (P6-UA-004) is excluded by user request, not passed. The sections below retain the initial observations and subsequent changes.

## Identity and coverage

- Code: `bff6cacbefd4af7df0bff518644bca4dac183db9`, clean worktree at start. Initial review added documentation only; subsequent code changes and their diff identity are recorded below.
- Environment: macOS, installed Chrome **152.0.7977.83**, session-local Node 24.20.0. Executor: Codex through connected Chrome/CUA.
- Scope: P6-UA-001–007 (001–006 required; 007 optional), AC-01–12 coverage reconciled with Phase overview. API/file contracts remain with S00–S10; visual and user outcomes remain with this register.
- Reused evidence: S11/S12 production Router and real HTTP checks; S12 full unit767/contract166/typecheck/build/format. Since S12 the only product change is the backend fence-timeout fix documented in `../deployment.md`; no web/shared primitive diff invalidates those UI functional results.
- P1/P4 references remain baseline owners. No shared component changes or newly stale cross-Phase IDs. Existing Gallery approval remains unchanged.

## Actual initial observations

Screenshots and accessible state were captured in the Codex conversation; these are initial observations, not the full final matrix.

- `/settings`, KO, default desktop viewport: existing account/language panels and new token form use the existing foundation. Required read scope and disabled lyrics scope include explanatory text; empty-token guidance is visible.
- Synthetic issuance using a mixed KO/EN long name and the music library: the one-time redacted placeholder receives focus; issued-once guidance, copy/hide controls and owned metadata render. No real token was generated or recorded.
- `/music/curation`, KO/EN desktop: count 25/27, library coverage, completed+lyrics-missing, needs-review and no-usable-source states are distinguishable in text. Filters and actions retain localized names.
- Curation details and existing metadata editor, KO desktop and 390×844 responsive viewport: required completion is independent of optional information, title/artist are required, lyrics missing is explicit; editor footer actions remain visible. Cancel returns to the originating edit action.
- KO 390×844 list: status plus a separate title-bearing details button makes each collapsed track tall. Information density is a design-feedback topic; a final baseline has not been approved.
- Gallery opened with real shared components and inspected visually. It is unchanged; this is a reuse comparison, not a new approval.
- Viewports observed: default desktop captures 1800×1008 (settings) / 1800×952 (curation); explicit 390×844 for curation/editor; explicit 1800×900 for EN curation. No 320px, actual 200% zoom, reduced-motion, full contrast matrix, or actual iPhone/VoiceOver pass is claimed.
- The fixture's 1970 last-verification timestamp is synthetic data, not evidence of a real library timestamp defect.

## Pending and handoff

- P6-UA-001: desktop design feedback requested; iPhone 12 Pro design result pending.
- P6-UA-002/003: final state/locale/viewport/zoom/motion/accessibility matrix pending until design direction stabilizes. Existing functional test evidence is not substituted for this matrix.
- P6-UA-004/005/006: actual iPhone 12 Pro Safari/VoiceOver/clipboard/software-keyboard/playback outcomes pending. Responsive Chrome is not a substitute.
- P6-UA-007: optional actual external-agent experience pending.
- Detailed user procedures will be finalized after design feedback; do not repeat already automated functional tests as manual work.

Owned loopback-only production-Router synthetic harnesses are retained for the requested feedback: token port18726 (exec session90967), curation/Gallery port18727 (exec session85432). Control files are in `/tmp/musiclatte-p6-acceptance-20260909/`. No audio fixture was provided in this initial review, so these tabs are not the actual-Safari playback setup. Browser tabs384350657/384350658/384350659 were marked for handoff. Temporary viewport override was reset. After feedback, close only these owned tabs/processes and remove their temporary control files. Existing devserver stack, demo server, volumes and user tabs were untouched; no deployment, commit or push was performed.

## Compact list feedback applied — 2026-09-09

User requested a denser list. Feature-local CurationPage now groups status and a short details action in one wrapping row, removes repeated song titles from the visible action, reduces section gaps and removes extra per-track bottom margin. The accessible action name retains the full song title. KO/EN keys were added together. No shared primitive changed.

Actual Chrome screenshots verify desktop and 390px KO layout, plus 320px EN wrapping. Details still expand/collapse and expose required/optional state; the existing curation UI/state tests pass (9 tests). Typecheck, build and format checks pass. The last mobile screenshot shows the shorter status/action row and retained touch controls. These focused checks do not complete P6-UA-002/003's full matrix or actual iPhone acceptance. User direction is recorded as compact; final visual result is available in the retained curation tab.

## User design approval — 2026-09-09

The user replied “어 이거 맘에 들어” to the compact-list result. Record approval for the presented CurationPage design only, on the `bff6cac`-based dirty page/CSS/KO/EN change. This completes the list-design feedback portion of P6-UA-001, not the whole item: token design, actual iPhone outcomes, VoiceOver and the remaining final matrix have no approval/result from this reply. No new Gallery or cross-Phase approval is inferred.

## VoiceOver scope waiver — 2026-09-09

User explicitly requested “VoiceOver는 skip해줘”. P6-UA-004 is `skipped_by_user`, unexecuted and excluded from required completion (not passed). Required items now5, optional1, excluded1. Automated accessibility and other actual Safari requirements remain in scope.

## Follow-up automatic checks and focus fix — 2026-09-09

- Baseline after code edits: `bff6cac` plus tracked binary-diff SHA256 `f6a533bbb6a5bc168538a550877f2ac9a5bed81158fbd52efa467c04d5c6d640`.
- Found CORE-009 focus obstruction: in actual Chrome at320×844, after issuing a synthetic token, Tab moved to Copy token/Hide token while the buttons remained behind bottom navigation. Added feature-local control scroll margins in AccessTokensPanel.module.css. Reissued a synthetic token and repeated Tab: screenshot now shows the whole focused Copy token and Hide token above navigation. This changes focus scrolling only; compact-list design approval remains valid.
- Actual browser zoom: used Chrome's native zoom menu, verified the toolbar accessibility label **200%**. EN token one-time controls and KO curation filters reflowed visibly. Read-only DOM measured curation clientWidth900 and scrollWidth900 at200%. Chrome native Reset restored100%, confirmed in the zoom popup. No CSS transform was used.
- 320px KO curation list-error fixture: alert text and Reload current list were visible above fixed navigation after scrolling, without overlap. Longer synthetic token names and redacted one-time values wrapped in320px. Screenshots/AX evidence is in the conversation.
- Reduced-motion actual emulation is still unverified: DevTools opened, but the reached common-rendering menu exposed only color-scheme choices; no reduced-motion setting or pass is claimed. DevTools was subsequently closed. Full UA002/003 state/locale/player/motion matrix remains pending; these observations are partial evidence.
- Focused access-token/curation/state unit tests: **14 passed**; typecheck and build exit0. JSDOM emitted its existing unsupported audio pause/load notices; no real playback claim comes from those tests.
- Fixture controls restored to normal; temporary viewport and native zoom restored. Retain only the token/curation harnesses and feedback tabs while remaining review work is pending. No real credentials, remote services or media were modified.

Cleanup update: Gallery tab384350659 closed after its reuse review; token and curation tabs remain for handoff.
