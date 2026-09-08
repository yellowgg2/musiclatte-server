# Import input, policy, file and process boundaries

Phase 3 Step 02 provides server-only helpers for the future API and worker. `createConfiguredApp`
probes import configuration before opening storage. The reusable downloader/worker is now implemented by Step 03 (see `import-worker.md`); no production
worker entry, import HTTP route or capability producer is connected yet. P3 capabilities and web client features remain false.

## URL and policy

`parseYouTubeSource(input)` is pure and returns an 11-character video ID plus a newly constructed
`https://www.youtube.com/watch?v=ID` URL. Accepted spellings are HTTPS watch URLs on youtube.com,
www.youtube.com, music.youtube.com and m.youtube.com; those hosts' `/shorts/ID`; and youtu.be/ID.
Only one video selector is allowed. Optional bounded `t` and `si` values are discarded. Unknown or
duplicate parameters, playlist/index selectors, channel/search/redirect routes, fragments (including
empty fragments), ports (including explicit 443), userinfo, encoded paths, dot segments, backslashes,
whitespace and arbitrary hosts fail with `invalid_source`. Short URLs are parsed locally, never
followed over the network. The later worker must pass the reconstructed canonical URL, never raw input.

`loadImportPolicy(path, enabled)` accepts strict schema version 1 JSON:

```json
{
  "schemaVersion": 1,
  "libraries": [
    {
      "id": "library-1",
      "musicFolderId": "1",
      "relativeRoot": "owner/imports",
      "allowedUsers": ["alice"]
    }
  ],
  "engineManagers": ["operator"]
}
```

The loaded result and all nested arrays/objects are frozen. Unknown fields, repeated library IDs,
repeated users within a principal list, malformed identifiers, unsafe relative keys and overlapping
roots fail with `invalid_import_policy`. Root overlap comparison conservatively uses NFC and lowercase,
even across music folder IDs, since different upstream folder IDs can alias a physical mount. Sibling
roots such as `owner/imports` and `owner/imports-other` remain distinct. The same account may belong to
several libraries; account matching itself is exact and case-sensitive. Empty allowlists deny access.
`resolveLibrary(policy, username, libraryId)` returns only the configured library mapping or
`library_denied`; clients cannot supply a filesystem path.

`readImportConfig(env)` defaults `IMPORTS_ENABLED` to `false`. Disabled mode does not read a policy
file or require worker credentials. Enabled mode requires `IMPORT_POLICY_PATH` (absolute),
`IMPORT_WORKER_USERNAME` and `IMPORT_WORKER_PASSWORD`. Invalid booleans, missing values and unreadable
or invalid policy files fail with `invalid_import_config`. API startup retains its existing generic
configuration error. The returned credentials are server-only and must never enter logs, DB fixtures
or API responses. The future worker owns credential use, `WORKER_STAGING_ROOT` provisioning and engine
configuration; Step 09 owns mounting the policy and separating worker-only secrets.

## File keys and publication

`validateRelativeKey` rejects absolute paths, empty/dot segments, repeated separators, backslashes,
colon/control characters, trailing dot/space aliases and excessive UTF-8 lengths. It does not silently
normalize unsafe keys. Only the server-side `resolveFileKey` returns an absolute path.

New API jobs persist a server-derived, sanitized `accountDirectory` (schema v13). Their path is:

```text
relativeRoot/account/channel/title.mp3
```

`relativeRoot` remains the configured import-library boundary. For example, `imports/listener/Channel/Song.mp3`.
Channel and title no longer receive source-ID suffixes. NFC normalization, unsafe character replacement,
Windows device-name handling and the 160 UTF-8 byte segment limit are retained from the existing sanitizer.
Separators become `-`, double quotes become single quotes, and `?*<>` are removed; ordinary punctuation
is retained. Sanitized account aliases cannot be assigned to different identities within a library.

Jobs predating v13 have no account directory and retain their original ID-suffixed path and duplicate
recovery behavior. Existing media is never migrated or renamed. Retries retain their original job's account.
New operations can download a completed source again. Concurrent requests for the same source in the
same account share the active item; separate accounts download independently. Operation-ID replay remains idempotent.

Roots must be canonical directories. All components are checked for symlinks and parent identity;
staging and music roots must be disjoint. The worker verifies nonempty MP3 audio and embedded source ID
before copying to an exclusive `.import-UUID.pending` beside the destination and syncing the bytes.
For account imports, a POSIX rename atomically replaces the final name even when its previous source ID differs.
A failed download or verification preserves the old file. Legacy jobs retain the no-replace hard-link commit.
The metadata-file activity check and filename commit share a short SQLite transaction so an active metadata
writer is not overwritten. The directory is synced after commit and again during publication recovery.

A durable intent records the pending device/inode before commit. Recovery recognizes its own final inode
and completes the same event without downloading again. Replacement reuses the existing media binding,
increments its revision, marks it unavailable until registration, and records a new download event.
Cleanup removes only this attempt's pending/staged files. Old MP3 bytes are replaced, not backed up.

Filesystem trust boundary: music/staging roots and their ancestors are operator-controlled; the
worker must not share write access with an untrusted local process. Repeated lstat/realpath checks are
not an `openat2` sandbox against a hostile process concurrently renaming ancestors between syscalls.
This helper rejects supplied symlinks and observed parent replacement; it does not claim protection
from an attacker with the worker's OS write privileges. Network filesystems and crash recovery across
file/DB boundaries require deployment/worker validation in their owner Steps.

## Process and privacy

`runProcess` takes an operator-owned absolute executable, readonly argv, an absolute cwd matching an
explicit canonical cwd allowlist, an optional AbortSignal and separate stdout/stderr byte limits.
It uses `spawn` with `shell: false`, a detached POSIX process group and ignored stdin. No shell-command
string API exists. Arguments are copied; caller-supplied values remain literal argv. This does not
replace the future worker's responsibility to construct fixed downloader options and place validated
source values only in designated argument positions.

No ambient environment is spread. The only explicit keys are PATH, LANG, LC_ALL and TMPDIR; NODE_OPTIONS
and other keys are rejected. macOS can add its own CoreFoundation encoding variable inside the child.
Each stream has a positive limit up to 16 MiB. Output overflow, abort and spawn failures use fixed safe
codes and never attach raw argv, paths or output to errors. Exit status and bounded output are returned
only to the internal caller. POSIX is required; Windows is rejected rather than claiming group cleanup.

Cancellation sends group SIGTERM then SIGKILL after a bounded grace period (1–10000 ms), retaining the
timer even if the leader exits first. A normally exiting leader with live descendants also triggers
cleanup and `process_cleanup_failed`. Subprocesses must remain in the owned group; container init/reaping
and real engine behavior are deployment/worker verification concerns.

Optional logger events contain only fixed `stage`, `failureCode` and validated opaque UUID `jobId` /
`itemId` fields. Logger exceptions cannot interrupt process cleanup. Raw URLs, metadata, argv,
stdout/stderr, credential values and absolute paths are never passed to the logger.

## youngs-ytdl reference decisions

| Reference                                                                     | Classification      | Result                                                                                                                |
| ----------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| bot process/process-runner.ts                                                 | mod                 | Preserve argument-array/no-shell pattern; replace execFile buffering with stream limits and owned group cancellation. |
| bot utils/filename-utils.ts                                                   | mod                 | Preserve NFC/reserved-character intent; add UTF-8 bounds, stable IDs and collision checks.                            |
| yt-dlp-service.ts channel/uploader paths                                      | pattern             | Preserve readable channel structure; use server policy and relative keys, no user-supplied roots.                     |
| yt-dlp-service.ts metadata/thumbnail/after_move arguments                     | pattern, Step 03    | Future fixed worker arguments and independently verified output, not stdout-path trust.                               |
| yt-dlp.conf Node runtime option                                               | pattern, Step 03/09 | Future explicit runtime configuration; no bot config copy or edit.                                                    |
| Telegram BotService/global options/path singleton                             | no reuse            | No Telegram or global option dependency.                                                                              |
| Raw URL/argv/stderr logging, fixed buffer and stdout-derived path assumptions | no reuse            | Code-only errors/events, byte bounds and independently opened files.                                                  |

The bot repository was read only. No gonic/iOS/bot code, media volume or deployment was modified.

Technical references: [Node 24 filesystem API](https://nodejs.org/docs/latest-v24.x/api/fs.html),
[Node child process API](https://nodejs.org/api/child_process.html).
