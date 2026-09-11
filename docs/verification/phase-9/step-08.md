# Phase 9 Step 08 verification

The source-only client exposes the nine planned commands and accepts only owner-private token and
manifest files. Contract tests cover mode/symlink rejection, strict manifest decoding, header-only
PAT transport, malformed boundary handling, lost-submit replay, and bounded server-owned recovery.

The automation overlay selects the organization-aware metadata worker healthcheck. The isolated
Linux probe is ownership-gated to a new `/tmp/musiclatte-p9-*` root and dedicated Compose project.
It verifies exact candidate selection, metadata write, single JPEG normalization, ID3v2.3, decoded
audio preservation, managed rename, old-path absence, new gonic binding, duplicate playlist
occurrences, star migration, operation replay, and same-source import deduplication. Its only success
output contains booleans/counts/status and hashed ID prefixes; credentials, metadata responses, and
paths remain in the private probe directory.

## Isolated runtime result

```json
{
  "schemaVersion": 1,
  "status": "succeeded",
  "checks": {
    "singleJpeg": true,
    "oldPathAbsent": true,
    "managedPath": true,
    "playlistOccurrences": 2,
    "starMigrated": true,
    "duplicateCount": 1
  },
  "ids": { "old": "45d8e03a4a2d", "next": "8f3cebfd8e2a" }
}
```

The isolated result includes a same-source reimport that terminated as `duplicate`; no legacy path
was recreated. It also verifies duplicate playlist occurrences and star migration under the same
organization actor.

## Authorized devserver result

The disposable `musiclatte-p7-user-review` stack used dedicated loopback ports and a dedicated
source worktree. Runtime inspection was completed before mutation. Private credentials, manifests,
source responses, song values, and paths stayed outside the repository and command output.

```json
{
  "schemaVersion": 1,
  "status": "succeeded",
  "checks": {
    "audioPreserved": true,
    "id3v23": true,
    "metadataMatched": true,
    "singleOfficialJpeg": true,
    "oldPathAbsent": true,
    "managedPath": true,
    "gonicBinding": true,
    "playlistOccurrences": 0,
    "starBaseline": true,
    "reimportApplicable": false,
    "duplicateCount": 1
  },
  "ids": { "old": "dcc8297f08d5", "next": "58216f87bf59" }
}
```

The selected existing file had no Musiclatte import provenance, so an actual-file same-source
reimport was not applicable; candidate lookup nevertheless returned exactly one new binding. The
pre-captured administrator-account star baseline was restored to the new binding after the
service-account-scoped organization completed, while its playlist occurrence baseline remained
zero. Actor-scoped automatic star and playlist migration remains covered by the isolated runtime.

The live flow exposed two cross-stage publication boundaries. Regression tests now prove that a
file-verified, album-only gonic projection mismatch may pass both successor automation admission
and the organization rename boundary. Any other active metadata state or mismatch remains busy.
