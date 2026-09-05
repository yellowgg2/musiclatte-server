# Musiclatte Server

[English](README.md)

음악 웹/API를 위한 TypeScript 소스 프로젝트다. S00–S03은 workspace, 고정 gonic adapter, 암호화 session 저장, 인증·discovery·capability API와 권한 검증된 관리자 scan을 제공한다. React root는 비어 있으며 제품 음악 탐색·재생·Gallery·배포는 후속 Step 범위다.

Node **24.20.0**, npm **11.19.0**을 프로젝트별 shell/version manager에서 사용한다. `.nvmrc`와 `.node-version`을 따르며 host global Node를 교체할 필요는 없다.

```sh
npm ci
npm run typecheck
npm run test:unit -- tests/unit/workspace.test.ts apps/api/test/runtime.test.ts
npm run test:contract -- tests/contract/workspace.test.ts
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
