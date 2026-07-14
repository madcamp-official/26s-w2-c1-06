# Factcoding — 현재 구현 상태 핸드오프 (프로젝트 워크스페이스 + 턴 UI + 실시간 AI 동기화)

이 문서는 `SPEC.md`/`HANDOFF_B_AI_UI.md`(원래 기획 핸드오프)를 대체하지 않는다.
그 문서들은 "무엇을 만들기로 했는지"를 담고, 이 문서는 **"지금 실제로 뭐가 만들어져 있고 뭐가 없는지"**를 담는다.
버그/한계 상세 내역은 `KNOWN_BUGS_HANDOFF.md`에 따로 정리돼 있다.
새 세션을 시작하는 사람은 이 문서 → `KNOWN_BUGS_HANDOFF.md` → 필요하면 `SPEC.md` 순서로 읽을 것.

## 지금 git 상태 (중요 — 다음 세션이 제일 먼저 확인할 것)
- 작업은 `feature/project-workspace-realtime-ai` 브랜치에 커밋 1개로 올라가 있다
  (`integrate/merge-person-a-pipeline`은 안 건드림, `main`과도 별개). 아직 push/PR 안 함.
- 로컬 DB(`db/factcoding.db`, gitignore 대상)는 **한 번 완전히 초기화**됐다(데모 시드 없음) —
  이후 실사용(아래 "지금 로컬 DB에 실제로 들어있는 것" 참조)으로 데이터가 다시 쌓인 상태다.
  새로 리셋하고 싶으면 `rm -f db/factcoding.db* && npm run db:init`만 실행(시드는 선택, 아래 참조).

## 한 줄 요약
Day 1~7 + 파이프라인 런타임 통합 → 프로젝트 워크스페이스/턴 단위 UI 개편(Figma 톤 리스타일 포함)에
이어, 이번 라운드에서 백엔드 버그 다수를 고치고 4가지 기능을 추가함:
① **Q&A 대화 히스토리**(후속 질문 맥락 유지), ② **파이프라인 이벤트 → IPC push**(폴링 대신 즉시 갱신),
③ **manual-watch가 파일 생성/삭제도 감지**(벌크 작업 안전장치 포함), ④ **세션 재개(resume) 시
세션 PK 분리**(같은 터미널에서 "완료"→"시작하기" 반복해도 안전). 추가로 **Gemini 모델 폴백 체인**을
넣어 무료 티어 일일 쿼터가 모델 하나를 다 써도 자동으로 더 가벼운 모델로 넘어가게 함.

## 돌아가는 것 (실제로 실행해서 확인함)

### 프로젝트 워크스페이스
- 앱을 켜면 **항상 "프로젝트" 탭이 먼저 뜬다** — 관제실/구조도/강의노트는 전부 `project_id`로
  스코프되므로, 프로젝트를 고르거나 새로 등록해야 그 화면들을 볼 수 있다.
- 새 프로젝트 등록: 이름 입력 + `dialog.showOpenDialog`로 코드 워크스페이스 폴더 선택 →
  `projects` 테이블에 저장(get-or-create, workspace_path UNIQUE).
- `code_units.id` 해시(`computeUnitId`)에 `project_id`를 포함시켜, 서로 다른 프로젝트가 같은
  상대경로+유닛명을 가져도 id가 충돌해 구조도/버전이 섞이지 않는다.
- **주의**: 프로젝트 등록 시 워크스페이스 경로는 **Claude Code를 실제로 실행하는 디렉토리와 정확히
  일치**해야 한다. 한 칸 위(부모) 폴더를 등록하면 `~/.claude/projects/<hash>` 해시가 달라져서
  실제 세션(JSONL)과 연결이 안 되고, `manual-watch` 폴백(파일 변경 감시)만 동작한다 — 즉 "턴"
  단위 추적 없이 낱개 파일 수정만 "수동 수정"으로 잡힌다. 실사용 중 실제로 한 번 이 실수가
  났었다(부모 경로로 등록된 "팩트코딩" 프로젝트가 로컬 DB에 남아있음).

### 온보딩 + 난이도
- 3단계 위저드: **①수강 과목**(KAIST 전산학부 체크리스트 + 직접 추가) → **②프로젝트 경험**(개수 +
  기술 스택) → **③교육 스타일**(원리부터/일단 만들어보고/비유로/균형). `computeSkillProfile()`
  (`src/shared/skillProfile.ts`)이 이걸 5단계 `SkillLevel`(`novice~expert`)로 매핑.
- 헤더 아래 "난이도 조절" 슬라이더(`DifficultySlider.tsx`, 5칸)로 언제든 재조정 가능.

### 관제실 (턴 단위 + 실시간 push)
- **AI 호출**: `caption-worker.ts`가 "완료된 턴"(다음 턴이 이미 시작됐거나 세션이 끝남)당 **한 번만**
  호출해 그 턴의 모든 액션을 feature 단위로 요약한다(`AIProvider.explainTurn`). 대상은 **최신 세션
  하나로 한정하지 않고** 완료된 턴이면 어느 세션이든 처리(최신 세션 우선 정렬) — 과거 세션을
  세션 목록에서 고정해 보거나 난이도를 바꿔도 그 세션 턴 해설이 채워진다.
- **턴 해설 = 사수 말풍선**: 한 덩어리 caption이 아니라 "코딩을 알려주고 싶어하는 친절한 사수"가
  슬랙 말풍선을 보내듯 **overview(전체 구조도에서 이번 턴이 만진 곳 짚기) → change(바뀐 내용
  서술식 해설, 1~3개) → concept(알아야 하는 개념, 1~2개)** 순서로 생성된다. `explainTurn(prompt,
  events, context, skillLevel)`의 `context`(변경 유닛 버전 + 전체 구조도)로 overview가 실제 유닛
  이름을 가리키며 서술할 수 있다. `serializeTurnNarrative()`/`parseTurnNarrative()`(shared/format.ts)로
  기존 `ai_explanations.content` 컬럼에 JSON(`turn-narrative-v1`) 직렬화 — 개편 전 평문 캐시는
  overview 말풍선 하나로 자동 폴백.
- **레이아웃**: 왼쪽 `TurnList`(컴팩트 턴 선택자) + 오른쪽 `TurnDetailPanel`(턴 헤더 아래 **전체
  구조도**[이번 턴 유닛만 하이라이트, `StructureOverview`의 `highlightUnitIds` prop] + **"사수의
  해설" 말풍선 컬럼** 나란히 배치, diff 목록은 맨 아래 `<details>`로 접어서 보조 정보로 강등).
- **실시간 갱신**: 폴링만이 아니라 파이프라인/워커가 DB를 갱신할 때마다 main이 `data-changed`
  IPC를 push한다(kind: `trace`/`code-units`/`explanation`/`lecture-note`/`session`, 같은 kind는
  150ms 디바운스). 렌더러의 6개 훅(`useSessionTrace`/`useTurnDetail`/`useUnitTimeline`/
  `useSessions`/`useLectureNotes`/`useMonitoring`)이 새 `useDataChanged` 훅으로 즉시 재조회하고,
  기존 폴링은 놓친 경우의 안전망으로 주기만 늘려(1~3초 → 8~10초) 남아있다.
- **Q&A 대화 히스토리**: `answerQuestion`이 최근 6개 문답을 프롬프트에 포함해 "그건 왜?" 같은
  후속 질문의 맥락을 유지한다. 세션이 바뀌면 히스토리를 비운다(이전 세션 대화가 새 세션에
  안 섞이도록).
- 프롬프트에 연결되지 않은 이벤트(수동 수정)는 `TurnList`에 "수동 수정" 항목으로 묶여 나온다.

### 파이프라인 안정성/기능 (백엔드)
- **manual-watch**가 이제 `add`/`unlink`(생성/삭제)도 감지한다(예전엔 `change`만). 1초 안에 6개
  초과 파일이 바뀌면 "벌크 작업"(git checkout 등)으로 판단해 캐시만 동기화하고 tool_event/AST diff
  기록은 생략 — 브랜치 전환이 트레이스를 오염시키지 않는다.
- **세션 재개(resume)**: 같은 JSONL을 "완료" 후 "시작하기"로 재개하면 `resolveLogicalSessionId`가
  새 논리 세션 id(`rawId#uuid`)를 발급해 새 `sessions` 행을 만든다 — 예전엔 이미 종료 처리된
  session row를 재사용해서 재개 후 내용이 강의노트 재생성 트리거를 못 받았음. `PipelineHandle`의
  새 `session-resolved` 이벤트로 Electron main이 현재 논리 id를 추적(예전엔 JSONL 파일명 basename을
  그대로 썼는데 재개 시 실제 쓰기 대상과 달라짐).
- `stop()`이 `async`로 바뀌어 진행 중인 AST diff가 전부 DB에 기록된 뒤에 커넥션을 닫는다(예전엔
  종료 직전 편집이 유실될 수 있었음). `deleteEdgesFromFile`이 project_id로 스코프돼 다른 프로젝트의
  엣지를 잘못 지우지 않는다. jsonl-tail이 바이트 버퍼로 디코딩해 한글 등 멀티바이트 문자가 폴링
  경계에서 깨지지 않는다. `diff_text`가 URL 인코딩 patch 포맷 대신 사람이 읽는 +/- 라인 diff로 저장됨.
  (전체 목록은 `KNOWN_BUGS_HANDOFF.md` 참조.)

### AI 프로바이더
- **모델 폴백 체인**(`GeminiProvider.ts`): `gemini-flash-latest → gemini-flash-lite-latest →
  gemini-2.0-flash`. Gemini 무료 티어 쿼터는 모델별로 별도 집계되므로, 기본 모델의 하루 쿼터를
  다 써도(20회/일 정도로 매우 낮음) 자동으로 다음 모델로 넘어간다. 앞쪽 두 개는 alias(구글이 계속
  최신 모델을 가리키도록 유지)라 `gemini-2.5-flash`가 신규 키에 404 났던 문제 재발 위험이 낮고,
  마지막 한 단계만 안전망으로 구버전을 고정. 한 번 소진 확인된 모델은 5분간 건너뛴다(안 그러면
  매 호출마다 이미 죽은 모델을 처음부터 재확인하느라 키 2개 × 쿨다운 대기로 수십 초씩 낭비됨).
  4개 provider 메서드가 공통 `generateText` 헬퍼를 씀.
- `GEMINI_KEY_A`/`GEMINI_KEY_B`가 `.env`에 없으면 `MockAIProvider`로 자동 폴백. 워커(`caption-worker`/
  `lecture-note-worker`)는 같은 대상이 계속 실패하면(429/프롬프트 초과 등) 60초 쿨다운을 걸어
  무한 재시도로 API를 계속 두드리지 않는다.

### 기존 그대로 유지되는 것
- SQLite 스키마 초기화(`db/init.ts`) + 목업 시드(`db/seed.ts`, 데모 프로젝트 "campus-market (demo)"
  생성 — **단, 지금 로컬 DB는 시드를 안 돌린 빈 상태에서 실사용으로 채워진 상태**, 아래 참조).
- 구조도(전체 프로젝트, React Flow) + 코드 유닛 타임라인(`UnitTimeline.tsx`).
- 강의노트 뷰어, 모니터링 시작/완료 버튼 + 세션 목록, 파이프라인 런타임 통합(SPEC 4.6).

## 지금 로컬 DB에 실제로 들어있는 것 (스냅샷 — 계속 바뀜)
데모 시드 없이 완전히 빈 상태로 리셋한 뒤, 실사용으로 다시 채워진 상태다:
- `projects` 2개: `팩트코딩`(workspace_path가 **부모 폴더** `/Users/young/Madcamp/factcoding` —
  위 "주의" 참조, JSONL 연결 안 됨) / `factcoding-real`(workspace_path가 실제 리포 루트, 정상 연결).
- `sessions` 7개, `ai_explanations` 14개(전부 실제 Gemini 응답, mock 아님).
- 앱이 `env -u ELECTRON_RUN_AS_NODE npm run dev`로 백그라운드에 떠 있을 수 있다 — 새로 켜기 전에
  `ps aux | grep electron-vite`로 기존 인스턴스가 남아있는지 먼저 확인할 것(중복 실행 시 두 프로세스가
  같은 DB에 동시에 쓰기 시도).

## 아키텍처 핵심 결정
- **AIProvider 인터페이스**(`src/ai/types.ts`): `explainTurn(prompt, events, context, skillLevel)` ·
  `explainUnitVersions` · `synthesizeLectureNote` · `answerQuestion(question, context, history,
  skillLevel)`(history 추가됨). `createAIProvider()`가 키 존재 여부로 Gemini/Mock 자동 선택.
- **GeminiKeyPool은 라운드로빈** + 429 시 해당 키 60초 쿨다운(모델 레벨 폴백과는 별개 차원 —
  키 폴백이 먼저 소진되면 그 모델 전체를 포기하고 다음 모델로 넘어감). 무료 티어 일일 쿼터(모델당
  20회 수준) 소진은 이제 모델 폴백 체인으로 대부분 자동 해소된다.
- **caption-worker**(`src/app/main/caption-worker.ts`): 5초 틱, 틱당 provider 호출 1회 제한.
  1순위 = "완료된 턴" 중 아직 요약 없는 것(세션 무관, 최신 세션 우선), 2순위 = 남는 틱에
  code_unit_version 요약. 실패한 턴/버전은 60초 쿨다운.
- **lecture-note-worker**: 세션 종료 감지 → 세션 전체 강의노트 합성. 실패 시 60초 쿨다운.
- **프로젝트 스코프**: `PipelineConfig.projectId` → `Repo`의 세션/유닛/엣지 메서드 전부 projectId
  스코프. `computeUnitId(projectId, filePath, unitName)`.
- **세션 id는 더 이상 JSONL 파일명과 항상 1:1이 아니다**: 재개 감지 시 `rawId#uuid` 형태의 새 논리
  id가 생긴다 — "session id == JSONL 파일 basename"을 가정하는 새 코드를 짜지 말 것.
- **IPC push**: `PipelineHandle`에 `code-units-changed`/`session-updated`/`session-resolved` 이벤트가
  추가됨. Electron main이 이걸(과 기존 `transcript-event`, 워커의 저장 콜백을) 모아
  `DataChangeKind` 기반으로 디바운스 후 `mainWindow.webContents.send('data-changed', kind)` push.
- **DB 경로/정적 자산 계산 규칙**은 이전과 동일(`__dirname`/`import.meta.url` 금지, 호출부가 명시적으로
  계산해 주입).

## 스키마 (db/schema.sql)
이번 라운드에서 스키마 변경은 없음(세션 재개는 기존 `sessions.id TEXT PRIMARY KEY`에 다른 형식의
문자열을 넣는 것으로 해결 — 컬럼 추가 불필요). 이전 라운드에서 추가된 `projects` 테이블,
`sessions.project_id`/`code_units.project_id` 컬럼은 그대로.
로컬 dev DB는 `db/*.db*`가 gitignore 대상이라, 리셋하고 싶으면
`rm -f db/factcoding.db* && npm run db:init`(+ 데모 데이터가 필요하면 `npm run db:seed`도).

## IPC 표면 (전체 목록 — preload가 `window.factcoding`으로 노출)
```
project:list, project:create, project:selectFolder,
db:getLatestSessionId, db:getToolEvents, db:getPrompts,
db:getSkillLevel, db:setSkillLevel, db:getExplanations,
db:getCodeUnits, db:getUnitVersions, db:getUnitVersionExplanations,
db:getUnitVersionsByPrompt, db:getUnitVersionExplanationsByPrompt,
db:getCodeUnitEdges, db:getLectureNotes,
db:isOnboardingComplete, db:completeOnboarding,
db:getOnboardingProfile, db:saveOnboardingProfile,
db:explainVersionOverride, db:regenerateLectureNote,
db:answerQuestion(sessionId, question, history, skillLevel),   ← history 인자 추가됨
db:getSessions, pipeline:startMonitoring, pipeline:completeMonitoring,
pipeline:getMonitoringStatus
```
+ **push 채널**(invoke가 아니라 `ipcRenderer.on`) `data-changed`: main이 DB 갱신 시점마다
`kind: DataChangeKind`(`trace`|`code-units`|`explanation`|`lecture-note`|`session`)를 보낸다.
렌더러는 `window.factcoding.onDataChanged(callback)`으로 구독(반환값 호출로 구독 해제).

새 IPC 추가할 땐 `src/app/main/index.ts`(핸들러) + `src/app/preload/index.ts`(브릿지) 둘 다 고칠 것.
대부분의 `db:*` 조회는 `projectId`(또는 project로 스코프된 sessionId)를 인자로 받는다 — 새 쿼리
추가 시 프로젝트 스코프를 빠뜨리지 않도록 주의. DB를 갱신하는 새 경로를 추가할 땐 관련
`broadcastDataChanged(kind)` 호출도 함께 넣을 것(안 넣어도 폴링 안전망 때문에 기능은 동작하지만,
push의 장점[즉시 반영]을 못 받는다).

## 렌더러 구조 (컴포넌트/훅 현재 목록)
- **컴포넌트**: `ProjectsView`, `SessionList`, `SessionContextBar`, `TurnList` + `TurnDetailPanel` +
  `TurnChanges`(관제실), `StructureOverview`(+ `highlightUnitIds` prop) + `UnitTimeline`(구조도 탭),
  `LectureNotesViewer`, `QnaChat`, `MonitoringControl`, `OnboardingModal`(3단계 위저드),
  `DifficultySlider`.
- **훅**: `useProjects`, `useSessions`, `useSessionTrace`, `useUnitTimeline`, `useTurnDetail`,
  `useLectureNotes`, `useQna`, `useMonitoring`, `useOnboarding`, `useSkillLevel`,
  `useDataChanged`(신규 — `data-changed` push 구독 + 지정된 kind만 필터링).
- **공유 로직**: `src/shared/skillProfile.ts`(KAIST 교과과정 데이터 + `computeSkillProfile`),
  `src/shared/format.ts`(+ `serializeTurnNarrative`/`parseTurnNarrative` 신규).

## 알려진 이슈 / 최근 고친 버그
자세한 버그별 설명·재현 조건·수정 내역은 `KNOWN_BUGS_HANDOFF.md`에 있다(2026-07-13에 발견·수정한
10건 + 2026-07-14에 구현한 "다음 작업 후보" 4건 전부 기록됨). 요약:
- **알아둘 것, 안 고침**: `better-sqlite3` Node/Electron ABI 문제(아래 "다음 세션이 할 일" 참조).
  Gemini 무료 티어는 여전히 하루 총량이 유한하다 — 모델 폴백으로 완화됐을 뿐 무한하진 않음.
- **더 이상 문제 아님**: 세션 재개 시 세션 PK 재사용, 파이프라인 이벤트 미배선(폴링만 의존),
  Q&A 대화 히스토리 미포함, manual-watch가 파일 생성/삭제 미감지 — 전부 이번 라운드에서 해소.

## 아직 안 만든 것 / 남은 리스크
- 온보딩 원본 프로필(`onboarding_profile`)을 다시 보여주거나 재계산하는 UI 없음 — 저장만 해두고 있음.
- 같은 프로세스에 파이프라인 인스턴스가 하나뿐이라, 동시에 여러 프로젝트를 동시 관찰하는 건 안 됨.
- `data-changed` push는 kind만 구분하고 세션/프로젝트 스코프까지는 구분하지 않는다(멀티윈도우
  시나리오라면 관련 없는 창도 재조회 한 번 더 하지만, 지금은 창이 하나뿐이라 실질적 영향 없음).
- manual-watch는 여전히 `change`/`add`/`unlink`만 본다 — 파일 rename은 chokidar 레벨에서
  unlink+add 두 이벤트로 관측됨(별도 rename 처리 없음, 대체로 문제없이 동작하지만 원자적 "이름
  변경"으로서의 맥락은 트레이스에 안 남음).
- packaged 빌드(extraResources, Windows nsis) 실검증 안 됨 — dev 모드만 E2E 확인함.
- 실제 라이브 Claude Code 세션(수십 MB JSONL) 관찰 시 초기 리플레이 부하/캡션 백로그 미측정.

## 다음 세션이 제일 먼저 할 일
1. `git status`/`git branch`로 지금 `feature/project-workspace-realtime-ai`에 있는지 확인. 이 브랜치는
   아직 `integrate/merge-person-a-pipeline`/`main`에 머지도 push도 안 됐다 — 필요하면 먼저 처리.
2. `ps aux | grep electron-vite`로 이미 떠 있는 dev 인스턴스가 있는지 확인(중복 실행 방지). 있으면
   그대로 쓰거나, 새로 띄우려면 먼저 죽일 것.
3. `.claude/skills/verify/SKILL.md` 읽기 (ABI 리빌드, `ELECTRON_RUN_AS_NODE`, 스크린샷 방법).
   `node_modules/better-sqlite3`가 지금 Node용인지 Electron용인지 확인 후 필요하면 리빌드.
4. `env -u ELECTRON_RUN_AS_NODE npm run dev`로 기동 → **프로젝트 탭**에서 프로젝트 선택.
   `factcoding-real`(workspace_path가 실제 리포 루트)을 쓸 것 — `팩트코딩`(부모 경로)은 JSONL과
   연결 안 되니 정리하거나 무시.
5. 실제 Gemini 캡션이 계속 "생성 중…"이면 모델 폴백 체인이 전부 소진됐을 수 있다(드묾, 로그에서
   "다음 모델로 폴백" 메시지와 최종 실패 여부 확인) — `.env` 유무로 Mock/실제 provider 전환해
   원인 구분할 것.
6. 위 "아직 안 만든 것"에서 다음 작업 선택.
