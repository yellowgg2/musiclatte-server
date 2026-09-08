# Phase 5 live acceptance environment

Prepared2026-09-08 on the user's explicit request for the latest physical app and devserver installation. This is an isolated LAN acceptance environment retained for user review, not production/DNS deployment.

## Build and installation identity

- Server source `de340221a65dbce7b55a7a9b68836be145cde25f`; clean source-only Git archive built on devserver. Node24.20.0/npm11.19.0, pinned gonic0.22.0.
- Native source `c0e3cda8bbf0e045fd5627d3e24db5ad0333b9c6` plus contrast correction diff `4e9ec651dc98db2607d2c9b2e72c8244baeeadc66f629e3e2c93855bf56773c4`. The user's existing project platform settings are preserved.
- Signed current Debug app installed on physical iPhone12Pro/iOS26.6.1; device inventory confirms Musiclatte1.8 build18. Device app launch is blocked by passcode lock; no physical connection or user acceptance is inferred.

## Runtime ownership and configuration

- Project `musiclatte-p5-acceptance`; remote root `/home/yellowgg2/.local/share/musiclatte/p5-acceptance-20260908`.
- LAN gateway `http://192.168.129.119:18517`; admin18515 and gateway18516 are loopback-only. Native profile uses the gateway origin without an `/api` suffix.
- Compose base + imports + metadata + LAN-development overlays. API, web, gonic, import worker and metadata worker are healthy, non-root services using independent project volumes. Host Node22 was not changed.
- Before LAN publication, default administrator authentication was replaced and verified rejected. Configured administrator/listener authentication succeeded. Credentials/policies remain in private files outside checkout/Docker context; no values are recorded here.
- Dedicated owned music directory contains three120-second source-generated MP3 fixtures with fictional titles and embedded purple artwork. No actual user music was read or modified.
- Three recent-history fixture entries were added through the production import/media-link repository state transitions while the owned import worker was paused, then worker resumed healthy. These are explicitly seeded test history, not evidence of a real YouTube download.
- Listener has browsing, streaming, recent, random, playlists and metadata permissions. Scan remains denied for that non-admin role; no denial bypass was added.
- Existing `gonic-demo`4747 remains running with restart count0. No existing service, volume or library was replaced.

## Verification

- Real same-origin discovery, native bearer session exchange, capabilities and recent endpoint succeeded; three ready songs returned.
- Actual gateway MP3 byte-range request returned206 with1024 bytes. This is transport evidence, not a physical audible result.
- Actual native Simulator test passed1/1, failed0/skipped0: ordinary login to LAN server → recent entry → generated song → normal relaunch without fixture arguments → saved connection restored. iPhone13mini/iOS26.5; private result `~/.cache/musiclatte-companion/phase-5/live-handoff-20260908/live-simulator-final.xcresult`.
- Earlier private test runs are not counted: one runner terminated; subsequent runs exposed unreliable clearing of saved field contents and the system Passwords save offer covering the target. Test setup now starts with empty input overrides, checks typed values, declines the optional system Passwords save offer and waits for hittability. No application behavior or permission boundary was changed to pass the test.
- App code and actual wire decoders are production composition, not `--companion-fixture` responses. This covers only the custom listener profile; stock/Airsonic/full-account matrix and all physical sensory/VoiceOver checks remain pending.

## Handoff and cleanup

The user must unlock the specified iPhone to complete its actual app connection. A signed private device-test build is available; no passcode or permission boundary is bypassed. Connection information is in a0600 local private file, not Git/evidence. Original ignored credential sources are unchanged.

The isolated remote stack, synthetic files and private configuration remain running/retained specifically for user acceptance. Do not clean this stack until user review is complete or cancelled. Cleanup is restricted to this project and root; preserve gonic-demo4747. All local build/test commands completed; owned Simulator is shut down. No commit, push, registry publication or DNS change.

## Import fixture cleanup — 2026-09-09

On the user's removal request, removed the manually seeded synthetic import job (1), its ready
items (3), and linked download events (3). Their 14-character synthetic source IDs failed the web
import decoder's 11-character video-ID contract. This was manual acceptance seeding, not default
installation data. A private 0600 rollback snapshot of removed rows was retained in the management
volume. Cleanup used a guarded transaction and foreign-key validation without stopping services.
Authenticated imports GET now returns 200, zero jobs, one allowed library and a valid web response
shape. Existing media links and music files remain; this cleanup removes import/recent history only.
All acceptance services remain healthy and the existing gonic demo remains running.
