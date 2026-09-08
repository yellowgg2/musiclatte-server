# S11 Chrome review evidence

2026-09-08. STRUCTURAL/full/self. Feature-local recovery/conflict/restore views reuse the approved modal, Action and status patterns; shared-new=0, Gallery change=none.

## Executed interactions

- KO reflecting-delay history: file-saved/library-pending distinction, recheck → verified. Recheck dispatch uses no writer; unit/API contracts verify the endpoint boundary.
- KO conflict: submitted title and fresh current title are distinct; “edit from current values” opens the existing editor with the current title, not the submitted title.
- KO restore: current/original values, backup time, target and whole-file warning; cancel/Escape does not write and returns focus to Review restore. Explicit accept closes the dialog, shows pending restore copy, and permits history re-entry. Verified child job announces original restore and library verification complete.
- EN restore conflict: attempted restore returns conflict, removes the stale confirmation/button, shows a readable alert and offers explicit current reload. Reload restores a new comparison; cancel returns focus.
- EN cover mismatch and ID conflict: recheck leaves unresolved status pending; no false completed state, rewrite action or saving toast. No ID substitution is attempted.
- EN disk-full fixture: readable file-save failure and explicit failed-song review; no private path/stack.
- EN worker-restart fixture: recovery-needed/write-outcome-uncertain, no unsafe rewrite retry.
- EN partial fixture: verified first item and failed second item remain separate. Retry review contains only the failed song, its fresh revision and submitted year; cancel writes nothing.
- EN denied fixture: no recheck/restore/retry controls.
- Actual server: Chrome single title edit during uninterrupted playback, two-song common album/year edit, two explicit original restores, pending toast and history re-entry. Track metadata/player title updated without resetting playback. Original file/durable result checks are in runtime.json.

## Layout and accessibility

KO/EN desktop 1800×863, mobile 390×844 and strict 320×844 were inspected with rendered screenshots and accessible state. The actual server was also reviewed at its normal 1245×952 viewport. A long synthetic title and 60-line lyric comparison were inspected in KO and EN; measured document widths equaled 390/320 at the narrow sizes. No horizontal overflow or clipped primary action was observed.

The named comparison region receives initial focus. End reaches the final original lyric without covering it with the footer; Home returns to the top. At 320px the footer actions stack and remain visible. Tab from the final restore button wraps into the named region; Escape/cancel returns focus to the launching control. Desktop long-copy review keeps one content scroller and a separate action footer.

Found and fixed: recheck acceptance initially reused a misleading “saving continues” toast. It now only refreshes the job; EN persistent cover mismatch was rechecked with no saving toast. Restore review now always names the target, including when title itself is unchanged. No global primitive/token change.

## Pending, not passed

Chrome version awaits user report: the browser URL policy blocked the version page. Actual 200% browser zoom, touch emulation and reduced-motion remain unverified for S11. Native Chrome window inspection remained on an older DevTools tab; key actions did not alter the observed state, and earlier screenshot/coordinate attempts failed with window-availability errors. A documented page shortcut also left measured width/pixel ratio unchanged, so this is not counted as actual zoom. Ordinary page interaction recovered by creating a fresh owned tab.

Full review remains pending these checks; observed FATAL0/MAJOR0 is not a full-pass claim. S10 manual approval and S10 200% evidence are separate. User iPhone touch/media/soft-keyboard results must additionally be recorded in native-checklist.md.

## User-reported mobile song actions — 2026-09-08

MAJOR: the user's Safari favorites screenshot showed metadata/favorite buttons on mismatched baselines, flush against the card's left/bottom edge. Chrome 390×844 reproduced metadata y=542.49 and favorite y=536.49 (44px controls), a 6px difference. This rendered geometry is the regression evidence; no CSS-text assertion was added as a substitute for layout verification.

Fix: MusicRow owns shared mobile padding/gap and right alignment. FavoriteAction no longer adds its own mobile padding; MetadataAction uses a flex wrapper and anchors its mobile popup to the row action group. These are component presentation corrections, not global token/primitive or action semantics changes. Shared-new0, no Gallery baseline change.

Retest on the deployed isolated web: 390px metadata/favorite y=536.49, x=265/317, both 44px with 8px gap. At 320px KO the popup stays inside the viewport, edit opens and cancel works. EN320 selection mode has document scrollWidth=innerWidth=320; desktop1800 playback/metadata/favorite controls all y=468.59. Screenshots and DOM interaction were reviewed. Existing favorites, design foundation, library, single editor and playlist edit tests: 40/5 files passed; typecheck/build/format:check passed. Safari-specific confirmation and the other outstanding S11 gates remain pending.

Final update: user confirmed Safari alignment/playback. Under the updated deferred-acceptance contract, remaining matrix items are registered as pending/stale in Phase4 ui-acceptance, not deferred implementation failures. No final full-pass claim. Owned test tabs/processes/remote stack cleaned after observed flows.
