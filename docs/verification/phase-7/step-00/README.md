# Phase 7 S00 — listening adapter

Implementation complete; no new public routes or product UI. Base: `5df0cf3`.

- Node 24.20.0 / npm 11.19.0; repository root; session-local toolchain.
- RED: listening-adapter 15 assertion failures for missing methods; compatibility 1 assertion failure for absent default-off keys.
- GREEN: `npm run test:unit -- apps/api/test/listening-adapter.test.ts apps/api/test/subsonic-client.test.ts`: 66 passed.
- `npm run test:contract -- tests/contract/listening-compatibility.test.ts tests/contract/subsonic-parity.test.ts tests/contract/gateway-parity.test.ts`: 47 passed.
- `npm run typecheck`, `npm run build`, `npm run format`, `npm run format:check`: passed (exit 0). Build retains the existing >500 kB bundle advisory.
- Real loopback HTTP proves single-song scrobble submission and one request after disconnect/header timeout/body timeout; no retry or now-playing API.
- Strict independent genre, artist-info, stream-metadata and extension decoders. Artist URLs discarded. Existing media request builder unchanged.
- Frozen pre-P7 decoder ignores new keys; registry automatically defaults new keys off. Web exhaustive feature map also explicitly false.
- Serena reference audit found no full-interface test factories requiring stubs; workspace typecheck confirms compatibility.
- No visible copy or locale key changes; no UI/Gallery impact. P7-UA-001–007 remain pending in the vault; no new acceptance item for adapter-only work.
- No live gonic/browser/production deployment claims; those remain with later owners. All loopback fixture servers closed by teardown.
- Rulebook context: no directly relevant adapter safeguard; postflight skipped(no_new_lesson), no canonical writes.
