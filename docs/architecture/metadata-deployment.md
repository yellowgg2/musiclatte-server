# Optional metadata runtime

Metadata runs independently of YouTube imports. The API reads MP3 tags and owns a scoped upload volume; a separate worker owns original backups, intents, atomic replacement and gonic reflection. Neither process needs an import engine or a Docker socket.

Use the pinned gonic 0.22.0 image and the `posix-exclusive-mp3-id3v23-v24-v1` profile: plain POSIX files owned by the configured UID/GID, no hardlinks, symlinks, ACLs, extended attributes or competing writers. ID3v2.3/v2.4 and tagless MP3 are writable; unsupported preservation requirements fail closed. Do not make music world-writable or recursively change an existing library's ownership. Default UID/GID is 1000:1000, matching management storage. Provision all private volumes and the key consistently before using another identity.

Create an absolute private policy file outside the repository, readable by the service user:

```json
{
  "schemaVersion": 1,
  "enabled": true,
  "libraries": [
    {
      "id": "music",
      "musicFolderId": "0",
      "relativeRoot": "managed",
      "editors": ["configured-editor"],
      "writeProfile": "exclusive",
      "preserveOwnership": true
    }
  ],
  "restoreManagers": ["configured-restorer"],
  "limits": { "maxTargets": 64, "maxFileBytes": 104857600, "timeoutMs": 120000 }
}
```

`relativeRoot` is relative to `MUSIC_PATH`; confirm the actual gonic folder ID. The worker's separate JSON credential contains exactly `username` and `password` for a scan-capable administrator. Use a private file with mode 0600; never copy its contents into `.env`, commands, logs or this repository. `.env` contains only `METADATA_POLICY_FILE` and `METADATA_CREDENTIAL_FILE` absolute paths, plus the existing deployment settings.

```sh
docker compose -f compose.yaml -f deploy/compose.metadata.yaml config --quiet
docker compose -f compose.yaml -f deploy/compose.metadata.yaml up -d --build
docker compose -f compose.yaml -f deploy/compose.metadata.yaml exec metadata-worker node apps/api/dist/metadata-worker-entry.js --check-config
docker compose -f compose.yaml -f deploy/compose.metadata.yaml exec metadata-worker node apps/api/dist/metadata-worker-entry.js --healthcheck
```

For combined imports, place `-f deploy/compose.imports.yaml` before the metadata overlay on every command and supply both private policies/credentials. API and gonic music mounts remain read-only after merging. Only the metadata worker mounts `metadata-data`; both API and worker mount `metadata-uploads`. Both workers share management storage and the fenced `registration_cycle` scan coordinator. Empty private volumes are initialized at mode 0700; nonempty volumes with different ownership/mode are rejected without recursive repair.

Startup executes a synthetic read/prepare/read-back self-test outside the music tree and verifies the gonic profile before publishing healthy capability. Python 3.11, Mutagen 1.48.1 and FFmpeg 5.1.9 run in the image; package hashes and source notices are included. A small static Go helper reproduces gonic's imaging 1.6.2/Lanczos/default-600 cover projection and compares decoded pixels. It has no network access or arbitrary path inputs. A gonic version change requires renewed compatibility evidence; changing an environment string does not establish support.

The scheduler attempts recovery, one file job, then due reflection. Each helper/scan is bounded; an active session and current folder/editor permission are rechecked before mutation. Reflection retains the submitting account's encrypted session reference. If that session expires, signing in again and requesting a recheck refreshes only the same owner's reflection authorization. Upload bytes are immutable and digest-checked; unreferenced expired uploads are cleaned during later uploads, while referenced bytes are retained.

When the automation policy includes `organization`, the same metadata worker additionally owns
durable ID3-managed moves, gonic rebinding, playlist/star reference migration, and final
verification. `compose.automation.yaml` changes its health command to the organization-aware check;
the API publishes `metadata.organization` as available only while both the metadata runtime and
that shared worker heartbeat are ready. All import, metadata, and organization writers share the
single `/media-fence` volume. The API remains read-only on `/music`; only the workers receive the
minimum writable mounts they own. See the
[Codex ID3 organization runbook](../operations/codex-id3-organization.md) for the secret-safe client
and bounded recovery workflow.

File save and gonic reflection are separate states. Gonic 0.22.0 can retain warmed cover cache after a scan; such jobs stay `reflecting` with `reflection_mismatch`. Do not delete cache, rewrite IDs, request a random unused image size, or report success to conceal this behavior. Worker absence disables metadata writes but keeps API readiness, job history and existing music playback available. SIGTERM stops new claims and lets bounded work acknowledge its state; after a crash, a replacement worker waits for the old heartbeat/leases to expire and recovers durable receipts.

Follow [matching backup and rollback](../../deploy/backup/README.md). Current schema is v24,
including the metadata, automation, and organization ledgers. Keep a matching management/key plus
media snapshot made with the old build before migration. Disabling metadata or organization does
not reverse migrations, reference changes, or edited/moved files. An older image must never be
paired with a newer database.

The repository contains source, dependency locks and synthetic-fixture generators only. Images exclude tests, probe tools, credentials, private stores and generated media. [Third-party notices](../../THIRD_PARTY_NOTICES.md) describe included dependencies; no project license has been selected.
