# Saved mixes normal-route fixture

Use `tests/support/mix-preview.ts` with free PORT/WEB_PORT and Vite's loopback-only MUSICLATTE_PREVIEW_API_TARGET. Synthetic login inputs remain in auth-harness, never copied into evidence.

Actual Chrome run evidence: docs/verification/phase-7/step-03/README.md.

Login → Music → Saved mixes → enter name, root, exact genre, album years and size → Save → reload. Verify conditions restore and player is idle. Find songs → Play now → Add to queue; shown results are the activation input. Check duplicate queue occurrences and preserved shuffle/repeat. Optional PREVIEW_CONTROL file accepts normal, empty, conflict, error or loading for isolated upstream states. Removed registered root and stale revision show conflict; empty results preserve the queue. Sign out clears transient UI; sign in restores saved conditions. Confirm deletion returns the empty list.

The preview uses real API/auth/storage and synthetic upstream, not an alternate product renderer. Final visual, VoiceOver and Safari device acceptance remains deferred.
