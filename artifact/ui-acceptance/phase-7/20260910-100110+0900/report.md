# Phase 7 UI acceptance — complete

- Run ID: `20260910-100110+0900`
- Product identity: `f75edf7ce889575883b8341b78565a0c681ea243`
- Branch: `yellowgg2/tdd/phase-7/step-13-listening-deployment`
- Initial worktree: clean
- Runtime: Node 24.20.0, npm 11.19.0, Chrome 152 on macOS
- Executor: Codex through connected Chrome/CUA
- Scope: P7-UA-001–007

## Current result

The user approved the revised mix and listening direction. P7-UA-001–005 passed the automatic
matrix with no FATAL or MAJOR findings, and the affected responsive portions of P7-UA-002/004/005
were restored to passed after the user confirmed the refreshed iPhone Safari build. P7-UA-006
(actual VoiceOver) was skipped at the user's explicit request and was not counted as passed.
P7-UA-007 passed from the user-operated iPhone Safari result. Phase 7 therefore closes with six
passed items and one explicitly skipped item.

## User findings and resolution

- Mix and listening language controls now share a top row with navigation and align to the desktop
  content edge.
- Mix navigation is now `All music / Saved mixes / current mix`; the orphan detail-footer link was
  removed.
- Listening navigation is now a top-level `All music / Recent listening / Frequently played` switch.
- Mix save/play remain primary, draw/queue are secondary, and delete is destructive with the
  existing confirmation flow.
- Listening period/refresh and playback/queue are separate aligned groups; refresh and queue are
  secondary while play is primary.
- Both feature pages removed the centered 68rem cap and use the same available content width as the
  music page. Mobile layouts wrap without overlap.

Focused implementation evidence after the latest information-architecture follow-up: unit 45/45,
contract 17/17, KO/EN 752-key parity, typecheck pass, production build pass.

## Automatic matrix result

- Actual Chrome covered KO/EN at 1440×900, 390×844, and 320px reflow. Native Chrome 200% zoom
  reported a 720×450 CSS viewport at DPR 2. Every recorded surface retained its content with no
  horizontal overflow.
- Mix and listening retained the approved top navigation, language placement, action hierarchy,
  long content, missing-song handling, and reachable last content with the persistent player.
- Quality radios expose one native `playback-quality` group. Arrow-key selection moved from
  Original to Economy, each mobile option has at least a 44px clickable label, and the copy keeps
  “current track: server default” distinct from the next-track preference.
- Artist detail retained albums during enrichment, long biography expansion, empty and provider
  error states, retry recovery, and local related-artist navigation. Navigation moved focus to the
  destination `h1`; the synthetic credential-bearing provider URL was absent from DOM text and
  attributes.
- Numeric contrast samples across all four surfaces had a minimum ratio of 5.46:1. Controls have
  accessible names/states and the inspected focus order starts with skip/main navigation before
  page actions. At 320px, visible buttons/selects and quality option labels meet the 44px target.
- A separate actual Chrome 152 process ran with reduced motion forced on. `matchMedia` returned
  true, the loaded production `--motion-response` resolved to `0ms`, and the shared action's computed
  transition duration was `0s`; evidence is in `matrix/reduced-motion-chrome.json` and `.png`.
  The loaded CSS contract also disables player sheet/backdrop animation, and the four Phase 7
  surfaces add no feature-local animation.
- S03/S07/S10/S12 state evidence was reused for conflict, removed root, empty/error, recording
  failure, already-small/unsupported quality, explicit original retry, loading/stale suppression,
  and no-image behavior. S10's isolated gonic evidence remains the transport/decode authority;
  this run supplies the final visual, reflow, semantics, and interaction evidence.

Matrix evidence is under `matrix/`; representative captures include `mix-ko-320-player.png`,
`listening-top-ko-320-player.png`, `quality-ko-zoom200.png`, and
`artist-info-error-ko-390.png`.

## Presented surfaces

- Saved mix detail with saved conditions, result actions, and a populated MusicRow.
- Recent listening with 50 synthetic events, date groups, period filter, actions, and pagination.
- Playback quality settings with Economy selected while the current track remains Server default.
- Artist detail with album navigation, long biography, image fallback, expansion, and related artist.
- The existing approved shared-component Gallery for side-by-side direction comparison.

Desktop and 390×844 views were inspected in the connected Chrome review session. The restored
desktop captures and accessible states are now persisted under `screenshots/` and `accessible/`.
The final matrix must still preserve evidence for every required condition before an ID passes.

After the user reported that the four feature tabs had fallen back to login, the cause was confirmed:
the isolated previews used different ports on the same `127.0.0.1` host, so their session cookies
overwrote one another. Each feature was restored in turn and its desktop screenshot and accessible
state were persisted under `screenshots/` and `accessible/`. `review.html` now presents those captures
without requiring an active session.

## Initial rule review

`CORE-001–010`, `LIST-001–005`, `FORM-001–008`, `NAV-001–006`, and `CARD-001–006` were applied with
the project design system. There is no web platform pack, so no mobile platform pack was substituted.
No failed rule is recorded at this stage.

## Evidence reused

- `docs/verification/phase-7/step-03/README.md`
- `docs/verification/phase-7/step-06/README.md`
- `docs/verification/phase-7/step-07/README.md`
- `docs/verification/phase-7/step-09/README.md`
- `docs/verification/phase-7/step-10/README.md`
- `docs/verification/phase-7/step-12/README.md`
- `docs/verification/phase-7/step-13/README.md`

These implementation results remain distinct from final visual, zoom/reflow, screen-reader, and
Safari-device acceptance.

## Next gate

P7-UA-006 is recorded as skipped by explicit user choice, not as successful VoiceOver evidence.
P7-UA-007 remains pending, and the later Safari feedback fix made the affected responsive portions
of P7-UA-002/004/005 stale until they are rechecked. The live handoff below supersedes the earlier
statement that no preview process was retained.

## Information-architecture follow-up — 2026-09-10

- Promoted the approved Recent-listening top switch into shared `SectionNav`, consumed by Music,
  Mixes, Listening, Curation, Recent Downloads, and Favorites, with a current-page pill and quiet
  links that wrap at narrow widths.
- Reframed Mix conditions/results, Recent Downloads controls, Favorites controls, and Curation
  filters/coverage/list as bordered surfaces or divided lists. Action variants now communicate
  primary, secondary, quiet, and destructive meaning instead of presenting a uniform purple row.
- Actual Chrome checks covered the Gallery fixture, all affected desktop surfaces, Mix interaction,
  and Music navigation at 320px. Accessible navigation and named control/coverage regions were
  inspected. The previous unchanged state/contrast/zoom/motion evidence remains in the matrix.
- This follow-up does not convert the VoiceOver skip into a pass. P7-UA-007 remains pending. The
  changed Phase 6 Curation visual/device items are marked stale in their canonical Phase 6 document
  until the new layout is approved and rechecked there.

## Live iPhone Safari handoff — 2026-09-10

- Review product: base commit `f75edf7ce889575883b8341b78565a0c681ea243` plus the current
  uncommitted `apps/web` information-architecture changes. The source diff SHA-256 at launch was
  `6e23b5ea4c6f8c6f606bbb75166672d02381b33ca95a0df0409a5780d3c44c95`; commit identity alone does
  not identify this build.
- A same-origin isolated fixture is running at `http://192.168.129.108:18740`. It serves the current
  production web build and a loopback-only synthetic API. Login is `fixture-listener` /
  `synthetic-password`; the saved mix ID is `bd06972e-5979-4d8d-8ba3-104282f0f4a2`.
- The fixture provides a saved Mix, 12 listening events, stream-quality and artist-info capabilities,
  27 Curation tracks, and a 2:05 synthetic WAV with byte-range responses. It does not read or mutate
  personal music, accounts, existing services, or the devserver library.
- HTTP smoke through the LAN origin passed: login 201, capabilities 200, mix 200, history 200,
  quality 200, Curation 200, audio range 206, and SPA fallback 200.
- A connected Chrome LAN smoke passed login, mix draw/play/queue enablement, actual audio playback
  with the persistent player, and rendering of Recent listening, Settings, artist biography, and the
  revised Curation layout. This is readiness evidence only and is not an iPhone Safari result.
- The server remains running for user-operated P7-UA-007 and the focused P6 Curation touch/design
  recheck. VoiceOver remains `skipped_by_user`. The server and its `/tmp/musiclatte-p7-safari-20260910`
  fixture are owned by this acceptance session and must be removed after the user result is recorded.

## iPhone Safari feedback fix — 2026-09-10

- User-operated Safari exposed three responsive defects: the artist edit-history/language utility
  group stayed left-aligned after wrapping, and the Recent listening/Frequently played refresh
  action stretched to the height of the period label plus select.
- Root causes were feature-local CSS: `Music.module.css` lacked auto inline-start space on the wrapped
  utility group, while the `max-width: 48rem` Listening rule applied `align-items: stretch` to the
  child action groups. The fix right-aligns wrapped utilities and limits stretch to the outer control
  bar so its child actions retain the shared Action control height.
- Focused Vitest RED reproduced both problems, then GREEN passed 20/20 tests. Typecheck, production
  build, and format check passed. The live fixture now serves `assets/index-DpXGRmHr.css`; the current
  `apps/web` diff SHA-256 is `ce01914a2a34bb872aeb20ec09921e73d61bc87aae98a8ce472c31eb24a30969`.
- User screenshots are preserved under `screenshots/safari-feedback-*.png` with
  `safari-reference-language.png`. P7-UA-002/004/005 are stale for the affected responsive delta and
  P7-UA-007 remains pending until the refreshed iPhone Safari views are confirmed.

## Login foreground-return fix — 2026-09-10

- User-operated Safari showed repeated unauthenticated `GET /api/v1/session` responses while the
  login page cleared an in-progress ID/password draft after losing and regaining focus. The console
  capture is preserved as `screenshots/safari-feedback-login-session-401.png`.
- The session restore listeners for both `focus` and `visibilitychange` changed a signed-out store to
  `loading`, which replaced and unmounted the login form. Resume checks now run as background
  restores: the form stays mounted, simultaneous resume events share one in-flight request, and a
  401 keeps the signed-out form and its local draft intact.
- This root cause did not replace signed-in pages with the loading surface. A genuine expired session
  still transitions a signed-in page to login as intended; page-local unsaved state is not promised
  across a real authentication expiry.
- Vitest first reproduced the missing login form during a pending background restore, then passed
  16/16 after the fix. Login contract tests passed 3/3, followed by typecheck, production build, and
  format check. An actual Chrome focus-away/return check preserved both typed fields and observed
  only one background read for the paired focus/visibility events. This is readiness evidence, not
  the required iPhone Safari result.
- P7-UA-007 remains pending until Safari is reloaded and the same focus-away/return scenario retains
  both fields. A 401 may still be visible for a logged-out session probe; it must no longer replace
  the form or erase the draft.

## User Safari result and closure — 2026-09-10

- After reloading the final handoff build, the user reported that all Safari checks worked. This
  closes the active P7-UA-007 checklist, including the foreground login-draft regression and the
  responsive artist/listening fixes. The exact iOS/device version was not supplied; the recorded
  environment is the user-operated iPhone Safari client over the same local network.
- The logged-out session probe may still produce a 401 console entry on a distinct foreground
  return. The user confirmed that application behavior is correct; the console entry is recorded as
  accepted diagnostic noise rather than a UI failure.
- The cross-Phase Curation follow-up combined the user's Safari touch/design result with current
  Chrome desktop/320px evidence and a final native 200% zoom check. At 200%, client and scroll width
  were both 900px and the final 44px action was fully visible. English desktop also retained all
  translated surfaces without horizontal overflow. Evidence is in
  `matrix/curation-followup-chrome.json`.
- The task-owned Chrome review tab was closed. The isolated Safari server was stopped and the
  temporary fixture was moved to Trash after the result was recorded.
