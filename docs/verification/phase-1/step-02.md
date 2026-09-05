# S02 검증 — 2026-09-05

Session/instance SQLite 저장소, credential vault/key store, 수명 설정, online backup/offline restore를 구현했다. HTTP 로그인/cookie/API guard와 UI는 S03/S06에서 검증한다. P1 AC-01/09/12 전체를 완료한 것으로 표시하지 않는다.

- Branch: `yellowgg2/tdd/phase-1/step-02-session-storage`, clean main에서 Step 본문 읽기 전에 생성.
- 모든 npm 명령은 session-local Node v24.20.0/npm 11.19.0 PATH 사용. SQLite runtime probe 3.53.4, built-in backup 확인.
- cwd: project root. dependency install/global runtime 교체/원격 service 변경/commit/push 없음.

| 단계       | 명령                                                                                                                                     | 결과                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| RED        | `npm run test:unit -- apps/api/test/session-storage.test.ts apps/api/test/credential-vault.test.ts apps/api/test/backup-restore.test.ts` | 22 collected, 구현 부재 assertion 22 실패, exit 1; import/collection 오류 없음                    |
| RED        | `npm run typecheck`, `npm run build`                                                                                                     | 각각 exit 0                                                                                       |
| GREEN      | 위 focused command                                                                                                                       | 22/22 pass, exit 0                                                                                |
| GREEN      | `npm run typecheck`, `npm run build`                                                                                                     | 각각 exit 0                                                                                       |
| REFACTOR   | 위 focused command                                                                                                                       | 실제 exported function/type로 harness 교체, future-schema/tampered-backup 검증 추가 후 23/23 pass |
| REFACTOR   | `npm run typecheck`, `npm run build`                                                                                                     | 각각 exit 0; SQL migration dist copy 포함                                                         |
| GATE_CHECK | `npm run test:unit`                                                                                                                      | 6 files, 55 pass, exit 0                                                                          |
| GATE_CHECK | `npm run test:contract`                                                                                                                  | 2 files, 34 pass, exit 0                                                                          |
| GATE_CHECK | `git diff --check`                                                                                                                       | exit 0                                                                                            |

Compiled smoke: 고유 임시 경로에서 별도 Node process를 OS tmpdir cwd로 실행했다. `apps/api/dist` 모듈이 SQL migration을 찾아 첫 DB/key 생성 → session 발급 → WAL backup → 새 경로 restore → 재개방/복호화를 완료했다. 출력은 `compiled-storage-and-restore: passed`만 포함했고 생성 경로는 finally에서 제거했다. 세션 token/proof를 stdout·CLI argument·artifact로 전달하지 않았다.

## 검증 범위

- migration/reopen과 instance 유지, foreign/future schema 거부, raw token hash와 encrypted proof, schema에 password/admin/media 없음.
- AES-GCM round trip/nonce 차이, context mismatch, malformed/version/tag/wrong key 거부, extra password 투영 제외.
- key file 0600, overwrite 금지, symlink/permissive/truncated/missing key 거부와 자동 재생성 없음.
- 주입 clock의 만료 경계, config 증가에 기존 expiry 불변, revocation과 credential NULL, policy revision invalidation, row 간 envelope 교체 및 expiry 변조 거부.
- transaction rollback, async callback 거부, 두 DB connection의 writer contention 실패 후 정상 재시도, connection 간 revoke 일관성.
- 실제 WAL size > 0인 fixture backup/restore, 미커밋 변경 제외, 복원 후 동일 instance/유효 session/만료/revocation 확인.
- existing destination 무변경, mismatched/missing key, corrupt/future schema/tampered envelope 복원 거부, 실패한 이번 목적 디렉터리 정리.
- 생성 DB/WAL sample에 합성 bearer/t/s 평문 부재 검증. 실제 계정·음원·개인 metadata는 사용하지 않았다.

## Gate와 한계

BRANCH_SETUP, PROJECT_DOC_CONTEXT, RED, GREEN, REFACTOR, LOCALIZATION, DOC_SYNC, GATE_CHECK 완료. PROJECT_SETUP은 SQL migration build 산출물 복사 추가만 필요했고 dependency 변경은 없었다. `update_plan` tool은 제공되지 않아 이 gate 기록으로 상태를 관리했다.

LESSONS_CONTEXT: Agent Rulebook project search는 정상 응답했으나 직접 적용할 compatible rule 없음. UI/bulk/navigation 관련 결과는 대상이 다르거나 compatibility unknown이어서 제외. Postflight `yk-rulebook-reconcile`: `skipped(no_new_lesson)`; 3×HIGH를 만족하는 신규 원인/fix 없음. canonical write/재검색/Rulebook sync는 해당 없음. 프로젝트 lesson 파일을 읽거나 쓰지 않았다.

KO/EN locale source는 기존 web i18n JSON. 새 visible 문자열/변경 key 0, 전체 unit의 기존 matching/nonempty/placeholder 검증 pass. UI diff 없음; class/action, Chrome, component reuse/Gallery/catalog 승인은 해당 없음; review debt 0. 사용자 수동 확인 없음.

새 운영 stack, S03 HTTP 조립, 실제 gonic/native/media, Linux container는 이번 검증 대상이 아니다. node:sqlite는 pinned runtime의 release candidate API이며 대규모 concurrent load/SLA를 주장하지 않는다. S04가 Linux 배포와 전체 volume 복원을 검증한다. 테스트 후 세션 소유 DB/임시파일/child process 정리 완료; 기존 서비스·gonic schema·사용자 원본 파일 불변.

설계/복구 절차: `docs/architecture/session-storage.md`. 주요 symbol: `openDatabase`, `createInstanceRepository`, `createSessionRepository`, `createCredentialVault`, `createKey`, `loadKey`, `readSessionPolicy`, `createBackup`, `restoreBackup`.
