# Musiclatte Server

[English](README.md) · [MIT 라이선스](LICENSE)

Musiclatte Server는 [gonic](https://github.com/sentriz/gonic)을 기반으로 동작하는 셀프 호스팅
웹 플레이어이자 관리 계층입니다. 개인 음악 라이브러리를 깔끔한 웹 UI에서 탐색하고 재생할 수
있으며, 가져오기·메타데이터 편집·감상 기록·믹스 등의 기능은 필요할 때만 추가할 수 있습니다.

기본 설치는 음악 디렉터리를 읽기 전용으로 사용합니다. gonic의 Subsonic 호환 `/rest` API를
그대로 제공하므로 기존 호환 클라이언트도 같은 서버 주소를 계속 사용할 수 있습니다.

## 화면

![Musiclatte 로그인 화면](docs/verification/phase-1/step-06/login-ko-desktop.png)

![가상 fixture를 사용한 Musiclatte 음악 화면](docs/verification/major-layout/desktop.png)

모든 스크린샷은 로컬 synthetic fixture로 촬영했습니다. 운영 서버 주소, 실제 계정, 개인 음악
메타데이터, 앨범 이미지 및 저작권이 있는 음악을 포함하지 않습니다.

## 주요 기능

- 반응형 한국어·영어 웹 인터페이스
- 음악 탐색·검색·즐겨찾기·재생목록·재생
- gonic 호환 인증과 Subsonic API routing
- 선택적 감상 기록·믹스·음질 선택·아티스트 정보
- 선택적 YouTube 가져오기·메타데이터 편집·자동화
- 설치별 영구 volume을 사용하는 Docker Compose 배포

## 빠른 설치

### 준비물

- Docker Engine과 Docker Compose v2
- Docker가 읽을 수 있는 기존 음악 디렉터리
- Git

컨테이너 설치에는 호스트 Node.js가 필요하지 않습니다.

### 1. 내려받고 설정하기

```sh
git clone https://github.com/yellowgg2/musiclatte-server.git
cd musiclatte-server
cp .env.example .env
```

`.env`에서 다음 두 값을 설정합니다.

```dotenv
MUSIC_PATH=/음악/디렉터리의/절대/경로
SESSION_MAX_AGE_SECONDS=2592000
```

`MUSIC_PATH`는 이미 존재하는 절대 경로여야 합니다. 위 세션 수명 예시는 30일입니다. 업그레이드
시 이 설치의 volume을 식별하는 `COMPOSE_PROJECT_NAME`을 변경하지 마세요.

### 2. loopback 전용 설치 시작하기

```sh
docker compose -f compose.yaml -f deploy/compose.test.yaml config --quiet
docker compose -f compose.yaml -f deploy/compose.test.yaml up -d --build
docker compose -f compose.yaml -f deploy/compose.test.yaml ps
```

이 profile은 최초 설정과 같은 컴퓨터에서의 로컬 사용을 위한 것입니다. Musiclatte gateway는
`127.0.0.1:8080`, gonic 관리 화면은 `127.0.0.1:4748`에만 연결됩니다.

### 3. gonic을 보호하고 로그인하기

1. `http://127.0.0.1:4748`을 엽니다.
2. [gonic 최초 설치 안내](https://github.com/sentriz/gonic#installation)에 따라 초기 관리자
   비밀번호를 즉시 변경합니다.
3. 음악 감상에 사용할 별도 비관리자 계정을 만듭니다.
4. `http://127.0.0.1:8080`에서 Musiclatte를 열고 해당 계정으로 로그인합니다.

원격 서버에서는 관리 port를 비공개로 유지하고 최초 설정에 SSH tunnel을 사용합니다.

```sh
ssh -L 4748:127.0.0.1:4748 your-server
```

그다음 로컬에서 `http://127.0.0.1:4748`을 엽니다. gonic 관리 port를 공용 reverse proxy에
게시하지 마세요.

## 선택 기능

기본 설치는 웹 플레이어와 gonic gateway를 제공합니다. 필요한 overlay만 추가하세요. 아래 예시는
loopback 전용 빠른 설치 profile을 유지합니다. 운영 HTTPS profile을 구성한 뒤에만
`deploy/compose.test.yaml`을 제외하세요. 해당 설치의 모든 Compose 명령에서 아래에 표시된 파일
순서를 유지해야 합니다.

| 기능              | 추가되는 기능                                                          | Compose overlay                  | 설정 안내                                                     |
| ----------------- | ---------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------- |
| 감상 경험         | 로컬 감상 기록, 믹스, 음질 선택, 아티스트 정보 및 선택적 scrobble 전달 | `deploy/compose.listening.yaml`  | [감상 기능 구조](docs/architecture/listening-web.md)          |
| YouTube 가져오기  | 승인된 미디어를 설정한 라이브러리 하위 디렉터리에 저장하는 worker      | `deploy/compose.imports.yaml`    | [가져오기 배포](docs/architecture/import-deployment.md)       |
| 메타데이터 편집   | 비공개 복구 데이터를 보존하며 제목·아티스트·앨범·커버 등의 tag 변경    | `deploy/compose.metadata.yaml`   | [메타데이터 배포](docs/architecture/metadata-deployment.md)   |
| 메타데이터 자동화 | 정책 기반 검토·정리 작업. 가져오기와 메타데이터 overlay 필요           | `deploy/compose.automation.yaml` | [메타데이터 자동화](docs/architecture/metadata-automation.md) |

### 감상 경험

추가 worker나 영구 volume이 필요 없는 가장 간단한 선택 기능입니다.

```sh
docker compose \
  -f compose.yaml \
  -f deploy/compose.listening.yaml \
  -f deploy/compose.test.yaml \
  up -d --build
```

사용자가 gonic에 외부 scrobbling 서비스를 이미 연결한 경우에만 조건을 충족한 재생 기록이 해당
서비스로 전달될 수 있습니다. Overlay를 끄면 Musiclatte의 새 감상 기록은 중단되지만 기존 데이터는
삭제되지 않습니다.

### YouTube 가져오기

가져오기에는 scan 권한을 가진 전용 gonic 계정, 비공개 credential 파일, 비공개 policy 파일과
대상 음악 디렉터리의 제한된 쓰기 권한이 필요합니다.
[`deploy/import-policy.example.json`](deploy/import-policy.example.json)에서 시작하고, 값을 채운
policy와 credential은 저장소 밖에 보관하세요. Worker를 시작하기 전에
[가져오기 배포 가이드](docs/architecture/import-deployment.md)를 따라야 합니다.

```sh
docker compose \
  -f compose.yaml \
  -f deploy/compose.imports.yaml \
  -f deploy/compose.test.yaml \
  up -d --build
```

### 메타데이터 편집과 자동화

메타데이터 편집은 가져오기와 독립적으로 사용할 수 있습니다. API는 계속 음악을 읽기 전용으로
mount하고, 전용 worker만 파일 변경과 비공개 복구 자료를 관리합니다.

```sh
docker compose \
  -f compose.yaml \
  -f deploy/compose.metadata.yaml \
  -f deploy/compose.test.yaml \
  up -d --build
```

자동화에는 두 worker overlay와 소유자만 읽을 수 있는 automation policy가 모두 필요합니다.
다음 조합을 활성화하기 전에 메타데이터 배포·자동화 가이드를 읽으세요.

```sh
docker compose \
  -f compose.yaml \
  -f deploy/compose.imports.yaml \
  -f deploy/compose.metadata.yaml \
  -f deploy/compose.automation.yaml \
  -f deploy/compose.test.yaml \
  up -d --build
```

값을 채운 credential·policy, backup, 다운로드 미디어 및 runtime data를 commit하지 마세요.

## LAN과 운영 환경 접속

빠른 설치는 의도적으로 loopback에서만 로컬 HTTP를 사용합니다. 운영 환경에서는 운영자가 관리하는
HTTPS reverse proxy 뒤에 gateway를 두고 `PUBLIC_ORIGIN`을 정확한 공개 HTTPS origin으로
설정하세요. 최초 gonic 설정을 마친 뒤 `WEB_UI_ENABLED=true`로 설정하고, gonic 관리 port는
proxy하지 마세요.

Reverse proxy가 loopback gateway에 직접 연결할 수 있다면 완성한 `.env`를
`docker compose config --quiet`으로 검증한 뒤 운영 기본 명령 `docker compose up -d --build`를
사용합니다.

다른 컨테이너의 reverse proxy가 host loopback에 연결할 수 없다면 먼저 gonic 비밀번호 변경을
마칩니다. 그다음 `LAN_BIND_ADDRESS`, `PRODUCTION_LAN_PORT`,
`ADMIN_SETUP_COMPLETE=true`를 설정하고 `deploy/compose.production-lan.yaml`을 추가합니다.

```sh
docker compose -f compose.yaml -f deploy/compose.production-lan.yaml config --quiet
docker compose -f compose.yaml -f deploy/compose.production-lan.yaml up -d --build
```

명시적으로 신뢰하는 private LAN 개발 환경에는 `deploy/compose.lan-development.yaml`을
사용합니다. 해당 LAN에서 gonic 계정 관리까지 필요할 때만 `deploy/compose.lan-admin.yaml`을
추가하세요. 두 profile 모두 초기 비밀번호를 먼저 변경해야 합니다.
`ADMIN_SETUP_COMPLETE=true`는 운영자가 이를 완료했다는 기록일 뿐 변경이나 검증을 대신하지
않습니다.

## 업데이트와 백업

`docker compose stop`과 `docker compose start`는 이 설치의 named volume을 보존합니다.
업데이트 전에 관련 서비스를 중단하고 관리 DB·key·gonic 상태와 쓰기 가능한 음악 데이터의 시점이
일치하는 snapshot을 만드세요. [백업·복원 가이드](deploy/backup/README.md)를 따르고, 일반 정리
명령으로 `docker compose down -v`를 사용하거나 새 DB를 유지한 채 image만 downgrade하지 마세요.

## 개발

프로젝트별 version manager나 shell에서 Node **24.20.0**과 npm **11.19.0**을 사용하세요.
`.nvmrc`와 `.node-version`에 필요한 runtime이 고정되어 있습니다.

```sh
npm ci
npm run typecheck
npm run test:unit -- tests/unit/workspace.test.ts apps/api/test/runtime.test.ts
npm run test:contract -- tests/contract/deployment.test.ts tests/contract/gateway-parity.test.ts
npm run build
```

개발 환경 설정은 [runtime 문서](docs/architecture/runtime.md)와
[인증/API 계약](docs/architecture/auth-api.md)을 참고하세요.

## 보안과 개인정보

- `.env`, credential, policy, backup, 음악 및 runtime DB를 Git에 넣지 마세요.
- 기본 음악 라이브러리는 읽기 전용으로 mount하고 worker에는 변경할 경로만 허용하세요.
- LAN이나 proxy 접속을 켜기 전에 초기 gonic 관리자 비밀번호를 변경하세요.
- 일상적인 음악 감상에는 별도 비관리자 계정을 사용하세요.
- gonic 관리 port는 비공개로 유지하세요.
- fork를 공개하기 전에 tracked file과 Git history에서 비밀값과 개인 미디어를 검사하세요.

제3자 구성 요소에는 각자의 라이선스가 적용됩니다.
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 참고하세요.

## 라이선스

Musiclatte Server는 [MIT License](LICENSE)에 따라 제공됩니다.
