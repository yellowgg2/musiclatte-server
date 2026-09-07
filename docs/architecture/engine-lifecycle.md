# yt-dlp engine lifecycle

Phase 3 Step 07 owns the managed executable store, nightly check, source validation,
immutable leases, and previous restore. Step 08 owns the administrator API projection;
Step 09 owns the standalone seed/checksum, engine volume, process entry, and timer wiring;
Step 14 owns actual nightly and live source verification. No API readiness, stored-music
playback, web route, gonic, or bot process depends on initialization of this provider.

## Store and trust boundary

The operator supplies a canonical absolute private engine root and an image-owned standalone
seed `{executable, version, hash}`. Runtime users cannot supply a binary, channel, version,
command, or update repository. The seed is SHA-256 checked before execution and copied into
`versions/<exact-version>-<sha256>` at mode `0500`. The image seed is never modified.

```text
managed root/
  active.json                 # regular JSON file: active + previous + activation status
  versions/<version>-<hash>   # immutable executable, no active symlink
  candidates/<uuid>/yt-dlp    # independent writable copy; self-update only here
```

All managed directories reject symlinks/noncanonical paths and group/world write permissions.
Executable reads use lstat, O_NOFOLLOW, O_NONBLOCK and fstat; they reject nonregular, empty,
multiple-link, unsafe-mode and oversized (>128 MiB) files. Version strings are bounded safe
ASCII labels, hashes are exact lowercase SHA-256, and candidate directory keys are UUIDs.
The configured root must already exist; the provider creates only its managed subdirectories.
Dependency executables are operator configuration, not request input.

Candidate preparation copies active bytes, checks the copy, invokes that copy with fixed
`--ignore-config --update-to nightly`, reads exact `--version`, and compares versions. Same
version means `up_to_date`/no_update; the temporary copy is removed. A changed version must
pass regular/mode/hash checks, `--version`, `ffmpeg -version`, and configured `node --version`.
The candidate file and directories are fsynced before persisting its key/hash/version.

The update mechanism follows the [official release-binary update interface](https://github.com/yt-dlp/yt-dlp#update).
The [upstream updater](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/update.py) checks the
release checksum when supplied. Our stored hash detects subsequent byte changes; it is not
an independent signature or provenance verifier. Pinning and trusting the official standalone
seed is a deployment requirement. Package-manager self-update and unpackaged non-updatable
binaries are not substitutes for the Step 09 seed contract.

## Validation and activation

`createEngineProvider(options).initialize()` seeds only an empty state or reconciles an
existing validated active manifest. A missing manifest for an already initialized DB fails
closed: startup cannot silently roll back to the image seed. Restart never invokes an update.

`acquire(sourceId?, signal?)` returns a frozen `{version, executable, release}`. Without a
source, it leases active without consuming pending validation. The worker passes the canonical
video ID of its next policy-accepted import. Candidate validation runs non-download metadata
extraction with config/plugins/cache disabled, explicit Node runtime, no playlist, and a fixed
canonical URL. Both the exact requested ID and the existing source metadata decoder must pass.
Version/dependency smoke alone never establishes successful extraction.

Each child uses the existing no-shell bounded process-group runner, a private cwd, limited
PATH/LANG, at most 1 MiB stdout/128 KiB stderr, and a 15-second default/maximum timeout plus
50 ms termination grace. Provider cancellation reaches the child. Process output, URL,
metadata and host paths are never persisted as failure text.

On success the candidate is installed without overwriting an existing version file; active
and previous are written together to a mode-0600 temporary manifest, fsynced, renamed over
`active.json`, and the root directory is fsynced. The provider then projects the committed
versions into SQLite. A crash after rename but before DB projection is recovered from the
validated manifest at initialization. Candidate validation failure removes only that candidate,
records a closed failure code, and leases the old active for the same item. Cancellation leaves
the candidate pending for a later accepted item. A projection/storage error after commit is
surfaced for recovery, not misreported as successful fallback. If rename succeeded but directory
fsync failed, the provider projects the visible validated selection and throws `activation_failed`;
it does not claim the old active was used or that disk durability was established.

## Persistence, time, and concurrency

Schema v7 rebuilds only `engine_state`, preserving active/previous versions and check times.
It adds explicit statuses, redacted failure code, candidate key/hash and an operation token
with expiration. A v6 candidate had no verifiable key/hash and migrates to
`validation_failed/invalid_executable`; prior checking becomes `update_failed/check_interrupted`.
Session, job, attempt, music and event rows are unchanged by this migration.

| Condition                                              | Selection / state                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------------- |
| No successful seed yet                                 | `never_checked`, active null; import availability requires active          |
| Seed initialized, no check                             | `never_checked`, immutable seed active                                     |
| First check or elapsed >= 86,400,000 ms                | Persist attempt time + `checking` before process launch                    |
| Elapsed 23:59:59.999, same-time tick or backward clock | Skip without launching updater                                             |
| Restart after many missed days                         | One due check, no catch-up loop                                            |
| Concurrent check/use/restore                           | One SQLite operation claim; other checks skip and acquisitions keep active |
| Same version                                           | `up_to_date`, no candidate retained                                        |
| New version passes basic checks                        | `candidate_pending_validation`, active unchanged                           |
| Updater failure                                        | `update_failed`, active unchanged                                          |
| Candidate/file/dependency/source failure               | `validation_failed`, active fallback                                       |
| Source probe and activation succeed                    | `active`, former active becomes previous                                   |
| Valid previous restored                                | `restored`, active/previous swap                                           |

The clock is injected UTC milliseconds. `lastCheckedAt` is the attempt-start time; successful
preparation records that attempt's time in `lastCheckSucceededAt`. The latter records an update
check, not source extraction success. Failed attempts also consume the daily interval. A pending
candidate is retained until use/restore; daily ticks do not replace an untested candidate.

`createEngineScheduler().checkDue()` is caller-driven: Step 09 invokes it on startup and periodic
ticks and owns shutdown of its timer. Operations have a 120-second fencing lease; the longest
normal subprocess chain is bounded to 75 seconds plus file I/O. Every asynchronous result must
still own an unexpired token before activation/state mutation. Stale completions cannot clear
another operation's claim or publish their candidate. SQLite transactions contain only the claim;
filesystem and subprocess work run outside transactions. `engine_busy` is retryable at startup.

## Running jobs, restore, and retention

The worker records the leased version in both item and durable attempt before download. It
keeps the executable/version fixed until processing settles and staging cleanup completes.
Success, error, cancellation and simulated crash all release; acquisition timeout forwards an
abort signal and late acquisition results are released as well. `release()` is idempotent.

Version files are never automatically deleted, including after release. This deliberately
preserves leases held by other worker processes without inventing an unsafe cross-process GC
policy. Only owned completed/rejected candidate directories are removed. A hard process crash
before a candidate DB receipt can leave an orphan temporary directory or version install file;
offline maintenance may remove these only with all engine writers stopped and after checking
DB/manifest references. There is no age-based online scavenger in S07.

`restorePrevious()` requires an existing regular/hash/version/dependency-validated previous.
It changes only the selection manifest and engine-state projection, preserving check time,
running executables, import attempts, DownloadEvents, media files and stored playback. Failed
restore leaves selection unchanged. Engine update/validation failure with an existing active no
longer disables imports; worker heartbeat and account/library policy still gate availability.

The repository's legacy `initialize/recordCheck/activateCandidate/restorePrevious` methods remain
for existing storage callers/fixtures. Runtime engine mutations must use the provider so file
validation and fencing are enforced. Step 08 must allowlist a public DTO rather than serializing
internal repository state, candidate keys, operation tokens or executable paths.

## Backup and rollback

Before schema upgrade, use the old application version's validated online backup with the
matching credential key. Stop engine writers for a matching DB/key/engine-root snapshot.
A v7 online DB backup preserves pending candidate key/hash, statuses and check times, but does
not copy executables: restore the matching engine volume separately. Restoring an unrelated DB
and volume is unsupported. Initialization treats the manifest as the selection commit point.

To roll back schema v7, restore a complete pre-v7 snapshot with the matching old application;
do not run an old image against the v7 DB. `restorePrevious()` is an executable selection action,
not a schema rollback. Actual Compose volume/mount/backup orchestration remains Step 09.
