# S09 Chrome observations — 2026-09-08

Surface: connected Chrome extension through CUA. Installed Chrome application metadata reports 152.0.7977.83. The internal version page was blocked by browser URL policy and was not accessed; the bundle version is not a separate running-process attestation.

## Actual private stack

Normal entry at loopback web port 18490: login, music library, managed folder, lazy music-information action, actual-value editor, changed-title preview, save, accepted-job dismissal, job-result link and verified completion. The current indexed title became `S09 Chrome verified evening`. The real worker wrote the synthetic MP3 and gonic verified it; the subsequent private probe also confirmed unchanged audio payload. Existing cover and USLT values remained present. No real user media was used.

An earlier screenshot supplied by the user was from the previous server on port 18482. That connection error was separate from the S09 stack. The correct test tab was opened and the user confirmed it was visible; automated editor clicks then worked.

## Layout and keyboard

- Actual CSS viewports: desktop 1800 x 863, mobile 390 x 844 and strict 320 x 844.
- 390px editor is a full-height sheet with one named content scroller and visible footer. 320px year validation scrolls/focuses the invalid field, exposes aria-invalid and help/error association, and preserves visible cancellation/review actions. document scrollWidth equals clientWidth (320).
- A long KO/EN title repeated 16 times wraps in the 320px summary without horizontal overflow or clipped footer. The same summary was reviewed at 1800px.
- Tab from the final Save button returns to the named editor region. Escape cancels and returns focus to the original edit trigger. Unit regression covers removed-trigger fallback to the page heading.
- Actual Chrome zoom was increased with the native browser shortcut from 100% to 200%; the 1800 x 863 viewport became 900 x 431 CSS pixels. Summary remained scrollable and buttons visible. The final Usage basis input remained reachable and unobscured. Zoom was restored with the native 100% shortcut.
- KO/EN editor, summary and normal navigation labels were observed. Switching the UI to English left existing lyrics language `und` unchanged.
- Actual 320px history and job detail, and 390px verified detail, displayed all controls without horizontal clipping. Internal track identifiers were replaced with localized song numbering and the resulting DOM was verified.

## Deterministic state coverage

Normal app routes at source-only fixture port 18491, with its private control file outside the repository:

- loading: live status, no enabled edit action until lazy resource read completes;
- readonly and unsupported MP3 alternatives: disabled edit button plus localized reason;
- invalid year: inline field error and focus;
- cover variants: explicit target required before replacement, selected front only; local image preview;
- cover error: server upload rejection displays localized size/format help and retains selected preview;
- cover cancellation: changing the target removes the pending preview and clears the native file-input filename (verified after correction);
- lyrics variants: separate eng/kor entries; selecting kor preserves `Korean version`; explicit clear appears in review;
- busy: all review footer actions disabled during the delayed request, with live saving status;
- file_saved/reflecting: shows File saved and Checking library without a Library verified claim, plus reflection-mismatch explanation;
- succeeded: distinct file-save/library-verification labels;
- conflict: failed job, conflict item, current-information guidance and no file-saved label;
- failed: localized write failure and requery guidance;
- session expired: private job content disappears and the normal login screen announces expiration.

Fixture jobs for conflict/failure were seeded through its regular authenticated API; their history/detail displays were inspected in Chrome. The actual private stack golden path above was initiated in Chrome.

## Playback regression

On final edited source, normal fixture audio advanced through 0:13 at review, 0:19 during the delayed save, 0:31 after accepted completion and 0:40/41 after navigating to the job page. Player title updated to `Continuous playback verification`; the pause control remained active and time did not reset. Test playback was then paused through the UI.

## Manual verification and final approval

After final automated review, the user confirmed: “아니야 내가 수동으로 했는데 잘되는거 확인했어.” This confirms the remaining reduced-motion and touch checks as passed(user/manual), not automation. The final CRITICAL UI is approved(user). No checks are transferred to S11; its distinct real iPhone Safari scenarios retain their original owner.

Full review completed with FATAL0/MAJOR0 and review debt0. Screenshots were visually reviewed inline with DOM/AX observations; no screenshot-file export is claimed. Owned test services and the final test tab were cleaned up; the existing user gonic tab remains.
