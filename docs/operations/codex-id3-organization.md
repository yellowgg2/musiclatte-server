# Codex ID3 organization

Use this operator client only after a user has selected one exact song and verified the proposed
metadata against permitted sources. It does not research or infer metadata.

## Private inputs

Store the PAT and manifest outside the repository. Both files must be regular, owner-owned, mode
`0600`, non-symlinks. The PAT file contains only the `mlpat_…` value. Issue it with
`metadata:read`, `metadata:write`, `media:organize`, plus `curation:write` for title/artist and
`lyrics:write` only when lyrics are actually written.

Collection batches also require `collections:read`. Put the journal in a new absolute path inside
an owner-owned mode-`0700` directory outside the repository. The state file is created with
mode `0600`; state, temporary, lock, and parent symlinks are rejected.

The strict manifest accepts `schemaVersion`, `metadata`, `sourceEvidence`, and optional `cover`.
Omit fields that are unknown or not verified. A cover must be an absolute private JPEG path with a
recorded usage basis. Every evidence URL must use HTTPS and name the fields it supports.

```json
{
  "schemaVersion": 1,
  "metadata": {
    "album": "Verified release",
    "albumArtist": ["Verified artist"],
    "trackNumber": "1/10",
    "year": "2026",
    "genre": ["Pop"]
  },
  "sourceEvidence": [
    {
      "url": "https://artist.example/releases/example",
      "kind": "official_artist",
      "fields": ["album", "albumArtist", "trackNumber", "year", "genre"]
    }
  ],
  "cover": {
    "path": "/absolute/private/path/cover.jpg",
    "usageBasis": "Documented permission or other verified basis"
  }
}
```

## One-song lifecycle

Set only paths and non-secret endpoints in shell variables. Never put the token value in argv, an
environment variable, a URL, output, or a saved transcript.

```sh
npm run id3:organize -- candidates --api https://service.example/api/v1 --token-file /absolute/private/token --title "Exact title"
npm run id3:organize -- inspect --api https://service.example/api/v1 --token-file /absolute/private/token --track-id TRACK_ID
npm run id3:organize -- metadata-preview --api https://service.example/api/v1 --token-file /absolute/private/token --manifest /absolute/private/manifest.json --track-id TRACK_ID --revision REVISION
npm run id3:organize -- cover-upload --api https://service.example/api/v1 --token-file /absolute/private/token --manifest /absolute/private/manifest.json --library-id LIBRARY_ID
npm run id3:organize -- metadata-submit --api https://service.example/api/v1 --token-file /absolute/private/token --manifest /absolute/private/manifest.json --track-id TRACK_ID --revision REVISION --cover-upload-id UPLOAD_ID --operation-id STABLE_OPERATION_ID
npm run id3:organize -- organization-preview --api https://service.example/api/v1 --token-file /absolute/private/token --track-id TRACK_ID --revision RESULT_REVISION
npm run id3:organize -- organization-submit --api https://service.example/api/v1 --token-file /absolute/private/token --manifest /absolute/private/manifest.json --track-id TRACK_ID --revision RESULT_REVISION --metadata-job-id METADATA_JOB_ID --operation-id STABLE_OPERATION_ID --poll-attempts 180 --poll-interval-ms 1000 --recovery-retries 1
```

Title/artist claims and optional-field claims are separate server contracts. If a manifest mixes
them, split the change into sequential manifests. Keep the last successful metadata job ID and its
result revision for organization submission. Reuse the same operation ID after a lost response.
`metadata-submit` is a single-shot flow: after the server accepts the job, or if submission fails
after a claim was granted, the client idempotently releases that claim. The accepted job continues
under its durable grant and file fence, so the next claim need not wait for the lease to expire.

Stop when candidate search is not exact, evidence is incomplete, metadata preview rejects a field,
or organization preview reports a collision. `status` performs a read; `retry` is valid only for a
server-reported `recovery_required` checkpoint. Polling and automatic recovery are bounded.

## Collection batch lifecycle

Freeze exactly one current-account collection before researching any item:

```sh
npm run id3:organize -- batch-start --api https://service.example/api/v1 --token-file /absolute/private/token --source favorites --state-file /absolute/private/batch.json
npm run id3:organize -- batch-start --api https://service.example/api/v1 --token-file /absolute/private/token --source playlist --playlist-id OPAQUE_ID --state-file /absolute/private/batch.json
npm run id3:organize -- batch-next --api https://service.example/api/v1 --token-file /absolute/private/token --state-file /absolute/private/batch.json
npm run id3:organize -- batch-status --api https://service.example/api/v1 --token-file /absolute/private/token --state-file /absolute/private/batch.json
```

`batch-next` returns the first unfinished unique track and its occurrence count. Run the existing
cover, metadata, organization submit, and status commands with both `--state-file` and that exact
`--track-id`. The journal creates all stable operation IDs before mutation, reuses them after a
lost response, and atomically checkpoints accepted upload/job IDs, result revision, new track ID,
and server stage. A succeeded item is never selected again; an accepted item is returned for exact
replay or status readback.

Only a non-mutating research outcome may be skipped:

```sh
npm run id3:organize -- batch-skip --api https://service.example/api/v1 --token-file /absolute/private/token --state-file /absolute/private/batch.json --track-id TRACK_ID --skip-reason ambiguous_release
```

Allowed reasons are `ambiguous_release`, `official_evidence_missing`, `unsupported_format`,
`metadata_incomplete`, and `destination_conflict`. A skip is refused after an accepted mutation.
Item-local failures leave the next item available. Authentication, authorization, upstream, policy,
or scope failures stop the batch with all checkpoints preserved; after correcting the cause, an
explicit `batch-next` resumes the same unfinished item. Concurrency is one journal command at a
time via the private lock file.

The journal contains only API/credential fingerprints, the frozen selection revision, redacted
source and display metadata, occurrence indexes, stable operation IDs, opaque server IDs, and
state/error codes. It never contains the PAT, manifest or evidence body, JPEG/lyrics bytes, or a
private media path. `batch-next` and `batch-status` likewise emit only safe display/checkpoint data.

Collection orchestration is strictly sequential. Before research, report only the source kind and
frozen occurrence, unique-item, duplicate-occurrence, empty, or oversized result; derive any count
not printed by the client from the private journal without exposing its path or source/account
metadata. An empty or rejected selection causes zero mutation.

Apply the one-song evidence, cover, metadata, organization, and final verification standard to each
unique item returned by `batch-next`. Ambiguous release, missing official evidence, unsupported
format, incomplete move metadata, and a pre-submit destination collision are item-local outcomes;
record the allowed short reason before any accepted mutation and continue. Authentication/scope or
policy changes, exhausted upstream availability, invalid/locked journal state, strict response
decode failures, and failures after mutation acceptance stop all later items.

When the verified release requires both a title/artist correction and optional fields, split the
manifest into a required-fields manifest and an optional-fields manifest. Upload the cover first,
submit the required manifest with the current revision, re-inspect after its successful result, then
submit the optional manifest with that result revision. The private schema-version-2 journal owns a
different stable operation/checkpoint for each metadata purpose; organization must use the final
successful metadata job and revision. Existing schema-version-1 journals are normalized on read and
atomically upgraded on their next checkpoint, preserving their prior metadata operation as the
optional step. Do not edit or recreate a live journal to perform this upgrade.

For a new-session resume, reuse the same API, token file, and state file, then call `batch-next`.
Resume the returned accepted job/revision checkpoint exactly; never research or mutate a succeeded
item again. Final output contains total/succeeded/skipped/blocked counts and only public song display
names plus short reasons for unsuccessful items. Do not print stable operation IDs, opaque account
identifiers, source responses, evidence bodies, or private paths.

## Deployment and recovery

Apply `compose.imports.yaml`, `compose.metadata.yaml`, then `compose.automation.yaml`. Organization
readiness requires the organization policy and the healthy shared metadata worker. Confirm the
`metadata.organization` capability is `available` before mutation.

After success, verify decoded audio identity, ID3v2.3 values and arrays, exactly one front JPEG,
the managed path, old-path absence, the new gonic song/album, playlist occurrence order, star state,
and same-source reimport deduplication. Record only booleans, counts, status, and redacted IDs. Never
copy private media, paths, account data, credentials, manifests, or source responses into Git.
