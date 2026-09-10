# Musiclatte Server

[English](README.md)

소스 기반 self-hosted gonic gateway·관리 API다. S04에서 컨테이너 설치를 제공하며 React root는 비어 있다. 제품 UI·Gallery는 후속 Step이다. 기존 Musiclatte는 같은 origin-root `/rest`를 사용하며 관리 API는 선택적 확장이다.

## 별도 stack 설치

Docker Engine·Docker Compose v2, 읽기 가능한 기존 음악 디렉터리, 양수 session 수명을 준비한다. 컨테이너에는 host Node 설치가 필요 없다.

```sh
git clone https://github.com/yellowgg2/musiclatte-server.git
cd musiclatte-server
cp .env.example .env
# MUSIC_PATH, PUBLIC_ORIGIN, SESSION_MAX_AGE_SECONDS와 고유 project 이름 설정
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

gateway는 `127.0.0.1:8080`, gonic 관리 화면은 `127.0.0.1:4748`에만 bind하며 API host port는 없다. network가 없는 일회성 helper는 비어 있는 gonic volume만 초기 소유권을 설정한다. 기존 비어 있지 않은 volume의 소유권이 다르면 재귀 변경 없이 실패한다. 6개 named volume은 `COMPOSE_PROJECT_NAME`으로 분리하고 실제 저장 경로는 `docker volume inspect`로 확인한다. 업그레이드에도 project 이름을 유지하며 기존 demo volume을 재사용하지 않는다. 음악은 read-only다. gonic UID/GID를 읽기 권한에 맞추되 음악 전체를 world-writable로 바꾸지 않는다. API는 비어 있는 최초 관리 저장소에만 private key를 생성하며 기존 데이터에 key가 없으면 시작을 거부한다.

외부 reverse proxy·LAN 연결 **전에** loopback gonic 관리 화면에서 초기 관리자 비밀번호를 변경한다. 초기 계정 안내는 upstream gonic 문서를 참조하며 공유 로그에 복사하지 않는다. 원격 서버라면 SSH tunnel `ssh -L 4748:127.0.0.1:4748 <your-host>`을 열고 `http://127.0.0.1:4748`에서 설정한다. 별도 비관리자 감상 계정도 여기서 만든다. 관리 port는 외부에 게시하지 않는다. 한 명령 설치는 필수 초기 계정 설정을 생략한다는 의미가 아니다.

production은 운영자가 구성한 **HTTPS** reverse proxy가 public origin을 loopback gateway로 전달한다. 해당 proxy 로그에서도 credential·query·개인 음악 metadata를 제외하고 관리 port는 전달하지 않는다. `PUBLIC_ORIGIN`은 정확한 HTTPS origin이어야 한다. 이 저장소는 TLS·DNS·운영 서비스를 자동 변경하지 않으며 production Secure cookie를 요구한다.

격리 local HTTP 시험만 `docker compose -f compose.yaml -f deploy/compose.test.yaml up -d --build`를 사용한다. development cookie와 비어 있는 SPA opt-in을 명시한다. 별도 private LAN 개발 예외는 loopback 비밀번호 변경 완료 후 LAN 변수와 `ADMIN_SETUP_COMPLETE=true`를 설정하고 `docker compose -f compose.yaml -f deploy/compose.lan-development.yaml up -d --build`로 실행한다. flag는 운영자 확인 기록이며 비밀번호를 변경하거나 검사하지 않는다. production에 HTTP 예외를 쓰지 않는다. 기존 Musiclatte profile은 보존하고 gateway origin만 사용한 opt-in profile을 추가한다. `/api`나 admin port를 넣지 않는다.

`/rest/*`는 native 응답·Range 재생을 보존한다. `/api/*`와 discovery는 오류에도 SPA HTML을 반환하지 않는다. `/health/live`는 gateway process, `/health/ready`는 관리 DB·gonic 연결을 확인하며 로그인이나 scan을 수행하지 않는다. 장애 시 readiness가 실패해도 표준 routing·discovery는 별개이며 restart와 DNS 재조회로 복구를 지원한다. S04 UI는 시험용 `WEB_UI_ENABLED=true`를 명시하기 전 비활성화하고 production 개발 경로를 제외한다.

## 중단·업그레이드·복원

`docker compose stop`은 이 project만 중단하고 volume을 보존한다. `docker compose start`로 재개한다. 업그레이드 전 [backup·restore](deploy/backup/README.md)의 일관된 정지 snapshot을 만들고 소스 변경을 검토한 후 `docker compose up -d --build`를 실행한다. gonic digest 변경은 호환성·migration 검증을 요구한다. 이전 image로 복귀할 때 대응 DB snapshot도 복원한다. 일반 cleanup으로 `down -v`를 실행하지 않는다.

gateway 로그는 status·bytes·duration만 기록한다. request credential·개인 음악 metadata 노출 가능성이 있는 nginx raw error와 gonic 로그는 비활성화하고 API request 로그도 남기지 않는다. health state와 정제된 검증 evidence를 사용한다. 소스 공개 전 tracked file·전체 history의 secret·media·private fixture를 검사하고 deployment contract를 실행한다. 설치에 image registry push는 포함되지 않으며 license 선택은 미정이다.

## 개발·검증

Node **24.20.0**, npm **11.19.0**을 프로젝트별 shell/version manager에서 사용한다. `.nvmrc`와 `.node-version`을 따르며 host global Node를 교체할 필요는 없다.

```sh
npm ci
npm run typecheck
npm run test:unit -- tests/unit/workspace.test.ts apps/api/test/runtime.test.ts
npm run test:contract -- tests/contract/deployment.test.ts tests/contract/gateway-parity.test.ts
npm run build
```

API를 시작하기 전에 private key를 한 번 준비하고 `PUBLIC_ORIGIN`, `GONIC_UPSTREAM`, `MANAGEMENT_DIRECTORY`, `CREDENTIAL_KEY_PATH`, 양수 `SESSION_MAX_AGE_SECONDS`를 shell에 설정한다. [인증 설정과 API 계약](docs/architecture/auth-api.md)을 따른다. `.env` 자동 로딩은 없으며 production은 HTTPS 필수, scan은 기본 거부다. 준비 후 서로 다른 터미널에서 실행한다.

```sh
npm run dev:web
npm run dev:api
```

웹 기본 주소는 `http://127.0.0.1:5173/`이다. Gallery 승인 전이므로 React root는 비어 있다. API는 `http://127.0.0.1:3000/health/live`에서 `{"status":"ok"}`를 반환한다. 프로세스 생존 확인이며 upstream 준비 완료를 의미하지 않는다. 없는 경로는 404다.

웹 포트는 `npm run dev:web -- --port 5174`, API 포트는 `PORT=3001 npm run dev:api`로 변경한다. 빌드한 API는 `npm run start -w @musiclatte/api`로 실행한다.

[Runtime 결정](docs/architecture/runtime.md)과 [S00 검증](docs/verification/phase-1/step-00.md), [S03 인증·호환성 검증](docs/verification/phase-1/step-03.md)을 참조한다. `typecheck`는 shared package 선언을 먼저 생성해 clean checkout에서도 소비자 검사가 가능하다.

비밀값·실제 음악·개인 fixture·runtime data·로컬 에이전트 설정은 Git/Docker에 포함하지 않는다. `.env.example`은 안전한 기본값과 운영자가 채울 placeholder를 제공한다. **최종 license는 미선택**이며 임의 LICENSE나 오픈소스 사용권을 선언하지 않았다. npm의 `UNLICENSED`와 workspace의 `private`는 package 게시 방지 설정이다. 컨테이너 설치 구성은 S04가 소유한다.

## 코드 포맷

프로젝트에 Prettier 3.9.6을 고정했다. `npm run format`으로 정리하고 `npm run format:check`로 검사한다. 공통 설정은 공백 2칸, 줄 너비 기준 100, single quote다. 생성물·lockfile·runtime data와 별도 plugin이 없는 shell/SQL/nginx 파일은 제외한다.

권장 Prettier 확장이 설치된 VS Code에서는 workspace 설정으로 저장 시 포맷한다. Codex의 직접 파일 쓰기는 에디터 저장 hook을 거치지 않으므로 프로젝트 `AGENTS.md`에 검증 전 format·완료 전 format:check 규칙도 추가했다. 별도 formatter MCP나 전역 Codex 변경은 필요 없다.

## 선택 기능: YouTube 가져오기

기본 명령 `docker compose up -d --build`는 유지되며 imports는 기본 비활성이다. gonic 최초 관리자 설정 후 scan 권한이 있는 전용 worker 계정을 만든다. JSON credential과 import policy는 저장소 밖 private 경로에 두고 `.env`에는 절대 파일 경로(`IMPORT_CREDENTIAL_FILE`, `IMPORT_POLICY_FILE`)만 기록한다. 형식은 [private 설정 가이드](docs/architecture/import-deployment.md)를 따른다. API의 private SQLite volume을 공유하므로 UID/GID 1000:1000을 유지하고 host 음악 디렉터리에 해당 worker의 제한된 쓰기 권한을 준비한다. API/gonic은 읽기 전용이다. root 실행, 음악 전체 recursive chown, world-writable 권한으로 문제를 숨기지 않는다.

```sh
docker compose -f compose.yaml -f deploy/compose.imports.yaml config --quiet
docker compose -f compose.yaml -f deploy/compose.imports.yaml up -d --build
docker compose -f compose.yaml -f deploy/compose.imports.yaml exec worker node apps/api/dist/worker-entry.js --check-config
docker compose -f compose.yaml -f deploy/compose.imports.yaml exec worker node apps/api/dist/worker-entry.js --healthcheck
```

한 번의 시작 명령이 worker 도구까지 로컬 build한다. config probe는 고정된 valid/disabled/error 상태만 출력하고 healthcheck는 credential·network 없이 기존 DB/heartbeat만 검사한다. 최초 private 파일 누락·권한 불일치는 실패로 처리한다. worker/nightly 장애 중에도 기존 음악 재생과 gateway/API는 유지된다. 웹 imports/recent/engine 진입점은 UI Step 10–12까지 비활성이다.

업데이트 전 worker를 정지하고 [management+key+gonic+engine+host 음악의 matching backup](deploy/backup/README.md)을 만든 뒤 같은 두 파일 명령으로 재빌드한다. staging은 복구 가능한 작업 공간으로 backup에서 제외한다. 현재 Phase 3 DB는 v8(최초 v3 migration)이고 base 시작도 DB를 migration한다. overlay 제거는 음악을 보존하지만 schema를 되돌리지 않는다. v2 rollback에는 matching pre-upgrade snapshot과 구버전 빌드가 필수다. 초기 volume 준비 probe와 update/rollback 순서는 [배포 가이드](docs/architecture/import-deployment.md)를 참고한다.

## 선택적 감상 확장

기본 stack은 믹스, 로컬 감상 기록, gonic scrobble 전달, 절약 재생, 아티스트 정보를 모두
명시적 `false` flag로 전달합니다. 완성된 조합은 다음 overlay로 활성화합니다.

```sh
docker compose -f compose.yaml -f deploy/compose.listening.yaml config --quiet
docker compose -f compose.yaml -f deploy/compose.listening.yaml up -d --build
```

overlay는 API flag만 바꾸며 gonic의 기존 ffmpeg cache와 artist lookup을 재사용합니다. 새
provider 계정·key·daemon·worker를 만들지 않습니다. scrobble 전달을 켜면 사용자가 gonic에
이미 연결한 외부 서비스로 qualified play가 전달될 수 있습니다. overlay를 끄면 새 진입점과
기록만 중단되고 schema v21과 기존 데이터는 유지됩니다. 과거 시점 rollback은
[백업·복원](deploy/backup/README.md)의 matching management DB/key와 gonic/music snapshot을
함께 복원해야 하며 image만 낮추면 안 됩니다.

## 선택적 음악 metadata 편집

private policy와 scan credential을 설정한 뒤 `docker compose -f compose.yaml -f deploy/compose.metadata.yaml up -d --build`로 실행한다. imports와 독립적이며 함께 쓸 때는 imports overlay를 metadata overlay 앞에 추가한다. API는 음악을 읽기만 하고, 전용 worker가 파일 변경과 private 원본 backup을 담당한다. [배포 가이드](docs/architecture/metadata-deployment.md)와 [v11 matching 백업·복원](deploy/backup/README.md)을 따른다. worker가 중지돼도 기존 음악 재생은 유지된다. 파일 저장과 gonic 반영은 별도 결과이며, 이미 사용한 gonic cover cache 때문에 반영 검증이 지연될 수 있다. 웹 metadata 진입점은 Phase 4 S09에서 활성화한다.

### 선택적 메타데이터 자동화

imports·metadata overlay 다음에 `deploy/compose.automation.yaml`을 추가합니다.
`AUTOMATION_POLICY_FILE`은 소유자만 읽는 `0600` 절대 경로 JSON이며 정확한 예시는
영문 README의 Optional metadata automation 항목을 참고하세요. API·metadata worker·import
worker의 UID/GID를 일치시켜야 합니다. 세 프로세스는 전용 `media-fence` 볼륨을 공유하며,
API의 음악 읽기 전용 권한과 작업자 전용 백업 저장소 경계를 유지합니다. overlay가 없으면
자동화는 비활성입니다.

작업자는 복구·파일 쓰기·반영·제한된 inventory 순회를 차례로 처리하고, 재시작 시 checkpoint에서
이어갑니다. 복원된 inventory는 즉시 재검증합니다. `tools/verification/automation-http-client.ts`는
private config/credential 파일로 HTTP 흐름을 검증하는 소스 전용 클라이언트입니다.
`automation-runtime-probe.ts`는 소유 표식이 있는 격리 Linux 임시 프로젝트와 자작 MP3에서만
재시작·백업·복원을 검증합니다. 실제 비밀값, 음악, private config는 Git에 넣지 않습니다.
