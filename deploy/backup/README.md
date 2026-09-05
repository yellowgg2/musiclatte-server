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
