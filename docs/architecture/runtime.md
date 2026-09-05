# Runtime과 workspace 결정

S00은 Node 24.20.0 LTS / npm 11.19.0에서 실행·검증했다. 정확한 직접 의존성과 전이 의존성은 package manifests와 package-lock.json에 고정했다. 전역 Node 변경은 없다. S04 배포 이미지도 같은 Node 계약을 사용하거나 근거·version file·검증을 함께 갱신해야 한다.

| 패키지                   | 고정 버전         | 확인한 지원 근거                                |
| ------------------------ | ----------------- | ----------------------------------------------- |
| Node / npm               | 24.20.0 / 11.19.0 | Node 공식 release index의 LTS 배포 및 포함 npm  |
| React / React DOM        | 19.2.8 / 19.2.8   | React 공식 설치 문서, npm peerDependencies 일치 |
| Vite                     | 8.2.2             | engines: ^20.19.0 또는 >=22.12.0                |
| Vitest                   | 5.0.0             | engines에 Node ^24.0.0, peer Vite ^8.0.0 포함   |
| Fastify                  | 5.12.3            | Fastify LTS 정책의 지원 중 Node LTS line        |
| TypeScript / tsx         | 7.0.2 / 4.23.13   | registry engines >=16.20.0 / >=18.0.0           |
| @types/node              | 24.13.3           | runtime과 같은 major 24                         |
| @types/react / react-dom | 19.2.18 / 19.2.7  | React 19 type line                              |

공식 자료: [Node 배포 index](https://nodejs.org/dist/index.json), [Node release 정책](https://github.com/nodejs/Release), [React 설치](https://react.dev/learn/installation), [Vite 지원](https://vite.dev/guide/), [Vitest 지원](https://vitest.dev/guide/), [Fastify LTS](https://fastify.dev/docs/latest/Reference/LTS/). Exact package metadata는 npm registry에서 설치 직전 확인했다. Node archive는 공식 SHASUMS256.txt와 SHA-256을 대조했다.

## 구성

- `apps/web`: Vite + React, strict TypeScript, Vite CSS Modules. S00에는 스타일/공유 component/화면을 만들지 않고 `createRoot(root).render(null)`만 실행한다.
- `apps/api`: Fastify `createApp`, `readConfig`와 별도 listening entry. `/health/live`는 `HealthResponse`를 반환한다. S03 listening entry는 `createConfiguredApp`으로 인증·고정 upstream·관리 DB를 조립하며 CORS를 열지 않는다. 필수 설정과 key provisioning은 `auth-api.md` 참조.
- `packages/contracts`: HealthResponse, S01 Subsonic domain, S03 session/discovery/capability/error v1 schema를 제공한다.
- `packages/test-support`: private, 합성 health/Subsonic fixture를 제공한다. production API와 web은 runtime import하지 않는다.
- root unit와 contract config는 분리하며 0 test를 성공 처리하지 않는다. `typecheck`가 shared declaration build 후 전체 root/test/config와 각 workspace를 검사한다.

## 환경 설정

| 환경변수        | 기본        | 계약                                                                       |
| --------------- | ----------- | -------------------------------------------------------------------------- |
| HOST            | 127.0.0.1   | IP literal 또는 localhost; 외부 binding은 명시 설정                        |
| PORT            | 3000        | 1–65535 정수; 잘못된 값은 listen 전 거부                                   |
| NODE_ENV        | development | development, test, production                                              |
| VITE_APP_BASE   | /           | `/music/` 같은 slash로 끝나는 segment 경로; origin과 분리                  |
| VITE_API_ORIGIN | 빈 값       | 빈 값은 same-origin; 그 외 credentials/path/query/hash 없는 HTTP(S) origin |

API는 환경변수를 shell로 전달한다. `.env`를 자동 로딩하지 않는다. 웹은 workspace의 Vite env 파일과 shell 변수를 Vite 방식으로 읽는다. VITE_ 값은 공개 가능한 browser 설정만 사용한다. API origin은 향후 API consumer를 위한 기반이며 S00에서 음악 요청은 하지 않는다.

## Locale

지원 locale은 `ko`, `en`. 두 JSON에 `status.preparing` 1개씩 비어 있지 않은 번역이 있고 아직 제품 화면에서 소비하지 않는다. `formatCount`는 0 이상의 안전한 정수만 허용하며 Intl.NumberFormat을 사용한다. `formatDate`는 locale medium date, 기본 UTC를 사용하며 호출자가 IANA timezone을 전달할 수 있다. 음악 콘텐츠 번역은 하지 않는다.

## 경계

GitHub public repository 생성은 사용자 지시로 수행했다. 소스 commit/push와 운영 배포는 수행하지 않았다. License는 미선택이다. 실제 media·비밀값·local agent state·generated output은 Git/Docker 제외 대상이며 공개 sample에는 개인 서버 경로나 사용자 음악 정보를 적지 않는다.
