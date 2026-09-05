# Session / instance / operation receipt 저장 경계

관리 데이터만 소유하는 server-only 저장소다. S03 `auth/runtime.ts`가 이 모듈을 조립해 HTTP 로그인·cookie·rotation·logout·권한 재검증을 제공한다 (`auth-api.md` 참조). S02는 기존 API entry에 저장소나 인증 route를 자동 연결하지 않는다.

## Provider와 실행

- Node **24.20.0**에 포함된 `node:sqlite`를 사용한다. 로컬 runtime probe: SQLite **3.53.4**, npm **11.19.0**. 별도 npm provider/네이티브 addon은 추가하지 않았다. `.nvmrc`, `.node-version`, package engines의 exact Node pin이 provider pin이다.
- [Node SQLite 공식 문서](https://nodejs.org/docs/latest-v24.x/api/sqlite.html): 현재 release candidate API다. `DatabaseSync`와 online `backup`을 사용한다. 런타임 변경 시 저장소/복원 테스트를 다시 수행한다.
- `openDatabase(managementDirectory)`는 해당 디렉터리의 `management.sqlite`만 연다. gonic data, music root와 다른 API 전용 영속 volume/path를 전달해야 한다. 이 Step은 volume/deployment를 생성하지 않는다.
- 새 디렉터리/DB는 0700/0600으로 생성한다. 기존 parent 디렉터리는 운영자가 API UID만 접근하도록 준비한다. DB/키 경로는 신뢰된 서버 설정이며 요청 payload로 받지 않는다. 기존 DB의 foreign schema는 수정 전에 거부한다.
- `apps/api` build가 SQL migration을 `dist/storage/migrations`에 복사한다. migration은 `import.meta.url` 기준으로 로드하므로 실행 cwd에 의존하지 않는다.

## Schema와 원자성

`storage/migrations/001-session.sql`은 변경하지 않고 `002-playlist-operations.sql`을 순서대로 적용한다. fresh DB의 0→1→2와 기존 v1의 1→2 upgrade 전체를 하나의 `BEGIN IMMEDIATE` transaction으로 실행하며, 어느 migration이나 최종 schema 검증이 실패하면 시작 version과 기존 table/data를 그대로 보존한다. SQLite application ID `1296843092`, 현재 user_version `2`를 검사하며 foreign/미지원 version을 자동 reset·downgrade하지 않는다.

| 원장                | 필드 / 의미                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| instance            | singleton, UUID id, 양수 policy_revision, key_id(SHA-256 key fingerprint)                                                  |
| sessions            | id_hash(SHA-256 opaque token), instance_id, policy_revision, username, encrypted_proof, created_at, expires_at, revoked_at |
| playlist_operations | identity_key(HMAC), operation_id_hash, request_hash, kind, nullable resource/revision 결과, status, created/finished epoch |

모든 시간은 epoch milliseconds, 정수이며 expiry는 created보다 커야 한다. playlist/media payload, raw password, adminRole, 사용자별 가짜 음악 ACL은 저장하지 않는다. username은 개인정보이므로 DB 자체도 비공개다.

`createInstanceRepository`는 최초 UUID를 보존하고 key fingerprint를 검사한다. `bumpPolicyRevision()`은 revision 증가와 기존 credential 폐기를 원자적으로 처리한다. revision은 권한 값의 cache가 아니다. S03 관리 action은 실제 upstream identity/role을 다시 확인해야 한다.

## Playlist operation receipt

`createPlaylistOperationRepository({database,clock})`는 synchronous `claim/get/markApplied/markUncertain/markFailed` API를 제공한다. `(identity_key,operation_id_hash)`가 primary key다. 최초 `claim`만 `pending`을 만들고, 같은 request hash와 kind의 재호출은 저장된 receipt를 반환하며, 다른 요청으로 같은 operation hash를 재사용하면 `conflict`를 반환한다. 계정과 instance를 포함해 caller가 만든 identity HMAC이 다른 operation은 서로 격리된다.

허용 상태 전이는 `pending→applied|uncertain|failed`와 복구 확인을 위한 `uncertain→applied`뿐이다. `applied`에는 caller가 재조회로 확정한 nullable resource ID와 before/after revision만 기록한다. transaction 내부에서는 SQLite 읽기·쓰기만 하며 Subsonic/network promise나 async callback을 실행하지 않는다.

receipt는 playlist 원장이 아니다. raw operation ID, playlist 이름, song ID/order, credential을 받거나 저장하지 않으며 현재 playlist 내용은 항상 gonic에서 재조회한다. Phase 2에서는 correctness를 위해 자동 삭제하지 않는다. 보관 기간이나 cleanup schedule은 운영 근거가 생기는 후속 owner가 정한다.

WAL + synchronous FULL + foreign_keys ON, writer busy timeout 100ms를 사용한다. timeout은 lock 충돌의 빠른 실패를 위한 구현값이며 SLA가 아니다. `transaction`은 BEGIN IMMEDIATE/COMMIT/ROLLBACK이며 **동기 callback만** 허용한다. callback 내부에 async 작업을 예약하지 않는다. HTTP/network 작업은 transaction 밖에서 수행한다. 다른 connection의 writer 충돌은 `Storage unavailable`로 실패하며 호출자가 작업 의미에 맞게 재시도한다.

## Credential / key

`createKey(path)`는 첫 설치에만 호출한다. 32바이트 무작위 key를 0600 임시 파일에 fsync한 뒤 no-clobber link로 게시하고 parent도 fsync한다. 기존 key는 덮어쓰지 않는다. 매 시작은 `loadKey(path)`로만 읽는다. 누락, 잘못된 길이, group/other 권한 또는 symlink key는 `Reauthentication required`로 실패한다.

`createCredentialVault`는 Node crypto의 AES-256-GCM, 무작위 12바이트 IV, 16바이트 auth tag를 사용한다. [Node authenticated encryption API](https://nodejs.org/docs/latest-v24.x/api/crypto.html#deciphersetauthtagbuffer-encoding)의 인증 완료 전에 plaintext를 반환하지 않는다. key 입력은 복사한다.

Envelope: `1.keyId.iv.ciphertext.tag` (binary 필드는 canonical base64url). AAD는 envelope version/key identity와 session hash, instance ID, policy revision, username, created/expires를 포함한다. row 간 암호문 이동, 수명 변조, 다른 key, 잘못된 version/tag는 거부한다. 암호화할 필드는 `{username,t,s}`만 투영하며 extra password/role은 포함하지 않는다.

키는 DB와 분리된 secrets volume/path에서 보관한다. 프로세스에는 plaintext proof가 일시적으로 필요하므로 저장소/복호화 결과를 로그 또는 HTTP JSON으로 직렬화하지 않는다. 오류는 고정 메시지이며 crypto/SQLite raw cause를 붙이지 않는다.

## 세션 API와 수명 설정

```ts
const { maxAgeMs } = readSessionPolicy(process.env);
const database = openDatabase(managementDirectory);
const vault = createCredentialVault(loadKey(keyPath));
const sessions = createSessionRepository({ database, vault, maxAgeMs, clock: Date.now });
```

- `SESSION_MAX_AGE_SECONDS`는 **필수 양수 정수**이며 기본 보존 기간은 없다. 공백/소수/지수/0/음수/unsafe 정수는 실패한다. S03 `createConfiguredApp` listening entry가 이 설정을 필수로 소비한다.
- `create(proof)`는 upstream 검증 완료 후에만 호출한다. S03은 `currentUser`가 반환한 canonical username을 사용한다. 이 함수 자체가 계정 인증을 수행하지 않는다.
- 결과 `{token,expiresAt}`의 token은 32바이트 CSPRNG base64url bearer다. DB에는 SHA-256 hash만 저장한다. HTTP cookie 정책과 rotation은 S03 소유다.
- `find(token)`은 유효하면 server-only `{username,proof,expiresAt,instanceId,policyRevision}`를 반환한다. unknown/expired/revoked/row 변조는 null이다. DB 장애는 고정 `Storage unavailable`로 실패해 운영 장애와 인증 부재를 구분할 수 있다.
- 만료 경계는 `now >= expiresAt`. 기존 absolute expiry는 설정 증가로 연장되지 않는다. 생성 이전으로 역행한 시계의 세션은 거부한다. invalid clock/overflow는 무기한 세션을 만들지 않는다.
- `revoke(token)`은 idempotent하며 encrypted_proof를 NULL 처리한다. 만료/손상 세션을 조회할 때도 credential을 폐기한다. 주기적 만료 청소나 row retention schedule은 아직 없다. 실행하지 않은 idle session의 암호문이 즉시 지워진다고 주장하지 않는다.
- NULL 갱신은 논리적 폐기다. 과거 WAL/free page/이전 backup의 물리적 삭제를 보증하지 않는다. 파일/key/backup 접근 제한이 계속 필요하다.

## Backup / restore

`createBackup(database,keyPath,newDirectory)`는 **성공 resolve한 뒤에만** 완료된 snapshot이다. source transaction 중 호출하지 않는다. snapshot 파일은 `management.sqlite`와 `credential.key`; 목적 디렉터리는 새로 생성해야 한다.

1. 현재 key와 instance fingerprint/schema를 확인한다.
2. SQLite online backup으로 커밋된 WAL 상태를 일관된 DB에 담는다. 실행 중 DB 파일 하나를 복사하는 방식이 아니다.
3. 같은 immutable key를 보관하고 quick_check, foreign keys, schema v2, instance/key, 미폐기 credential envelope와 모든 receipt row를 확인한다. receipt와 그 status도 같은 online SQLite snapshot에 포함되며 CHECK를 우회해 변조된 row는 복원 전에 거절한다. DB/key/directory를 fsync한다.
4. 함수 실패 시 이번 호출이 만든 목적지만 정리한다. 프로세스 강제 종료의 잔여 디렉터리는 완료된 backup으로 취급하지 않는다. 성공 전 artifact를 외부에 게시하지 않는다.

`restoreBackup(completedSnapshot,newDirectory)`는 **offline 새 경로** 복원이다. 기존 디렉터리/서비스를 덮어쓰지 않으며 raw file copy 대신 SQLite backup API로 복원한다. schema, key, integrity, envelope를 복사 전후 검증하고 실패 시 부분 복원을 정리한다. 이후 관리 DB path와 keyPath를 새 복원 위치에 함께 지정한다. 복원 경로의 key는 `credential.key`이며 별도 secrets volume으로 옮길 경우 서비스가 정지한 상태에서 대응 key를 보존한다.

키 없는/다른 키의 snapshot은 복원 불가다. 키를 새로 생성해 기존 session을 우회 복구하지 않는다. 원래 key+DB 쌍을 복구하거나, 운영자가 별도 새 관리 저장소/key를 초기화하고 모든 사용자가 다시 로그인해야 한다. unknown migration version도 해당 version을 지원하는 코드와 대응 backup으로 복구한다.

Snapshot 이후 logout/revocation/policy 변경은 오래된 backup에 없을 수 있다. 과거로 rollback할 때는 HTTP serving 전에 복원 instance의 `bumpPolicyRevision()`으로 기존 세션을 모두 무효화하고 재로그인을 요구한다. 정상 같은 시점 복원 fixture는 당시 유효 session과 당시 revocation/expiry를 보존한다.

복원된 applied receipt의 동일 claim은 새 write가 아니라 기존 receipt다. 단, 이는 관리 DB/key의 경계일 뿐이며 gonic DB/playlist/media와 전체 stack의 일치하는 복원·운영 cutover는 S04 및 후속 데이터 owner가 별도로 검증한다.

## 검증

초기 session 저장소 evidence는 `docs/verification/phase-1/step-02.md`, schema v2와 playlist operation receipt evidence는 `docs/verification/phase-2/step-02.md`에 기록한다. 공개 test는 합성 fingerprint/proof만 사용하고 모든 파일은 고유 OS temporary directory에 생성·정리한다.
