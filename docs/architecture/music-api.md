# 음악 조회 API — S07

인증된 cookie/native bearer로 고정 gonic upstream의 공유 library를 읽는다. 응답은
`schemaVersion: 1` JSON이고 `Cache-Control: no-store`다. 권한 원장은 gonic이며
`getUser.folder`를 곡별 ACL 또는 관리 import root permission으로 해석하지 않는다.

## Route와 응답

모든 경로는 `/api/v1/music` 아래 GET이며 다음 allowlist만 등록한다.

| 경로           | Query                                                         | 응답 필드                   | gonic 읽기          |
| -------------- | ------------------------------------------------------------- | --------------------------- | ------------------- |
| `/folders`     | 없음                                                          | `folders: MusicFolder[]`    | `getMusicFolders`   |
| `/folders`     | `musicFolderId`                                               | `indexes: MusicIndexes`     | `getIndexes`        |
| `/folders/:id` | 없음                                                          | `directory: MusicDirectory` | `getMusicDirectory` |
| `/search`      | `q`, 선택적 `musicFolderId`, 아래 pagination                  | `result: MusicSearchResult` | `search3`           |
| `/artists/:id` | 없음                                                          | `artist: MusicArtist`       | `getArtist`         |
| `/albums/:id`  | 없음                                                          | `album: MusicAlbum`         | `getAlbum`          |
| `/random`      | 선택적 `size`, `musicFolderId`, `genre`, `fromYear`, `toYear` | `songs: MusicEntry[]`       | `getRandomSongs`    |

`/folders`의 music-folder ID는 인덱스 조회 filter다. 인덱스의 `index[].artist[]`는
Subsonic 명칭이며 여기서 얻은 ID는 **폴더 탐색용 `/folders/:id`**로 전달한다.
태그 검색의 `result.artist[]`와 `result.album[]`는 각각 artist/album 상세로 연결한다.
이름이나 경로에서 ID를 만들지 않는다. path segment에는 `encodeURIComponent`, query에는
`URLSearchParams`를 사용한다. 숫자 music-folder ID만 adapter에서 문자열로 정규화한다.

각 요청은 현재 identity 검증 `getUser`와 대상 metadata 읽기 한 번만 수행한다. 전체
library 순회·복제·곡 ACL 생성·scan·playlist 변경·queue/player 시작은 하지 않는다.
성공 빈 목록과 optional metadata 부재는 S01 decoder 의미 그대로 보존한다. 응답 schema는
필요한 typed field만 직렬화하며 원본 envelope·파일 path·credential·upstream 메시지는 제외한다.

## Pagination과 정렬

**2026-09-05 사용자 결정:** 음악 조회에는 gonic count/offset 방식을 보존한다. 공통
cursor/snapshot 요구의 명시적 예외이며, 목록 변경 중 페이지 간 중복/누락 방지를 보장하지 않는다.

- 검색은 `artistCount/artistOffset`, `albumCount/albumOffset`, `songCount/songOffset`을
  독립적으로 전달한다. count 기본값 20, 허용 0–500; offset 기본값 0, 음수 없는 JS safe integer다.
- count 0은 해당 종류를 요청하지 않는 표준 의미다. 입력 숫자는 정규 10진수 문자열만 허용한다.
- gonic 순서를 유지하며 BFF 재정렬·가짜 total·next cursor·snapshot ID를 만들지 않는다.
- 폴더 인덱스/한 디렉터리/artist/album은 gonic이 제공하는 해당 범위의 목록을 그대로 반환한다.
  이 endpoint들은 offset API가 없으며 BFF가 가짜 pagination을 추가하지 않는다.
- random size 기본값 50, 허용 1–500. 연도는 0–9999이며 fromYear ≤ toYear다.
  random은 페이지 목록이 아니고 반복 호출 결과의 동일성/순서를 보장하지 않는다.
- 500은 BFF 요청 상한이며 제품 규모·성능 SLA가 아니다. 검색 페이지 표시와 마지막 결과 선택은 S08,
  random 결과의 실제 queue/playback 반영은 S10 소유다.

ID와 문자열은 1–2048자이며 검색어는 공백만으로 구성할 수 없다. 알 수 없는 query,
중복 query, 범위를 벗어난 숫자는 upstream I/O 전에 400으로 거부한다. 임의 upstream이나
Subsonic operation을 지정할 수 없다.

## 오류와 취소

응답은 `{schemaVersion:1,error:{code,retryable}}`다. 원문 upstream 오류는 노출하지 않는다.

| 상황                                                    | HTTP / code                  | retryable |
| ------------------------------------------------------- | ---------------------------- | --------- |
| 입력 오류                                               | 400 `invalid_request`        | false     |
| session 없음/만료 또는 upstream 인증 거절               | 401 `unauthenticated`        | false     |
| gonic 권한 거절 50 / HTTP 403                           | 403 `forbidden`              | false     |
| gonic 70 / HTTP 404                                     | 404 `not_found`              | false     |
| token 인증 미지원 41                                    | 422 `token_auth_unsupported` | false     |
| protocol version 불일치 20/30                           | 422 `upstream_incompatible`  | false     |
| 다른 표준 오류/HTTP 장애/잘못된 payload/network/timeout | 503 `upstream_unavailable`   | true      |

기존 gonic은 대상 없음과 미구현 endpoint에 모두 70을 사용한다. 따라서 `not_found`를
“random 영구 미지원”으로 단정하지 않는다. protocol 불일치도 특정 기능 미지원과 다르다.
읽기 성공(빈 songs 포함)은 정상이며, 지원 확인 대신 scan/playlist write를 실행하지 않는다.
S03 capability의 unknown/permission/availability 계약을 유지한다.

401은 저장 session을 폐기하고 cookie를 지운다. 조회 중 logout/expiry/policy 변경이 생겨도
성공 데이터를 반환하지 않도록 응답 직전 session을 다시 확인한다. 다른 오류는 session을 폐기하지 않는다.
클라이언트 연결 종료는 AbortSignal로 identity와 metadata 조회에 전달하고 listener를 정리한다.
이미 종료된 연결에는 별도 취소 JSON을 전달하지 않는다. 서버는 사용자별 “마지막 요청”을 저장하지 않으며
S08 client가 이전 fetch를 취소하고 늦은 응답을 제외한다.

오류 문장은 기존 KO/EN resource에서 번역한다. `upstream_incompatible`의 두 번역을 추가했으며
새 음악 UI·shared component·player·route navigation은 활성화하지 않았다.

## 구현·검증

- `packages/contracts/src/music.ts`: response types, response/query/ID JSON schema.
- `apps/api/src/music/library-service.ts`: 인증·취소·오류·응답 직전 session 검증 공통 경계.
- `apps/api/src/routes/music/`: 명시적 조회 routes.
- `apps/api/test/library-api.test.ts`, `tests/contract/library-api.test.ts`: synthetic HTTP fixture.
- [S07 검증](../verification/phase-1/step-07/README.md).

## S08 웹 소비자

`apps/web/src/music/client.ts`가 위 응답을 runtime 검증하고 MusicPage의 root/folder/search/artist/album에 전달한다. 검색은 유형별20개와 독립 offset을 사용하며 scope/query를 URL에 보존한다. fetch 취소와 generation guard는 늦은 응답을 제외하고 401은 정상 재인증으로 이어진다. shared MusicRow는 탐색 상세만 제공하며 실제 오디오는 S09/S10 소유다. 기존 standard REST와 API producer 계약은 변경하지 않았다. [S08 검증](../verification/phase-1/step-08/README.md) 및 [브라우저 시나리오](../../tests/browser/library-scenarios.md) 참조.
