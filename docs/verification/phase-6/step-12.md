# Phase 6 S12 — Curation web

Added `/music/curation` through the existing Music area (no new bottom navigation item), with library/format/required-review/optional-field filters, frozen snapshot counts and pagination, coverage, verification state, and current detail/receipt/attempt summaries. Completed review and missing/unavailable lyrics remain independent. The existing metadata editor consumes the same current curation detail. Existing MusicRow/Artwork/Action/LanguagePicker/StatusSurface and metadata editor/job results are reused; no shared primitive changes.

The strict read client consumes the real S06 policy/list/detail DTOs with cookie credentials and independent API origin. Filter generations abort obsolete reads and reject mismatched snapshot pages; expired or scope-invalid snapshots clear old rows and require a fresh list. Session/instance/policy identity keys isolate consumers. Curation navigation does not create or merge selection scopes. Playback uses the actual music-song DTO on explicit activation; the existing player provider survives filtering, locale changes and routes. Accepted P4 work/change-feed results refresh list/detail through the existing metadata sync version. List refresh restarts pagination deliberately; current detail is distinct from frozen list membership.

## Verification

- RED: an assertion showed that a subsequent snapshot page could change the frozen count. Added the count/time/snapshot invariant guard and recoverable restart state; the assertion then passed. Initial missing-module output was a setup failure, not counted as behavioral RED. GREEN: stale generation and mismatched snapshot rejection, independent completed+missing filter serialization, production Router list/page/filter/editor/coverage/expiry, exact unresolved old-filter response, authorization loss, optional job/change-feed refresh and retained completion, playback position/identity across locale/filter changes.
- Real Fastify HTTP contract: strict policy → completed+lyrics-missing list → detail/receipt, frozen page and expired cursor error; existing token issue/list/revoke/denial contracts retained.
- Existing metadata-single, metadata-sync and player tests run alongside current tests. Full Phase verification is recorded below after completion; skipped tests are not counted as passing.
- Source-only fixture marker exclusion is checked in production assets, source maps and source-only build contexts. Harness code is outside product routes and Docker contexts.

## Actual Chrome functional evidence

Used the normal production Router via `automation-ui-harness.ts --port 18726 --scenario curation --control-file <owned temp file> --audio-file <owned synthetic MP3>`. The fixture supplies synthetic HTTP states; a newly generated 180-second sine MP3 (FFmpeg 9.0.1) supplies actual audio and Range responses. This browser fixture does not claim to write real MP3 tags: actual file/write/restore/HTTP automation is separately verified in S10.

1. Normal list displayed 25/27 rows, Load more expanded the frozen snapshot. Completed + Lyrics Missing produced 25/25, excluding the unreviewed-required and unavailable-source examples.
2. Existing Music information action opened the existing editor with Required review completed, title/artist required, optional fields and receipt summary. Editing album/lyrics, reviewing and saving used the production metadata client; the metadata change feed refreshed the list. Completed + Lyrics Present then showed only the enriched song; its required completion remained intact.
3. Actual MP3 played continuously across Back to music → Music curation, filters, editor and job routes. Accessible seek values progressed 0:04 → 0:08 → 0:44 → 1:20 → 1:50 → 2:19. KO locale switched without losing filters and seek reached 2:27; no second playback activation was needed.
4. Claim-conflict mode showed Failed / Conflict with the existing localized reservation message. Partial-failure mode showed Partially completed, Song 1 verified and Song 2 write failure independently. These are synthetic result branches, with actual admission and partial HTTP semantics separately covered in S08–S10.
5. Expired snapshot removed old rows and displayed Reload current list. Resuming with partial inventory plus unsupported-format filter showed zero matching tracks and explicit unfinished coverage (27 discovered, 1 verified, 26 unknown), rather than a complete-library claim.
6. Unit tests own precise abort/late-response assertions and denied-scope row removal. Current production Router tests use the same typed source-only fixture, with real Fastify contract tests separately checking producer parity.

Owned Chrome tab, harness, generated MP3 and temporary control files are cleaned after verification. Existing devserver services and volumes remain untouched. Gallery changes none; feature-local CurationPage/CurationStatus/state/client only. Final visual/reflow/contrast/VoiceOver/Safari acceptance P6-UA-001–004/006 stays pending. Rulebook postflight skipped (no new lesson).

## Final Phase gate

2026-09-09, repository root, session-local Node 24.20.0 / npm 11.19.0:

- `npm run test:unit`: 78 files, **767 tests passed**, exit 0.
- `npm run test:contract`: 35 files, **166 tests passed**, exit 0, including real Docker nginx gateway parity. Local Docker was initially stopped; starting the installed Docker runtime resolved the environment failure. All test-owned gateway containers/networks were removed by their harness. Existing services were not stopped or replaced.
- `npm run typecheck`, `npm run build`, `npm run format:check`: exit 0. Vite reports its non-failing >500 kB chunk advisory; no production deployment performed.
- Previous P4 contract expectations that automation consumers were still closed were updated to the now-implemented S11/S12 flags; strict malformed descriptor checks remain intact.
- Final scope audit: S00–S12 implementation/automated verification complete. PAT/grants/cursor/claim invalidation with ordinary-session preservation and actual MP3/HTTP restore/runtime evidence remain in S10. P6-UA-001–007 remain pending (007 optional); implementation completion is not final visual/user acceptance.
