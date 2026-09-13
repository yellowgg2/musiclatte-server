# Phase 16 Step 03 verification

## RED route and ownership inventory

The authenticated Router mounts every page below inside `AppShell` `.content`. Before GREEN, the
shell owned a 32px desktop/16px narrow inline gutter, while seven feature roots added their own
outer inset.

| Route family                     | Root stylesheet                | Baseline outer layout                         | GREEN decision                                 |
| -------------------------------- | ------------------------------ | --------------------------------------------- | ---------------------------------------------- |
| `/music` and folder/search/album | `Music.module.css`             | padding 24px; narrow 16px                     | remove duplicate padding                       |
| `/music/favorites`               | `FavoritesPage.module.css`     | padding 24px; narrow 16px                     | remove duplicate padding                       |
| `/music/recent`                  | `RecentDownloads.module.css`   | padding 24px; narrow 16px                     | remove duplicate padding                       |
| `/music/curation`                | `CurationPage.module.css`      | padding 24px; narrow 16px                     | remove duplicate padding                       |
| `/music/history`, `/music/top`   | `Listening.module.css`         | padding 24px; narrow 16px                     | remove duplicate padding                       |
| `/music/mixes` and mix detail    | `Mixes.module.css`             | padding 24px; narrow 16px                     | remove duplicate padding                       |
| metadata list/detail             | `MetadataJobs.module.css`      | padding 24px; centered max-width 64rem        | remove padding and centering; retain max-width |
| `/playlists` and detail          | `Playlist.module.css`          | no root padding or centering                  | unchanged regression baseline                  |
| `/imports`                       | `Import.module.css`            | max-width 58rem; no root padding or centering | retain readable max-width                      |
| `/settings`                      | `Shell.module.css` `.settings` | max-width 46rem; no root padding or centering | unchanged readable max-width                   |

The RED test replaced the stale per-music-page 24/16px padding expectation and failed on all six
music roots plus metadata padding/centering. The existing shell ownership assertion passed.

## Canonical gutter

- Desktop authenticated content: `AppShell` `.content` owns `padding: var(--space-6)` (32px).
- Narrow authenticated content: `.content` owns 24px block start, 16px inline, and the existing
  bottom-nav/player/selection/safe-area calculation.
- Feature roots keep their grid, gap, width/min-width, readable max-width, and inner surface spacing.
  They do not add top-level outer padding or unrequested centering.

## RED and GREEN evidence

- RED: the replacement source contract failed for all six music page roots and metadata because they
  still declared page-level outer padding; metadata also centered its top-level wrapper.
- GREEN: the feature roots now retain their internal grids, gaps, controls, and readable max-widths
  while leaving the outer inset to `AppShell`.
- The source contracts passed with 24 tests across `login-shell.test.tsx` and
  `listening-ui.test.tsx`.

## Connected Chrome rect matrix

Chrome 152 used the normal production Router with a loopback Fastify/session fixture. Only synthetic
identity and collection data were used. Expected 403/404 responses from intentionally unimplemented
preview feature endpoints exercised the same route shells in their error states.

| CSS viewport / zoom        | Routes checked                                                 | Heading start | Horizontal overflow |
| -------------------------- | -------------------------------------------------------------- | ------------: | ------------------: |
| 1800px / 100%              | all 12 target routes                                           |         272px |                 0px |
| 1024px / 100%              | music, playlists, imports, settings, history, recent, metadata |         272px |                 0px |
| 390px / 100%               | all 12 target routes                                           |          16px |                 0px |
| 320px / 100%               | metadata detail and recent representative states               |          16px |                 0px |
| 320px / actual Chrome 200% | recent error state                                             |          16px |                 0px |

The 12-route matrix covered `/music`, `/playlists`, `/imports`, `/settings`, `/music/history`,
`/music/top`, `/music/recent`, `/music/favorites`, `/music/mixes`, `/music/curation`,
`/metadata-jobs`, and `/metadata-jobs/job-1`. At desktop width, `/music` and `/playlists` both
started exactly 32px after the 240px sidebar. Primary navigation rows remained at x=12px, width
214px, and height 48px. At 390px every route used the shell's 16px inset. At 320px with Chrome's
actual zoom indicator showing 200%, the account trigger remained in the accessibility tree and the
document still reported zero horizontal overflow.

The existing AppShell player/selection/navigation clearance variables were not changed. The focused
library, listening, playlist, and recent suites exercise those consumers, including narrow reflow,
selection clearance, and player persistence. Final visual preference, Safari safe-area behavior,
and hands-on player/selection coexistence remain deferred to P16-UA-004 and the existing P1 owner.

## Final automated gates

- Runtime: Node 24.20.0 and npm 11.19.0 from the pinned project-local toolchain.
- Focused unit suite: 73 passed across login shell, library, listening, playlist read, and recent UI.
- Focused contract suite: 13 passed across login shell, library UI, and production exclusion.
- `npm run typecheck` — passed.
- `npm run build` — passed; the existing Vite chunk-size advisory remains non-blocking.
- `npm run format:check` — passed.
- `git diff --check` — passed.
- Serena diagnostics for changed TypeScript files — no warnings or errors.
- Agent Rulebook postflight: `skipped(no_new_lesson)`; this was the planned application of the
  existing single-owner layout rule.
