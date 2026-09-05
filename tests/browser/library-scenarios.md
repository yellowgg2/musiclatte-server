# S08 library browser scenarios

Run the real S03/S07 API against the deterministic synthetic upstream, then use connected Chrome and the normal login entry. Ports 3000 and 5173 must be free.

```bash
export PATH="$HOME/.cache/musiclatte-toolchain/node-v24.20.0-darwin-arm64/bin:$PATH"
PREVIEW_CONTROL=/tmp/musiclatte-s08-control node --import tsx tests/support/library-preview.ts
```

Run `npm run dev:web -- --host 127.0.0.1` separately. Open `http://127.0.0.1:5173/login`; the synthetic account is `password` in `tests/support/auth-harness.ts`. Keep real account values and metadata out of saved evidence.

1. Log in → Music → My music → Daylight folder. Open a song; follow artist and album links. Back restores location/filter/scroll; reload keeps the deep link.
2. Search `한글 & Café + 100%` using Enter. Check original query, URL encoding and artist/album/song sections. Clear and submit to see the field error. Search `empty` for no matches.
3. Submit `old` then `new` before the delayed response arrives. After 2.5 seconds only Newest result remains. Back/forward and reload restore the appropriate query/result.
4. Open Empty folder and use its parent breadcrumb. A `/music/folders/missing` deep link shows localized not-found recovery.
5. Write `error` to the owned control file and reload. Header/search remain available. Change to `loading`, press retry and inspect loading; change to `normal` and retry for recovery. `empty` and `missing` also force those states. These controls exist only in the standalone test harness.
6. Review KO/EN at 1800×863, 390×844 and 320×844; long open/closed titles, missing metadata, independent result pagination, last row above mobile navigation and no horizontal scrolling. Verify native details keyboard activation and named artist/album links.
7. Review 200% native Chrome zoom and reduced-motion. Reset both. At `/__dev/gallery#music-row`, the actual shared MusicRow has the same long/missing fixtures as the feature. Expanded header-to-link gap is 12px, bottom padding 16px; summary focus outline is inset.
8. Unit tests own independent offset and uncancellable late-response assertions; contract tests run the actual S07 API through the web decoder. No audio action is enabled until S10.

Actual upstream validation may use a private local API plus an owned SSH tunnel to the existing demo after checking ports. Use normal login and read-only folder/search/artist/album interactions. Record counts and outcomes only, never titles, IDs, authentication queries or screenshots of personal metadata.

Stop only owned processes, remove the owned control file, reset viewport/zoom/motion and close owned tabs. Shutdown deletes fixture storage. See [S08 evidence](../../docs/verification/phase-1/step-08/README.md). S06 browser scenarios describe the historical settings-only milestone; S08 supersedes its default entry and music-unavailable expectations.
