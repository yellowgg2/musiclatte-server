# S10 Chrome interaction evidence — 2026-09-08

Chrome installed bundle 152.0.7977.83; existing Chrome extension session. Production React routes served by the source-only synthetic harness on localhost:18501. Browser screenshots and DOM/accessibility snapshots were inspected inline; no exported screenshot artifact is claimed. Native window accessibility later failed with `cgWindowNotFound`; browser DOM/interaction remained available.

| Scenario                               | Observed result                                                                                                                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KO folder → select three → bulk editor | Common artist/album, mixed title/track; untouched mixed fields omitted; explicit album clear and year set only in summary                                                                     |
| Partial write                          | Two verified, one failed; fresh snapshot/original intent review includes only failed C; new one-item retry verified                                                                           |
| EN playlist [A,B,A]                    | Three selected occurrences, two unique files; summary has two revision entries                                                                                                                |
| Unavailable                            | Read-only C and reason visible; group disabled until explicit exclusion; editor names excluded C                                                                                              |
| Cross-library                          | Group buttons list member song titles; choosing C gives one target and explicitly excludes A/B                                                                                                |
| Conflict                               | Final fixture: two verified, C conflict with text explaining external change; retry review shows only C, current year 2026, original set 2028 and fresh revision; child job one item verified |
| Locale                                 | KO/EN flows rendered; affected unit test also rerenders locale during an active dirty/clear draft and preserves it                                                                            |
| Desktop/mobile                         | 1800×863, 390×844, strict 320×844; actual DOM widths checked against scroll width                                                                                                             |
| Long content                           | Mixed Korean/English long album value wraps at 320px; one named content scroller; final Save reachable                                                                                        |
| 200% zoom                              | Native zoom keys at 1800×863 yielded actual CSS viewport 900×431; last usage-basis field reachable; reset yielded CSS width 1800                                                              |
| Keyboard/focus                         | Initial named-region focus, Tab wrapping, cancel restores toolbar; accepted Save restores bulk action; job navigation focuses heading                                                         |
| Playback                               | Final production source: Seek advanced 0:40 before save → 1:00 after save → 1:07 after job navigation, same track playing; selection stayed at three                                          |

## Findings fixed

- MAJOR: four narrow toolbar columns at 390px broke button labels. Feature-local two-column layout at <=48rem, one column at <=22rem. Rechecked 390px and 320px; strict width/scroll both 320.
- MAJOR: short mobile review content left the footer in the middle of the sheet. Content now flexes with start alignment. Final 390×844 screenshot shows Cancel/Back at y728–772 and Save at y784–828, within the viewport and at the bottom.

No shared primitive/token change or Gallery reapproval. Full passed: FATAL0/MAJOR0/debt0; the following remaining interaction checks passed(user/manual) on 2026-09-08.

## Completed manual checks (S10 only)

At localhost:18501, Music → Studio collection → Studio collection → Select songs → Select this page → Edit shared music information → Edit library 1:

1. Chrome device toolbar touch mode, mobile viewport: scroll to the last field and tap Review/Cancel; verify controls remain reachable, tapping works and the sheet/player/navigation do not overlap.
2. Chrome Rendering panel, emulate prefers-reduced-motion: reduce: open/close the editor and review sheet; verify motion is reduced and focus/scroll controls continue working.

Native window control failed repeatedly. The user explicitly confirmed these S10 checks with “어 잘되”; passed(user/manual), no deferral. S09 confirmation remains separate. Current viewport override and zoom were reset for handoff. The synthetic conflict fixture intentionally reports C as conflicted on an initial bulk save and lets the one-file retry succeed.
