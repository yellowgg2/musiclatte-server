# Consistent backup and restore

Stop only this Compose project before a whole-stack snapshot: `docker compose stop web api gonic`. Record the source commit, gonic digest/version, Compose project name, configured session policy and image IDs privately. Do not use `down -v` or copy a running SQLite main file alone. `docker compose start` resumes the same volumes.

Back up **gonic-data, gonic-playlists, gonic-podcasts, management-data and management-keys** together while stopped. Use `docker volume inspect <project>_<volume>` to resolve names; do not guess existing service paths. Archive through a temporary container with each source volume mounted read-only, into an operator-owned private backup directory outside the repository. Preserve numeric UID/GID and modes. gonic-cache is reproducible and can be empty on restore. Music is mounted read-only by this stack but needs its own matching snapshot if another writer can change it. Quiesce those writers or use a coordinated filesystem snapshot.

Restore into **new project-scoped volumes** under a new Compose project name, never over live volumes. Use the same gonic digest before starting; restore the recorded gonic database, playlists, management database and matching 32-byte key with permissions intact. Do not generate a replacement key. Set the same music snapshot and session policy. Verify SQLite integrity, key/schema consistency, stable instance ID, login, folder/search and streaming before selecting the new origin. Retain the old stopped stack and immutable backup until verified.

For rollback to an older snapshot, increase the management **policy revision** before serving to invalidate sessions that could have been revoked after the snapshot: use the compiled `createInstanceRepository(...).bumpPolicyRevision()` API with the restored matching key. See [storage contract](../../docs/architecture/session-storage.md) for the exact API. An ordinary process restart must preserve session continuity; historical snapshot rollback must not resurrect revoked tokens.

A management-only online snapshot can use S02 `createBackup` and offline `restoreBackup`, but it does not establish a consistent gonic/music boundary. Changing only the gonic image back after a DB migration is not rollback: restore the matching pre-migration gonic data as well. Never downgrade the existing demo database for a test.

Whole-stack verification evidence and the tested commands are in [S04](../../docs/verification/phase-1/step-04/README.md). Backup archives, keys and actual music stay outside Git, Docker build contexts and public logs.

한국어: 이 프로젝트만 정지한 상태에서 gonic DB·playlist·podcast와 관리 DB·key를 함께 보존한다. cache는 재생성 가능하며 음악은 별도 일관 snapshot이 필요하다. 새 project의 빈 volume에만 복원하고 이전 snapshot rollback은 serving 전에 policy revision을 증가시킨다. key 재생성, 실행 중 SQLite main 파일만 복사, image만 downgrade, `down -v`는 복구 절차가 아니다.

## Command recipe (run at repository root)

The following uses only this installation's named volumes. Substitute the project name from `.env`. Keep `ML_BACKUP_DIR` outside the repository; ensure the directory is new and private. The caller must have Docker access. The archival helper runs as root only to preserve numeric ownership of private volume files, with no network and read-only source mounts.

```sh
ML_STACK=musiclatte
ML_BACKUP_DIR=/absolute/private/path/snapshot-001
ML_GONIC_IMAGE=sentriz/gonic@sha256:516fd9645614ba3a596d86174216c3e944808b9ec970c581678713be4c8b1d49
mkdir -m 700 "$ML_BACKUP_DIR"
docker compose -p "$ML_STACK" stop web api gonic
docker run --rm --network none --entrypoint sh \
  -v "${ML_STACK}_gonic-data:/snapshot/gonic-data:ro" \
  -v "${ML_STACK}_gonic-playlists:/snapshot/gonic-playlists:ro" \
  -v "${ML_STACK}_gonic-podcasts:/snapshot/gonic-podcasts:ro" \
  -v "${ML_STACK}_management-data:/snapshot/management-data:ro" \
  -v "${ML_STACK}_management-keys:/snapshot/management-keys:ro" \
  -v "$ML_BACKUP_DIR:/backup" "$ML_GONIC_IMAGE" \
  -c 'tar cpf /backup/stack.tar -C /snapshot .'
```

Verify the archive operation succeeded before resuming the old project with `docker compose -p "$ML_STACK" start`. For restoration, use a **new** project name and free ports (or keep the old project stopped). Before mounting any destination, verify the names do not already exist; `docker volume create` itself is not a no-clobber check.

```sh
ML_RESTORE=musiclatte-recovery-001
for ML_VOLUME in gonic-data gonic-playlists gonic-podcasts management-data management-keys gonic-cache; do
  if docker volume inspect "${ML_RESTORE}_${ML_VOLUME}" >/dev/null 2>&1; then
    echo 'Restore destination already exists; choose a fresh project name' >&2
    exit 1
  fi
done
for ML_VOLUME in gonic-data gonic-playlists gonic-podcasts management-data management-keys gonic-cache; do
  docker volume create "${ML_RESTORE}_${ML_VOLUME}"
done
docker run --rm --network none --entrypoint sh \
  -v "${ML_RESTORE}_gonic-data:/snapshot/gonic-data" \
  -v "${ML_RESTORE}_gonic-playlists:/snapshot/gonic-playlists" \
  -v "${ML_RESTORE}_gonic-podcasts:/snapshot/gonic-podcasts" \
  -v "${ML_RESTORE}_management-data:/snapshot/management-data" \
  -v "${ML_RESTORE}_management-keys:/snapshot/management-keys" \
  -v "$ML_BACKUP_DIR:/backup:ro" "$ML_GONIC_IMAGE" \
  -c 'tar xpf /backup/stack.tar -C /snapshot'
docker compose -p "$ML_RESTORE" build api web
```

For an older-snapshot rollback, invalidate old management sessions **before** starting the gateway:

```sh
docker compose -p "$ML_RESTORE" run --rm --no-deps api node --input-type=module -e '
import { openDatabase } from "./apps/api/dist/storage/database.js";
import { loadKey } from "./apps/api/dist/security/key-store.js";
import { createCredentialVault } from "./apps/api/dist/security/credential-vault.js";
import { createInstanceRepository } from "./apps/api/dist/storage/instance-repository.js";
const db = openDatabase("/management");
try {
  const vault = createCredentialVault(loadKey("/keys/credential.key"));
  createInstanceRepository(db, vault.keyId).bumpPolicyRevision();
} finally { db.close(); }
'
docker compose -p "$ML_RESTORE" up -d --build
docker compose -p "$ML_RESTORE" ps
```

Use the same explicit test/LAN override files on every Compose command if that installation uses one. Confirm `/health/ready`, the preserved instance ID, a fresh login, old-token rejection after rollback, native folder/search and stream bytes. Do not expose the restored origin until initial admin setup and these checks are complete. The original snapshot stays immutable for another recovery attempt.

## Imports overlay: pre-upgrade and matching recovery

Before the first Phase 3 startup, take a **v2 pre-upgrade snapshot using the old application build**. Phase 3 migrations started at v3; the current image migrates management storage to **schema v8**. This also happens with base Compose: disabling imports is a capability rollback, not a schema downgrade. Never run a v2 binary against v3–v8 storage. Restore its matching v2 management+key and gonic/music snapshot into new volumes for a binary downgrade.

For an imports installation, use `-f compose.yaml -f deploy/compose.imports.yaml` on **every** stop/start/run command. First stop worker, then web/API/gonic, and quiesce other writers to the host music root:

```sh
docker compose -f compose.yaml -f deploy/compose.imports.yaml stop worker
docker compose -f compose.yaml -f deploy/compose.imports.yaml stop web api gonic
```

Apply the recipe above with `engine-data` added to both archival/restore helper mounts (`<project>_engine-data:/snapshot/engine-data`) and both fresh-volume lists. Do not run the base-only stop recipe while a worker is active. Record this private backup manifest:

| Member                                          | Relationship                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| management-data + management-keys               | Matching schema v8 SQLite, WAL if present, instance/key and job/lease/event ledger         |
| gonic-data + gonic-playlists + gonic-podcasts   | Same stopped scan/account/library boundary                                                 |
| engine-data                                     | Same stopped active.json, versions and retained candidate files as management engine state |
| Host music snapshot                             | Matching published media referenced by MediaLink; archive separately from Docker state     |
| Private policy + worker credential              | Secure operator backup outside archives that could be shared                               |
| Source commit, image IDs, gonic digest, UID/GID | Exact build and numeric owner/mode required for recovery                                   |

`worker-staging` is **excluded** from the backup manifest: it is neither music, a scan root, nor an authoritative ledger. Create a new empty staging volume on restore. A missing staging artifact is recovered from durable job/publish intent state; never clear final media or assume an expired lease authorizes overwriting a file. On ordinary restart retain staging and let the worker remove only its recorded owned artifacts. Engine versions are retained; do not delete candidates/versions or replace a missing committed manifest with the seed.

Restore matching management+key+gonic+engine and host music into fresh destinations with numeric ownership/modes. Bump policy revision for historical rollback before serving. Start gonic/API first, wait for expired durable worker/registration/engine leases, then start the worker with the same overlay. Run `worker --check-config` (the full command is in the imports guide), inspect health and verify ready MediaLinks and playback before enabling the gateway. Failed engine updates keep the active version; use the authorized engine restore action for a previous version, which does not downgrade the DB. Retain immutable backups and the previous stopped stack. Never use `down -v`, delete existing media, or copy a running SQLite main file alone.

한국어: Phase 3 첫 실행 전 구버전 빌드로 v2 snapshot을 만든다. 현재 DB는 v8이며 base Compose에서도 migration하므로 imports 비활성화와 schema downgrade를 구분한다. imports 설치에서는 모든 명령에 두 Compose 파일을 지정하고 worker부터 정지한 뒤 API·gonic·다른 음악 writer를 정지한다. management-data+matching key, gonic state, engine-data, host 음악을 같은 시점으로 보존하고 새 volume에만 복원한다. staging은 backup 원장에서 제외하고 빈 volume으로 시작한다. 과거 snapshot은 policy revision 증가·lease 만료·owned artifact 복구 후 health와 기존 재생을 확인한다. v2로 돌아가려면 matching v2 snapshot이 필수이며 image만 교체하지 않는다.

## Metadata overlay: matching v11 snapshots

Before first Phase 4 startup, preserve a **v8 management DB + original key + matching music/gonic snapshot using the old build**. Current startup migrates through v9–v11 even if metadata is disabled. Keep the exact image IDs and private policies with the operator's recovery record. Disabling the overlay preserves edits and does not downgrade the schema.

For a current metadata snapshot, stop `metadata-worker` at a clean boundary; when imports are enabled, also stop `worker`. Quiesce other music writers and upload submissions while taking the snapshot. API readiness and existing playback can remain available. After a crash, first let the worker recover and stop cleanly; stale heartbeat alone is not a stopped-worker receipt.

Use the same overlay files and project name on every command. `METADATA_SNAPSHOT_ROOT` below must be an existing absolute private directory, mode 0700, owned by the service UID, outside the repository and music tree:

```sh
docker compose -f compose.yaml -f deploy/compose.metadata.yaml stop metadata-worker
docker compose -f compose.yaml -f deploy/compose.metadata.yaml run --rm --no-deps \
  -v "$METADATA_SNAPSHOT_ROOT:/snapshots" --entrypoint node metadata-worker \
  apps/api/dist/metadata-backup-entry.js create /snapshots/snapshot-unique-id
```

The command creates a new destination exclusively. It includes a SQLite online snapshot and matching key, private intents/original backup bytes, cover uploads referenced by the snapshot ledger, and an authenticated manifest of file hashes and current managed music digests. Transient self-test/cover-comparison directories and unreferenced orphan uploads are excluded. It refuses an active worker, inconsistent source bytes, a symbolic link or an existing destination. This is **not** a full host music or gonic/account backup: retain those separately at a matching boundary using the whole-stack procedure above. Snapshot manifests and copied original media are private.

Restore only into empty, separately named volumes. Create a private restore override containing:

```yaml
services:
  metadata-worker:
    volumes:
      - management-keys:/keys
```

The override makes only the new restore container's key volume writable. Provision new metadata volumes with `metadata-volume-init`; management/key volumes inherit the image's 0700 UID 1000 directories on their first mount. Use the same recorded UID/GID; never initialize the new API before restoration, since it would create another instance/key.

```sh
docker compose -p musiclatte-restore-new -f compose.yaml -f deploy/compose.metadata.yaml \
  run --rm --no-deps metadata-volume-init
docker compose -p musiclatte-restore-new -f compose.yaml -f deploy/compose.metadata.yaml \
  -f "$METADATA_RESTORE_OVERRIDE" run --rm --no-deps \
  -v "$METADATA_SNAPSHOT_ROOT:/snapshots:ro" --entrypoint node metadata-worker \
  apps/api/dist/metadata-backup-entry.js restore /snapshots/snapshot-unique-id
```

Restore validates the manifest, matching key/schema, private file hashes and current managed music bytes **before** copying into the empty volumes. Key publication uses exclusive copying with fsync because DB and key volumes may be on different filesystems. On failure it removes only files created in those initially empty targets. A different current music digest is rejected: restore the matching host music snapshot first, or complete appropriate file restore jobs before taking a fresh snapshot; never override that check.

For a historical rollback, invalidate old management sessions as described above before serving. Start the restored gonic/API and metadata worker with the ordinary read-only-key overlay, allow durable recovery to finish, and verify history, current file revisions, reflection, readiness and Range playback. Keep existing volumes and the immutable snapshot until verification is complete. Do not run the old image on v11 storage: complete file restores while the current image understands them, then restore the matching pre-upgrade DB/key/music/gonic snapshot together with its old image into new volumes.

한국어: 현재 schema는 v11이다. worker를 정상 정지한 뒤 DB·원래 key·metadata-data 원본/intent·참조 cover upload를 함께 백업한다. 실제 음악과 gonic 상태는 같은 경계의 별도 snapshot이 필요하다. 복원은 새 빈 volume에서만 실행하며 key volume 쓰기는 복원 컨테이너에만 허용한다. 파일 hash와 현재 음악이 다르면 중단한다. 구버전 image만 교체하거나 운영 volume을 덮어쓰지 않는다.

### Automation after an offline restore

A matching offline restore into new management/key/metadata directories preserves the existing
web/legacy session contract. It revokes all personal access tokens, removes automation job grants,
rotates claim/cursor epochs, drops curation snapshots and marks inventory stale. Reissue tokens
and acquire fresh claims after actual file/index revalidation. Historical completion receipts
remain evidence and do not make stale inventory writable. Use the optional automation overlay
and a fresh private fence volume with the same worker UID/GID; never replace a running production
volume or downgrade a database to roll back the overlay.
