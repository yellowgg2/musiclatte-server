# Imports browser scenarios

Run Node 24.20.0/npm 11.19.0, `PREVIEW_CONTROL=/tmp/musiclatte-import-mode node_modules/.bin/tsx tests/support/import-preview.ts`, then `npm run dev:web -- --host 127.0.0.1`. Ports 3000 and 5173 must be free. The loopback-only preview delegates login/music/player to the existing synthetic BFF harness. Use that harness's synthetic account; no real credential or downloader is needed.

Open `/imports`, sign in through `/login`, and return to the normal product route. Control modes: `normal`, `empty`, `invalid`, `loading`, `partial`, `registering`, `restart`, `denied`, `unavailable`, `error`. Re-enter through Settings → Imports or reload to reset route-owned state. Normal/empty/invalid begin empty; enter invalid links through the actual field. Loading delays history three seconds. Restart represents durable registering work after restart, without running a real worker.

1. Paste one/two individual video links; submit by button and Ctrl/⌘ + Enter. Invalid URLs focus the field, show linked help, and produce no request. Accepted jobs progress through observed stages, then ready/partial. URLs never enter navigation or storage.
2. Two submitted items end with one ready and one failed. Retry the failed item: verify child job/original anchor and preserved success. Cancel a running child: Escape/Keep importing restores focus; confirmation explains published songs remain; requested and cancelled differ.
3. Reload and verify identical job IDs. Leave during a pending read; it cannot reappear on Settings. Focus/visibility/network/account races also have fake-timer tests.
4. Denied direct entry hides Imports navigation and offers Back to music. Unavailable retains route meaning and Try again. Restore normal mode and recover on focus or Try again.
5. Start synthetic music, open Imports and change language. Player/queue survive. At 320px scroll to the last retry; player/nav must not block it.
6. Review KO/EN at 1800×863, 390×844, 320×844, actual Chrome 200% zoom, reduced motion, and a 320×480 shortened viewport representing space with a keyboard. Use visible controls, not app-state injection. Restore zoom/motion/viewport, close only the task tab and stop only preview processes.

Evidence: [Step 10](../../docs/verification/phase-3/step-10/README.md). Actual worker/download/gonic/device integration remains Step 14.
