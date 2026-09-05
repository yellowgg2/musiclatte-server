# 인증·capability API — S03 / schema v1

S01 고정 gonic adapter와 S02 관리 저장소를 Fastify HTTP API에 연결한다. 웹 UI는 S06, gateway/Compose는 S04다. 기존 gonic `/rest`·iOS·bot 코드는 변경하지 않는다. `getUser.folder`는 버리고 인증된 사용자가 인스턴스 library를 공유하는 기존 모델을 유지한다.

## 실행과 저장

`server.ts` → `auth/runtime.ts:createConfiguredApp` → `createApp(AuthOptions)`가 실제 entry다. 인자 없는 `createApp()`은 liveness/test용이며 실제 listening entry는 필수 인증 설정 없이 시작하지 않는다.

| 변수 | 의미 |
|---|---|
| `PUBLIC_ORIGIN` | 신뢰된 브라우저 HTTP(S) origin; path/query/hash/credential 불가, production은 HTTPS 필수 |
| `GONIC_UPSTREAM` | 요청이 바꿀 수 없는 고정 origin-root gonic URL; redirect 추종 금지 |
| `MANAGEMENT_DIRECTORY` | gonic/media와 별개인 절대 private 관리 디렉터리 |
| `CREDENTIAL_KEY_PATH` | 기존 32바이트 key의 절대 경로; 매 시작 load만, 자동 재생성 없음 |
| `SESSION_MAX_AGE_SECONDS` | 필수 양수 정수; 암묵적 보존 기간 없음 |
| `SUBSONIC_TIMEOUT_MS` | 기본 5000ms; 양수 정수, 최대 2147483647; upstream 요청 구현 timeout이며 제품 SLA가 아님 |
| `ALLOW_SCAN` | 기본 false; 정확히 true/false만 허용; true도 upstream adminRole을 대신하지 않음 |

`.env` 자동 로딩은 없다. `.env.example`의 placeholder와 빈 수명 값은 실행 가능한 운영 정책이 아니다. 최초 key는 운영자가 새 private 위치에서 S02 `createKey(path)`로 **한 번 명시적으로** 준비한다. 예: 빌드 후 `CREDENTIAL_KEY_PATH`를 설정하고 `node --input-type=module -e 'import { createKey } from "./apps/api/dist/security/key-store.js"; createKey(process.env.CREDENTIAL_KEY_PATH)'`. 기존 key를 덮어쓰지 않는다. S04가 volume·gateway 설치를 소유한다. DB close는 Fastify onClose/시작 실패/SIGTERM에 연결했다.

S02 schema v1은 변경하지 않았다. DB에는 기존 opaque token hash와 암호화 `{username,t,s}`만 저장한다. HTTP 토큰은 `cookie.<opaque>.<purpose-mac>` 또는 `bearer.<opaque>.<purpose-mac>`이며 purpose별 HMAC-SHA256과 timing-safe 비교로 transport 변환을 거절한다. MAC/CSRF/revision은 기존 private key를 domain-separated 입력으로 사용하고 instance metadata나 사용자 정보를 토큰에 담지 않는다. 이 형식은 client가 해석하지 않는 opaque 문자열이다. 이전 S02 raw storage token은 HTTP credential로 허용하지 않는다.

## Session 교환

| 요청 | 입력/응답 |
|---|---|
| `POST /api/v1/session` | JSON `{kind:"password",username,password}` 또는 `{kind:"subsonic-token",username,t,s}`; 성공 201 |
| `GET /api/v1/session` | cookie 또는 Authorization bearer로 현재 upstream identity 재확인; 성공 200 |
| `DELETE /api/v1/session` | 현재 토큰 폐기, encrypted proof 제거; 성공 204 |

POST는 `X-Musiclatte-Client: web` 또는 `native`를 사용한다. credential kind와 HTTP transport는 별도다. password는 무작위 salt + Subsonic MD5 proof 생성에만 사용하고 저장하지 않는다. upstream `getUser` username이 제출 identity와 다르면 거절한다. alias를 추측해 다른 identity로 바꾸지 않는다. `t/s`도 재사용 secret이므로 공개 hash로 취급하지 않는다. code 41에서 raw/enc password fallback을 만들지 않는다.

응답 필수: `schemaVersion:1`, `username`, `authScheme`, `expiresAt`(epoch ms). cookie 응답에만 `csrfToken`, native **POST 응답에만** `accessToken`을 추가한다. native GET은 bearer를 다시 노출하지 않는다. 세션 생성 때 항상 새 token, 이전 credential을 제시한 재로그인은 같은 transport의 이전 session을 폐기한다. 로그인 실패 자체로 새 row를 만들지 않는다. logout/expiry/정책 revision 변경/상위 인증 40 또는 HTTP401/identity 변경 후 재사용 불가다. 네트워크 장애·403은 session을 폐기하지 않는다. 인증 거절 응답은 제시된 session cookie를 지운다.

HTTPS cookie: `__Host-musiclatte-session`, `Path=/`, `HttpOnly`, `Secure`, `SameSite=Strict`, absolute `Expires`; Domain 없음. 명시적 개발 HTTP origin만 `musiclatte-session`과 Secure 없는 cookie를 사용한다. production HTTP는 시작 거부다. cookie 교환 응답에 opaque session token을 JSON으로 반환하지 않는다.

## CSRF와 요청 경계

- cookie 변경 요청은 정확한 configured Origin + `application/json` + `X-Musiclatte-Client: web`을 요구한다. Host/X-Forwarded-Host로 신뢰 origin을 재정의하지 않는다. `null`/cross-site Origin 및 `Sec-Fetch-Site: cross-site`는 거절한다.
- 최초 cookie 로그인은 아직 session token이 없으므로 Origin+JSON+custom header로 보호한다. 기존 cookie를 제시하는 재로그인과 logout/scan은 `X-CSRF-Token`에 session-bound HMAC도 필요하다. GET session에서 해당 token을 복구한다.
- native 교환은 Origin/Cookie/Sec-Fetch-Site 없는 explicit native 요청이며 cookie를 발급하지 않는다. bearer는 Authorization header로만 전송한다. cookie와 bearer 동시 제시, 중복 session cookie, 다른 용도 MAC은 거절한다.
- 현재 session/capabilities/scan route는 query 전체를 거절한다. 미래 S07 검색 query까지 전역 차단하지 않는다. body는 최대 16KiB, 교환 schema는 unknown key/type coercion 없이 검증한다. scan body는 `{}`만 허용한다.
- CORS를 열지 않는다. JSON serializer/오류 응답/기본 404에 입력 URL·credential·상위 error text를 넣지 않는다. Fastify request logger는 꺼져 있다. 상위 gonic/gateway의 별도 로그 정책은 S04 소유다.

근거: [Fastify validation 기본 coercion/removeAdditional](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)을 명시적으로 끄고, [OWASP CSRF의 Origin/custom header와 session token 원칙](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)을 적용했다.

## Discovery / capabilities

`GET /.well-known/musiclatte-server`는 upstream 호출·인증 없이 아래 metadata만 반환한다.

```json
{"protocol":"musiclatte-server","schemaVersion":1,"instanceId":"synthetic-instance","apiBase":"/api/v1","authSchemes":["cookie","bearer"]}
```

`GET /api/v1/capabilities`는 인증 후 `schemaVersion`, `instanceId`, `revision`, `features`를 반환한다. 각 feature는 `supported: true|false|null`, `permission: allowed|denied|unknown`, `availability: available|temporarily_unavailable|unknown`이다. null은 미판정이며 false와 다르다.

| Feature | S03 판정 |
|---|---|
| `music.browse`, `music.stream` | configured gonic의 표준 음악 계약 true/allowed/available; private web data/media route 완료 주장은 아님(S07/S09) |
| `library.randomSongs` | size=1 read-only 성공 true; 401 폐기, 403 denied, 404/70/5xx/timeout은 unsupported로 추론하지 않음 |
| `library.scan` | gonic 표준 지원 true; 기본 denied, ALLOW_SCAN와 실제 adminRole의 교집합만 allowed |
| `playlists.read`, `playlists.write`, `favorites.songs` | private P2 consumer 미구현 false; 기존 native `/rest` 지원을 제거한다는 의미가 아님 |
| `library.recentDownloads`, `imports.youtube`, `engine.manage` | P3 미구현 false/denied |
| `metadata.write`, `metadata.lyrics.write`, `metadata.curation`, `automation.tokens` | P4/P6 미구현 false/denied |

random 성공 관찰은 session scope의 최대 256개 advisory memory entry로 유지한다. 장애 중 이미 확인한 true는 유지하고 availability만 변경한다. 이 제한은 메모리 bound이며 사용자/session 한도는 아니다. logout/rotation/인증 폐기 때 제거한다. 재시작·eviction은 unknown으로 돌아갈 수 있고 permanent false cache는 없다. 이전 capability를 표시하는 consumer는 unknown 응답을 기존 표준 기능 제거로 해석하지 않는다.

revision은 token·policy revision·실제 identity/role·현재 feature 상태의 HMAC이다. 같은 상태에서 안정적이며 새로운 로그인·계정·권한·가용성에서 달라진다. 원본 token/user를 포함하지 않는다. request 검증 중 logout/정책 변경이 발생해도 network 후 session을 다시 찾아 폐기된 결과를 반환하지 않는다. 늦은 이전 화면 응답을 버리는 client scope guard는 S06/P5 소유다.

`packages/contracts`는 JSON schemas와 `decodeDiscovery`, `decodeCapabilities`, `discoveryOutcome`을 제공한다. v1 discovery는 `/api/v1`만 허용한다. capability 필수 baseline은 `music.browse`, instance/revision/version/feature 필드다. 다른 known feature는 partial 응답 가능, unknown field/key는 projection에서 무시한다. 미지원 version/잘못된 필수 schema는 실패한다. discovery 404/410은 extension absent, 그 외 실패는 unknown이며 항상 standard preserve다. stock gonic/Airsonic fallback은 합성 fixture 계약이고 Swift 구현은 P5다.

## Scan과 오류

`POST /api/v1/scan`은 authentication/CSRF/JSON 후 `getUser` → 현재 policy/adminRole 검사 → 고정 upstream `startScan` 순서다. 저장된 adminRole, 클라이언트 capability flag, folder 배열로 권한을 부여하지 않는다. capability/discovery는 scan/getScanStatus/write를 탐지용으로 실행하지 않는다. upstream가 직후 권한을 거절해도 403을 보존한다. 성공은 `{schemaVersion:1,accepted:true}`이며 scan 완료 보증이 아니다. live demo scan은 실행하지 않았고 성공/거절은 별도 HTTP fake fixture에서 검증했다.

모든 오류는 `{schemaVersion:1,error:{code,retryable}}`이며 user-facing 번역문 대신 안정된 식별자를 사용한다. 모든 응답은 `Cache-Control: no-store`다.

| HTTP | code | 의미 |
|---|---|---|
| 400/415/413 | invalid_request | 잘못된 JSON/schema/query/content type/크기 |
| 401 | unauthenticated | 없음·만료·폐기·인증/identity 거절 |
| 403 | forbidden / csrf_rejected | 권한 거절 / CSRF 경계 위반 |
| 404 | not_found | 신규 API route 없음; standard 지원 여부 판정 아님 |
| 422 | token_auth_unsupported | 표준 code41, BFF는 다른 credential 방식으로 재시도하지 않음 |
| 503 | upstream_unavailable / storage_unavailable | retryable 일시 장애 |
| 500 | internal_error | 정제된 내부 오류, raw cause 없음 |

새 UI copy 0개, locale은 기존 ko/en을 유지한다. `sessionExchangeSchema`, `sessionResponseSchema`, `discoverySchema`, `capabilitiesSchema`, `apiErrorSchema`와 test fixture를 함께 변경해야 한다. 전체 검증은 [S03 evidence](../verification/phase-1/step-03.md)에 있다.
