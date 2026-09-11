# Metadata organization

Metadata organization is an opt-in, account-scoped operation. Step 02 introduces only the
mutation-free `id3-managed-v1` path planner; file movement, durable jobs, gonic rebinding, and
reference migration are separate later boundaries.

## Operator configuration

`AUTOMATION_POLICY_PATH` may include an `organization` section with an explicit mapping from a
gonic username to one single-segment account directory. There is deliberately no fallback from
username to directory name. Absolute paths, slash or backslash separators, dot segments, control
characters, trailing dot/space, duplicate usernames, and Unicode/case-equivalent directory aliases
are rejected. Start from `deploy/automation-config.example.json` and keep the deployed copy private.

The policy version is `id3-managed-v1`. A destination has this server-derived shape:

```text
<relativeRoot>/<accountDirectory>/ID3-managed/<albumArtist-or-artist>/<album>/<track - title>.mp3
```

The first album artist wins, otherwise the first artist wins. The numeric part before `/` in a
track number becomes a minimum two-digit prefix; the total never contributes to path identity.
Every metadata segment uses the existing NFC, illegal-character, reserved-name, trailing-dot/space,
and 160-byte media-name sanitizer.

## Preview boundary

The caller supplies identity, library authorization, current source key, and the current metadata
snapshot—not arbitrary destination segments. The planner requires the source below the mapped
`relativeRoot/accountDirectory`, validates the source as a real regular file beneath the canonical
music root, and inspects the destination without creating directories or moving bytes.

The result distinguishes `ready`, an exact already-managed `no_op`, and typed errors for missing
metadata, account/library violations, unsafe source or target components, Unicode/case-equivalent
collisions, existing destinations, and excessive input. Missing target parents are valid preview
state; symlink parents and collisions are not.
