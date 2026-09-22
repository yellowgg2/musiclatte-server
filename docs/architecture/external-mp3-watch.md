# External MP3 watch

Phase 18 adds an opt-in path from a newly copied MP3 to the existing recent-download ledger. It does not backfill a library, move files, edit tags, create synthetic import jobs, or change the recent API/web schema.

## Policy and account ownership

Import policy schema v1 remains valid and always disables external watching. Schema v2 requires an explicit `watchExternalMp3` boolean on every library; only `true` enables the feature. The example stays false so copying it cannot start observation accidentally.

For an enabled library, every allowed username is converted by the same portable name sanitizer used for account imports. The watched account directory is exactly `<relativeRoot>/<sanitized username>`. Startup rejects empty owner sets and collisions. The API, which already owns the signing key, projects `(library, account directory, username, identity key, instance, policy revision)` into management storage. The worker never mounts or reads that signing key. A missing, stale, additional, or inconsistent projection closes watchers and retries with a bounded `config_mismatch` diagnostic; it never guesses an owner.

No public/shared directory is watched. Recursive traversal starts at the exact account root, rejects replacement roots and symlink components, and considers only regular `.mp3` files (case-insensitive extension). Paths remain validated library-relative keys; absolute paths, names, usernames, identity keys, and tags are absent from public output and ordinary diagnostics.

## Baseline, discovery, and stability

The first completed traversal is a baseline. Every file in that atomic snapshot is historical and never becomes a DownloadEvent. A versioned directory continuation still yields after 256 entries or 50 ms, while MP3 keys and lossless fingerprints accumulate only in a process-local snapshot capped at 100,000 entries per root. Traversal does not update observation rows. Only a successful full traversal and final root identity check call one delta transaction for new paths, changed settling/absent candidates, missing settling candidates, and root completion. Unchanged rows—including `last_seen_at` and generation—receive no update; root `scan_completed_at` is the completed-scan freshness source.

A persisted continuation without its matching process-local snapshot means the process restarted during traversal. The root generation is advanced and traversal restarts from the account root; the incomplete traversal is never used to infer absence. Root replacement, unreadable entries, abort, and capacity failure discard the in-memory snapshot without changing existing observations. A native watcher remains only a wake-up hint, and later full traversal remains the correctness source.

A new path must have the same device, inode, size, nanosecond mtime/ctime, and link count in two different observations at least 10 seconds apart. The validator opens without following symlinks, requires one nonempty bounded regular link, probes a generic MP3 audio stream through the opened descriptor, and compares opened/after/visible identity. A changed file returns to settling; a static invalid file receives bounded retry instead of a hot loop.

The `(library, relative path)` observation is path-once. Later edits, atomic replacements, deletion/recreation, metadata saves, and organization moves do not manufacture another external download. Existing import intents/events, metadata work, and organization source/target evidence close the candidate as internal.

## Event admission and Gonic registration

Admission atomically creates or reuses a same-library unavailable MediaLink, inserts a provenance `external` DownloadEvent with no ImportItem, and pins both IDs on a `registering` observation. `downloadCompletedAt` is the successful admission clock—not filesystem, tag, or Gonic time.

External targets share the existing singleton scan coordinator and exact path lookup with imports. Import download/publish and import registration have priority. One external scan cycle leases at most 50 targets and matches the configured music folder, relative root, directory segments, and full track path; title/tag matching and cached-ID guesses are forbidden. Completion rechecks the lease generation, event/media/path, fingerprint, file presence, and current binding before atomically marking the MediaLink available, event registered, and observation ready.

Zero/ambiguous matches, malformed paths, upstream failures, timeouts, file changes, and conflicting existing song IDs preserve history with a closed failure code. Registration retry starts at 30 seconds, doubles, and caps at one hour. Existing Gonic IDs are never overwritten by an ambiguous result.

## Runtime, recovery, and limits

The external scheduler is an optional idle task inside the serial import worker—not a competing unbounded loop. One inventory slice, one admission claim, or one registration batch runs at an import idle boundary, followed by the existing abortable event-loop yield. Settling and registration due checks use a five-second boundary; durable row times, generation leases, and coordinator ownership remain authoritative across restart.

SIGINT/SIGTERM stops new claims, aborts active ffprobe/Gonic requests, closes watchers, and leaves durable state recoverable after lease expiry. Worker heartbeat remains idle during external work and never stores an external pseudo item as the active import item.

The recent reader remains account/library scoped. Before registration it returns `registering`; after exact registration and current file/getSong validation it returns `ready`; deletion, Gonic code 70, ID change, or path mismatch returns `missing`. The response never exposes provenance, path, or owner, and history is not deleted when availability changes.

Operational activation and rollback are documented in [External MP3 watch operations](../operations/external-mp3-watch.md). Automated evidence is under `docs/verification/phase-18/`.
