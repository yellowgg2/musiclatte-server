# Phase 2 Step 11 verification

Date: 2026-09-06–07

Branch: `yellowgg2/tdd/phase-2/step-11-devserver-musiclatte`

Status: complete

## Environment and isolation

- The existing devserver demo remained on gonic v0.22.0 with its original container, listener,
  volumes, and music path. It was never restarted, replaced, or included in Compose cleanup.
- The Step used the isolated Compose project `mlstep11-mmnmnj` from the private mktemp worktree
  `~/musiclatte-step11.mmnmnJ`, with gateway port 28080 and loopback-only gonic administration port 14748. The web/API test origin connected to the existing demo only for cross-client state.
- The remote host provides Docker 23.0.2 and Compose 2.17.2. Host Node was not used for builds;
  container builds verified Node 24.20.0 and npm 11.19.0, matching the local project toolchain and
  deployment images.
- Credentials, authentication queries, opaque resource IDs, and real song metadata are excluded
  from this evidence.

## Defects found and fixed

- A full-suite-only authorization test race used a fixed 50 ms response delay. RED reproduced the
  nondeterministic boundary; GREEN replaced it with an explicit response promise gate released
  only after logout completed.
- The production web Dockerfile omitted `apps/web/public`, so the login and shell brand icon
  returned a missing asset. A deployment contract failed first, then the public directory was
  copied into the web build. The rebuilt devserver icon returned HTTP 200 as a nonempty PNG and
  both placements rendered in Chrome.
- Playlist rows rendered favorite and occurrence groups as separate block rows, producing a
  staggered control column. A focused layout contract failed first; `MusicRow` now aligns both
  groups in one flex rail. The rebuilt wide Chrome view showed play, favorite, move, and remove
  controls on one line for every occurrence.

These are owner-Step defect fixes, not new Step 11 product scope. They add no shared component,
token, route, schema, localization key, or Gallery baseline change.

## Automated and connected results

- Fixed-toolchain full gate: 28 unit files / 284 tests and 14 contract files / 111 tests passed.
  Typecheck, production build, and `format:check` passed.
- Connected Chrome created an empty Step-owned playlist, renamed it with trimmed outer spaces and
  preserved special characters, added `[A, B, A]` through search multi-selection, removed only the
  second `A` occurrence, reordered the remaining entries to `[B, A]`, and starred `B`.
- Playlist playback streamed through the shared player and was then paused. The delete dialog
  described playlist-only deletion; cancel retained both entries and the current queue.
- Restarting only the Step-owned API preserved the authenticated playlist view. Replaying the same
  applied append operation returned the recorded three-entry outcome without duplicating entries.
- A management-only online backup restored to a new offline path with equal applied-receipt count,
  equal session policy revision, and `PRAGMA quick_check = ok`.
- The isolated gonic indexed the read-only music mount. A stopped whole-stack snapshot contained
  gonic data/playlists/podcasts plus management data/keys. Restoring it into a fresh Compose project
  and fresh volumes preserved playlist ID, name, `[A, B, A]` order, duplicate occurrence, and the
  applied operation receipt; replay again left exactly three entries.
- The verified restore project, its fresh volumes, and its private temporary snapshot were removed.

## Native round trip and conflict recovery

- The user refreshed the Step-owned playlist in Musiclatte 1.7 (build 17) on an iPhone 12 Pro and
  confirmed the same playlist identity, two-entry order, and favorite state shown by the web app.
- Native playback succeeded after installing the current app build. The user moved one occurrence
  and removed the Step-added favorite; a fresh Chrome session then showed the native order and
  unstar result while retaining the favorite that existed before this Step.
- Two Chrome tabs loaded the same revision. One renamed the Step-owned playlist, then the stale tab
  attempted an occurrence move. The stale write did not reorder an entry: the UI displayed the
  current renamed snapshot and its explicit conflict/refresh recovery state. The temporary name was
  restored afterward.
- Live writes used the mutable demo account only. Cross-account favorite and playlist ownership
  isolation remained covered by the Step 03–05 automated identity fixtures; no second live account
  or existing user resource was modified.

## Final deletion and cleanup

- The final delete first revalidated the exact Step-owned ID, name, and two-entry snapshot. The BFF
  returned HTTP 200, the target disappeared, and the pre-existing playlist projection was unchanged
  after excluding per-read revision data.
- Playback was active before deletion. After navigating to the remaining playlist list, the shared
  player retained the same current item and advancing playback position. A post-delete range request
  to the existing demo returned HTTP 206, confirming that media remained streamable; playback was
  then paused.
- The Step-created favorite was removed and the pre-existing favorite remained, restoring the
  remembered starting star state.
- The isolated Compose project, all six project-scoped volumes, its network, private worktree,
  gateway and administration ports, and SSH tunnel were removed. The existing demo container remained up on its
  original listener, and its music path remained present. No existing service or volume was
  restarted, replaced, or included in cleanup.
