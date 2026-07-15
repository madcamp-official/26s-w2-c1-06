# Factcoding — 알려진 버그 및 수정 안내서 (For Next AI Agent)

> **2026-07-13 업데이트: 아래 버그 2건 모두 수정 완료.** 전체 코드 점검에서 추가로 발견·수정한
> 버그들도 "추가로 발견·수정된 버그" 섹션에 기록함.
> **2026-07-14 업데이트: 그날 남겨뒀던 "다음 작업 후보" 4건도 모두 구현 완료** — 맨 아래
> "2026-07-14에 구현한 다음 작업 후보" 섹션 참조. 지금 남은 한계는 그 섹션 끝의 목록뿐.

## 1. `deleteEdgesFromFile`의 Cross-Project 데이터 삭제 버그 (Critical) — ✅ 수정됨

**위치**: `src/pipeline/db/repo.ts` 의 `deleteEdgesFromFile` 메서드

**문제**: AST 엣지 스냅샷 갱신 전 기존 엣지를 지울 때 서브쿼리가 `file_path`만 보고
`project_id` 스코프를 안 걸어서, 다른 프로젝트에 같은 상대경로(예: `src/App.tsx`)가 있으면
**그 프로젝트의 엣지까지 삭제**되는 데이터 유실 버그.

**수정 내용**: `deleteEdgesFromFile(projectId, filePath)`로 시그니처를 바꾸고 서브쿼리에
`project_id = ?` 조건 추가. 호출부(`src/pipeline/index.ts`의 `runAstDiff`)도
`repo.deleteEdgesFromFile(config.projectId, filePath)`로 갱신.

## 2. 파이프라인 종료(Stop) 시 Race Condition으로 인한 DB 에러 및 데이터 유실 (Medium) — ✅ 수정됨

**위치**: `src/pipeline/index.ts` 의 `PipelineHandle.stop()` 메서드

**문제**: `stop()`이 동기적으로 즉시 `db.close()`를 호출해서, `astDiffQueueByFile`에서
비동기 파싱(`parseSource`)을 await하던 작업이 재개될 때 `Database is closed`로 죽고
**종료 직전 코드 수정 내역이 유실**되는 레이스.

**수정 내용**:
- `stop()`을 `async`로 변경 (`PipelineHandle.stop(): Promise<void>`, shared/types.ts).
  대기 중인 디바운스 diff를 **버리지 않고 즉시 플러시**한 뒤(→ 기존의 "종료 직전 500ms 이내
  마지막 Edit 배치 유실" 한계도 함께 해소), `Promise.allSettled(astDiffQueueByFile.values())`를
  await하고 나서 `db.close()`.
- 호출부 연쇄 수정: `cli.ts`의 SIGINT 핸들러가 `await pipeline.stop()` 후 exit,
  Electron `completeMonitoring()`이 async가 되어 IPC 핸들러가 Promise를 그대로 반환
  (renderer "완료" 버튼이 마지막 flush까지 기다림), `window-all-closed`에서 stop 완료를
  기다린 뒤 `app.quit()`.
- `markSessionEnded()`에 stop 이후 호출 방어(`stopped` 플래그) 추가.

---

## 추가로 발견·수정된 버그 (2026-07-13 전체 점검)

1. **jsonl-tail 멀티바이트 디코딩 깨짐** (`observation/jsonl-tail.ts`): 문자열로 누적하며
   청크별로 utf8 디코딩해서, 폴링 경계가 한글 등 멀티바이트 문자 중간에 걸리면 양쪽이
   U+FFFD로 깨짐(한국어 프롬프트 손상). 바이트 버퍼로 누적하고 개행 단위로 완성된 부분만
   디코딩하도록 수정. 문자 분할 시나리오 테스트로 검증 완료.
2. **useSessionTrace 라이브 모드가 새 세션을 못 따라감** (`hooks/useSessionTrace.ts`):
   최신 세션 id를 최초 1회만 조회해서, "시작하기" 후 새로 생긴 세션으로 갈아타지 못하고
   이전 세션에 머묾. 라이브 모드에서 최신 세션 id를 폴링하도록 수정. 세션이 없는
   프로젝트로 전환 시 이전 트레이스가 화면에 남는 문제도 함께 수정(상태 클리어).
3. **useUnitTimeline 프로젝트 전환 시 stale 유닛 선택** (`hooks/useUnitTimeline.ts`):
   선택된 유닛 id가 현재 프로젝트에 없어도 유지돼 타임라인이 다른 프로젝트의 유닛을 계속
   조회. 유닛 목록에 없으면 첫 유닛으로 교체하도록 수정.
4. **App.tsx 세션 전환 시 stale 턴 선택**: 세션이 바뀌어도 이전 세션의 턴 id가 남아
   "턴을 선택하세요" 빈 화면에 갇힘. 세션 변경 시 선택 초기화.
5. **caption-worker 턴 해설이 글로벌 최신 세션만 대상**: 과거 세션 고정/난이도 변경 시
   그 세션 턴 해설이 영원히 "생성 중"에 머묾(버전 요약은 이미 전역 대상이라 비대칭).
   완료된 턴이면 어느 세션이든 처리(최신 세션 우선 정렬)하도록 수정.
6. **워커 무한 재시도** (caption-worker / lecture-note-worker): 같은 대상이 계속 실패하면
   (429 쿼터 소진, 프롬프트 초과 등) 3~5초마다 무한 재시도하며 다른 대상 처리까지 막음.
   실패 대상별 60초 쿨다운 추가.
7. **session-locator stat 레이스**: `readdir`와 `statSync` 사이에 세션 파일이 지워지면
   그 틱의 스캔 전체가 실패. 해당 파일만 건너뛰도록 수정.
8. **diff_text 가독성** (`ast-diff/diff-text.ts`): `patch_toText()`가 URL 인코딩된 patch
   포맷이라 UI "DIFF 보기"에서 한글이 `%EC%84…`로 표시됨. 사람이 읽는 +/- 라인 diff로 교체
   (기존 DB의 diff_text는 옛 포맷 그대로 남아 있음 — 새로 기록되는 것부터 적용).

## 2026-07-14에 구현한 "다음 작업 후보" 4건

1. **Q&A 대화 히스토리 포함**: `answerQuestion`이 `history: QnaHistoryEntry[]`를 받아 최근
   6개 문답을 프롬프트에 넣어준다("Q: … / A: …" 블록). `AIProvider.answerQuestion` 시그니처가
   `(question, context, history, skillLevel)`로 바뀌었고, `QnaHistoryEntry`는
   `@shared/types.ts`에 있다(렌더러 tsconfig에는 `@ai` alias가 없어서 shared에 둠).
   덤으로 발견된 버그: `useQna`가 세션이 바뀌어도 `exchanges`를 비우지 않아 이전 세션
   대화가 새 세션 히스토리로 섞여 들어갈 뻔했음 — 세션 변경 시 초기화하도록 수정.
2. **파이프라인 이벤트 → IPC push**: `PipelineHandle`에 `code-units-changed`(AST diff 커밋
   직후)·`session-updated`(SessionStart/End 훅 마커 반영 직후) 이벤트를 추가했고,
   `main/index.ts`가 이 이벤트들과 기존 `transcript-event`를 구독해 `DataChangeKind`
   (`trace`|`code-units`|`explanation`|`lecture-note`|`session`)로 렌더러에
   `data-changed` IPC를 push한다(같은 kind는 150ms 디바운스). caption-worker/
   lecture-note-worker도 저장 시점에 콜백을 받아 push한다. 렌더러 훅들(`useSessionTrace`,
   `useTurnDetail`, `useUnitTimeline`, `useSessions`, `useLectureNotes`, `useMonitoring`)은
   새 `useDataChanged` 훅으로 즉시 재조회하고, 기존 폴링은 push를 놓친 경우의 안전망으로
   주기만 늘려(1~3초 → 8~10초) 남겨뒀다.
3. **manual-watch에 add/unlink 감지 추가**: `watchManualEdits`가 이제 `add`/`unlink`도
   구독한다(`ManualFsEventKind`). git checkout/브랜치 전환처럼 짧은 시간(1초)에 파일
   6개 초과가 한꺼번에 바뀌면 "벌크 작업"으로 판단해 `isBulk=true`를 넘긴다 —
   호출부(`pipeline/index.ts`)는 이때 스냅샷 캐시만 동기화하고 tool_event/AST diff는
   생략해 트레이스 오염과 파싱 비용 폭증을 막는다. `SnapshotCache.syncFromDisk`가
   삭제된 파일에서 캐시를 자동으로 지우는 동작을 그대로 활용해 add/change/unlink
   세 종류를 하나의 로직으로 처리(unlink는 matchUnits가 자연스럽게 "전체 유닛 삭제"로 잡음).
4. **세션 재개(resume) 시 세션 PK 분리**: `pipeline/index.ts`에 `resolveLogicalSessionId`를
   추가 — JSONL의 "원본" 세션 id가 이미 `ended_at`이 찍힌 채로 다시 관찰되면(같은 터미널에서
   "완료" 후 "시작하기") `${rawId}#${randomUUID()}` 형태의 새 "논리" 세션 id를 발급하고
   새 `sessions` 행을 만든다. transcript-event 경로와 SessionStart/SessionEnd 훅 마커
   경로 둘 다 이 resolver를 거친다. 새 `PipelineHandle` 이벤트 `session-resolved`로
   Electron main에 현재 논리 id를 알려주고(예전엔 파일명 basename을 그대로 썼는데, 재개
   시 실제 쓰기 대상과 달라짐), "완료" 버튼은 이 id로 `markSessionEnded`를 호출한다.
   재개 후 turn_index는 새 세션 행 기준으로 0부터 다시 시작(스키마상 자연스러움).
   `repo.getSession(id)`(ended_at 조회) 메서드 추가. 실제 파이프라인을 두 번 기동해
   재개 시나리오 전체를 검증하는 통합 테스트로 확인 완료(11개 assertion 통과).

## 남은 알려진 한계 (수정 안 함)

- Q&A는 여전히 응답을 DB에 캐시하지 않는다(자유 텍스트 질문이라 캐시 히트가 사실상 없음,
  기존 설계 그대로) — 히스토리는 렌더러 메모리에서만 유지되고 새로고침하면 사라진다.
- `data-changed` push는 kind만 구분하고 세션/프로젝트 스코프까지는 구분하지 않는다 —
  여러 프로젝트를 동시에 보는 멀티윈도우 시나리오라면 관련 없는 창도 재조회를 한 번 더
  하게 되지만, 지금은 창이 하나뿐이라 실질적 영향은 없다.
- 세션 재개로 생긴 논리 id(`rawId#uuid`)는 JSONL 파일명과 1:1이 아니게 되므로, 만약 다른
  코드가 "session id == JSONL 파일 basename"을 가정하고 있다면(현재 코드베이스에는 없음을
  확인함) 깨질 수 있다 — 새 코드를 추가할 때 유의.
