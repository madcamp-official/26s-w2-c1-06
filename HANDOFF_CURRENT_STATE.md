# Factcoding — 현재 구현 상태 핸드오프 (프로젝트 워크스페이스 + 실시간 진행 로그)

이 문서는 `SPEC.md`/`HANDOFF_B_AI_UI.md`(원래 기획 핸드오프)를 대체하지 않는다.
그 문서들은 "무엇을 만들기로 했는지"를 담고, 이 문서는 **"지금 실제로 뭐가 만들어져 있고 뭐가 없는지"**를 담는다.
버그/한계 상세 내역은 `KNOWN_BUGS_HANDOFF.md`에 따로 정리돼 있다.
새 세션을 시작하는 사람은 이 문서 → `KNOWN_BUGS_HANDOFF.md` → 필요하면 `SPEC.md` 순서로 읽을 것.

## 지금 git 상태 (중요 — 다음 세션이 제일 먼저 확인할 것)
- 지금 작업 브랜치는 **`dev`**(origin에 푸시됨, `git status -sb` → `dev...origin/dev`, 워킹트리 깨끗함).
  `dev`는 `feature/project-workspace-realtime-ai`의 `c24acdc`(UI 라이트 테마 리스타일 + IA
  재구성 + 세션 라이프사이클 버그 수정 커밋, 이미 그 브랜치 자체에도 push돼 있음)에서 갈라져
  나와, 그 위에 이번 라운드(실시간 진행 로그 이식) 커밋 `5581050`을 하나 더 얹었다.
  `main`에는 아직 아무것도 머지 안 됨 — 머지/PR 필요하면 먼저 처리할 것.
- 로컬 DB(`db/factcoding.db`, gitignore 대상)는 실사용으로 계속 누적된 상태다. 프로젝트는
  `factcoding-real` 1개(workspace_path가 이 리포 루트, 정상 연결 — 예전에 있던 부모 경로
  프로젝트 "팩트코딩"은 이번 라운드에 삭제 버튼으로 지워졌다). `sessions` 168개(그중 다수는
  세션 재개(resume) 검증 중 반복 재시작으로 쌓인 것 — 대부분 빈 세션, 아래 "알려진 이슈"
  참조), `ai_explanations`는 `code_unit_version` 137 / `prompt`(턴 캡션) 21 / **`step`(신규,
  실시간 진행 로그) 11**개.
- 리포 루트에 `AI learning prototype/`, `Factcoding Frontend Demo.zip`, `.DS_Store`가 여전히
  untracked로 남아있다(참고용, 삭제해도 앱 동작 지장 없음 — 실수로 커밋되지 않게 주의).

## 한 줄 요약
지난 라운드(UI 라이트 테마 리스타일 + IA 재구성, `feature/project-workspace-realtime-ai`의
`c24acdc`)에 이어, 이번 라운드에서 다음을 추가/수정했다:
① **프로젝트 삭제 버튼**(헤더의 OFF/LIVE 배지 자리를 대체, 관측 이력까지 캐스케이드 삭제),
② 사이드바 "지난 프롬프트" 세션 목록 메뉴 제거, ③ **강의노트 품질 게이트**(프롬프트/tool_event가
없는 세션은 필러 노트를 만들지 않음) + 기존 필러 노트 정리, ④ **비정상 종료로 고아가 된 세션
자동 종료 처리**(앱 부팅 시 + 정상 종료 시 둘 다), ⑤ 헤더 로고 클릭 → 프로젝트 홈 이동,
⑥ **활동 탭 재구성**(전체 구조도/세션 활동/쌓인 지식 카드 제거, 대신 구조도 노드를 클릭하면
그 유닛의 코드 타임라인이 뜨도록), ⑦ **`feature/openai-provider-and-observation-fixes`
브랜치에서 "실시간 코드 변천사 모니터링" 부분만 골라 이식**(스텝 단위 진행 로그 — 턴이 끝나길
기다리지 않고 유휴시간/이벤트 개수로 나뉜 "스텝"이 끝나는 즉시 실제 코드 스니펫 + AI 설명을
보여준다. 그 브랜치의 OpenAI 프로바이더/퀴즈/거북이 진행바 테마는 가져오지 않음).
이 과정에서 기존에 잠재해 있던 버그 2개도 함께 발견해 고쳤다(아래 "이번에 고친 버그" 참조).

## 이번 라운드 상세

### ① 프로젝트 삭제
- `MonitoringControl.tsx`: 시작하기/완료 버튼 옆 OFF/LIVE 배지를 "삭제" 버튼으로 교체. 지금
  관찰 중인 프로젝트는 비활성화(백엔드에서도 한 번 더 막음).
- `main/index.ts`의 `deleteProject()`: FK(`foreign_keys=ON`)를 지키며 자식 행부터
  (ai_explanations → code_unit_edges/versions → tool_events → **assistant_notes** →
  prompts → lecture_notes → sessions → code_units → projects) 트랜잭션으로 삭제.
  **주의**: `assistant_notes`는 `session_id`/`prompt_id` 둘 다 FK라 `prompts`/`sessions`
  삭제보다 먼저 지워야 한다(이번에 실제로 FK 위반을 내서 순서를 고친 이력 있음).
- IPC `project:delete` + preload `deleteProject`.

### ② 사이드바 "지난 프롬프트" 제거
`SessionList`/`useSessions` 사용 제거(파일 자체는 안 지움, import만 뺌). 과거 세션을
고정해서 보는 `pinnedSessionId` 메커니즘(`useSessionTrace`)은 그대로 남아있다 — UI
진입점만 없어졌을 뿐, 필요하면 나중에 다른 UI로 다시 연결 가능.

### ③ 강의노트 품질 게이트
`lecture-note-worker.ts`: 세션에 프롬프트 1개 이상 + tool_event 1개 이상 있을 때만 강의노트를
합성(둘 중 하나라도 없으면 "제공해주신 정보가 비어 있어 템플릿 형태로 작성합니다" 같은 필러
노트가 나왔었음). 미달 세션은 한 번 판단하면 다시 로드 안 하고 영구히 건너뜀(종료된 세션은
이후 내용이 안 늘어나므로). 기존에 쌓여있던 필러 노트 85개(전체 86개 중)는 사용자 확인 후
DB에서 직접 정리했다.

### ④ 고아 세션 자동 종료
- 앱 부팅 시(`main/index.ts` 모듈 로드 직후, 어떤 pipeline도 열기 전): `ended_at IS NULL`인
  세션은 전부 이전 실행의 잔재이므로 그 시점에 자동으로 `ended_at`을 채운다. 강제 종료/충돌/
  dev 서버 재시작으로 "완료" 버튼을 못 누르고 끝난 세션의 마지막 턴이 영원히 "진행 중"으로
  안 남게 됨.
- `window-all-closed`: 예전엔 `pipeline?.stop()`만 했는데, 이제 `completeMonitoring()`을
  호출해 세션 종료 기록(`markSessionEnded`)까지 남기고 종료한다.

### ⑤ 헤더 로고 클릭
`App.tsx` 헤더의 factcoding 로고+텍스트를 버튼으로 감싸 `goToProjects`(프로젝트 목록 화면)
호출.

### ⑥ 활동 탭 재구성
- 제거: "전체 구조도" 섹션, "세션 활동"(SESSION PULSE)/"쌓인 지식"(LEARNING PULSE) 카드.
  FILES TOUCHED 카드만 유지.
- `TurnDetailPanel`("바뀐 구조와 변경사항")에 `timeline`(전역 `useUnitTimeline`)의
  `selectedUnitId`/`selectUnit`을 그대로 연결 — 미니 구조도에서 유닛 노드를 클릭하면 그
  유닛의 전체 버전 이력(`UnitTimeline`)이 같은 카드 안에 펼쳐진다(지금 이 턴에 속한 유닛일
  때만 — 다른 턴을 보다가 남은 전역 선택은 무시).

### ⑦ 실시간 진행 로그 (다른 브랜치에서 이식)
`feature/openai-provider-and-observation-fixes`(전혀 다른 스키마/AIProvider 모양으로
훨씬 일찍 갈라져 나간 브랜치 — OpenAI 프로바이더, 퀴즈, "거북이 진행바" FM매니저 테마,
TTS 캐스터까지 포함된 큰 브랜치)에서 **"스텝 단위 실시간 코드 변천사 모니터링" 개념만**
뽑아서 우리 아키텍처(턴 단위 `content`/`concept_tags` 필드, 5단계 SkillLevel, Gemini
모델 폴백 체인)에 맞게 재구현했다. 그 브랜치의 `content`→`summary` 컬럼 리네임은 따라가지
않았고(기존 코드 전부 건드려야 해서), OpenAI 프로바이더/퀴즈/진행바 테마도 가져오지 않았다.

- **`shared/steps.ts`**: `groupIntoSteps(notes, events)` — tool_events를 프롬프트(턴)로
  먼저 버킷팅한 뒤, 각 턴 안에서 유휴시간(90초) 또는 이벤트 개수(6개) 기준으로 "스텝"을
  나눈다. 턴이 끝나길 기다리지 않는다는 게 핵심 — 마지막 스텝은 세션이 안 끝났으면
  "진행 중"으로 취급되고 요약 대상에서 제외된다.
- **`step-worker.ts`**(신규, `caption-worker.ts`/`lecture-note-worker.ts`와 나란히 실행):
  5초마다 최신 세션의 스텝을 계산해 아직 요약 안 된 완료 스텝을 배치(최대 3개)로
  `aiProvider.summarizeSteps()` 호출. 대표 코드는 AI가 만드는 게 아니라
  `stepCodeExtract.ts`의 `pickCodeCandidate`/`extractDiffSnippetLines`가 실제
  old_string/new_string에서 결정론적으로 뽑고, AI는 explanation/importance/application
  3필드 설명만 채운다(코드를 잘못 옮겨적을 위험 원천 차단). 실패 스텝의 에러 원문도
  AI 없이 `result_content`에서 그대로 truncate해서 보여준다. **1.5초 주기의 별도
  "지금 하는 중" 라이브 상태**도 계산(로컬 규칙만 사용, Gemini 응답을 안 기다림) —
  `step:getLiveStatus`(pull, 마운트 캐치업용) + `step-live-status`(push) IPC.
  진행바/퍼센트/사이클 같은 게이미피케이션 요소는 없음(원 브랜치에서 의도적으로 제외).
- **스키마 확장**(기존 로컬 DB에도 idempotent ALTER로 반영, `db/connection.ts`의
  `applyMigrations` 참조): `assistant_notes` 테이블(신규, 에이전트의 assistant_text
  조각 전부 보존 — 턴당 1개만 남는 `prompts.plan_text`와 달리), `tool_events.result_content`
  (tool_result 텍스트, truncate), `code_unit_versions.step_id`(현재 백필 로직은 구현 안 함,
  항상 null — 필요해지면 `step-worker.ts`에 역추적 로직 추가), `ai_explanations`에
  `key_code_snippet/lang/file/other_files/explanation/importance/application`,
  `error_detail`, `status`(step 행 전용, 기존 `content`/`concept_tags`는 그대로 재사용).
  `AiExplanationTargetType`에 `'step'` 추가.
- **파이프라인**(`src/pipeline/index.ts`, `observation/transcript-parser.ts`,
  `db/repo.ts`): `extractResultText()`로 tool_result 내용을 펼쳐 `result_content`에 저장.
  `assistant_text` 이벤트마다 기존 plan_text 갱신과 별개로 `assistant_notes`에 텍스트
  조각을 전부 저장(`repo.insertAssistantNote`). `repo.updateToolEventResult`가
  `resultContent` 인자를 추가로 받음(호출부 2곳 모두 수정).
- **UI**: `TurnDetailPanel`에 "실시간 진행 로그" 섹션(`StepProgressLog.tsx`, 신규) —
  이 턴(promptId)에 속한 스텝만 필터링해서 카드로 나열, 대부분의 내용이 여기 들어간다는
  요청에 따라 코드 스니펫+설명이 제일 크게 보인다. `PromptTimeline`의 "진행 중" 노드는
  호버 시 툴팁에 라이브 상태 텍스트를 붙인다. 활동 탭 헤더의 "LIVE SESSION" 옆에도
  같은 텍스트가 인라인으로 뜬다. `useSteps(sessionId, skillLevel)` 훅이 세션 전체
  스텝을 한 번에 가져오고(호출부가 promptId로 필터), `useLiveStatus()` 훅이 push
  구독 + 마운트 시 pull 캐치업을 담당.

## 이번에 발견해서 고친 버그 (신규 기능과 무관하게 잠재해 있던 것)
1. **"최신 세션" 조회의 동점 처리 불안정**: `getLatestSessionId`(프로젝트 스코프)와
   `step-worker`의 `getLatestSession`(전역) 둘 다 `ORDER BY started_at DESC LIMIT 1`만
   썼는데, 세션 재개(resume)로 발급된 논리 id들은 원본 세션의 `started_at`을 그대로
   물려받아 서로 값이 같을 수 있다(`resolveLogicalSessionId` 참조). 동점일 때 SQLite
   쿼리 플래너가 어느 행을 고를지 보장이 없어, 실제로 진행 로그 테스트 중 "최신"이
   몇 시간 전에 끝난 세션으로 잘못 뽑히는 걸 재현했다. `rowid DESC`를 2차 정렬 기준으로
   추가해 고쳤다 — 항상 가장 나중에 만들어진 행이 이긴다.
2. **프로젝트 삭제 캐스케이드 순서**: `assistant_notes`(신규 테이블) 삭제가 `prompts`
   삭제보다 뒤에 있어서 FK 위반이 났다 — `assistant_notes`를 `prompts`/`sessions`
   삭제보다 먼저 지우도록 순서를 바꿨다(위 "① 프로젝트 삭제" 참조).

## 검증 방법 (이번 라운드)
매 기능마다 실제 Electron 창을 `capturePage()`로 스크린샷해 확인했다(`.claude/skills/verify/SKILL.md`
참고). 특히 이번 라운드는 **이 대화 자체(factcoding-real 프로젝트, 이 리포를 관찰 대상으로)를
실제로 "시작하기"로 관찰 켜고, 진행 중이던 실제 Bash 도구 호출들이 스텝으로 잡혀 실제 Gemini
응답으로 요약되는 것까지 DB에서 직접 확인**했다 — mock이 아니라 실제 파이프라인 종단 검증.
구조도 노드 클릭 → 코드 타임라인도 합성 PointerEvent(react-flow는 일반 클릭 이벤트로는
안 잡히고 좌표 있는 pointerdown/pointerup 쌍이 필요)로 재현해 확인했다.
**주의**: 이 앱은 dev 모드에서 `electron-vite dev`가 **main/preload 파일 변경을 자동으로
재시작하지 않는다**(이 환경에서 반복 확인됨 — 일반적인 electron-vite 동작과 다를 수 있음).
main 쪽을 고쳤으면 `pkill -f "Madcamp/factcoding/26s-w2-c1-06" && npm run dev`로 수동
재시작해야 반영된다.

## 돌아가는 것 (실제로 실행해서 확인함)

### 프로젝트 워크스페이스
- 앱을 켜면 항상 "프로젝트" 화면이 먼저 뜬다. 사이드바 프로젝트 목록 + 선택한 프로젝트의
  개요/활동/노트 3탭 구조(지난 라운드 리스타일 그대로). 헤더 로고 클릭으로 언제든 이
  화면으로 돌아올 수 있다(신규).
- 프로젝트 등록/삭제 모두 가능(삭제는 이번 라운드 신규, 관찰 중인 프로젝트는 못 지움).
- `code_units.id` 해시에 `project_id` 포함 — 프로젝트 간 충돌 없음(기존과 동일).

### 온보딩 + 난이도
지난 라운드와 동일 — 3단계 위저드 + 헤더 아래 "난이도 조절" 5칸 슬라이더.

### 관제실 (개요/활동 탭)
- **개요**: 프로젝트 구조 미니 그래프(전체 히스토리, 유닛 노드 클릭 가능) + `RecentTurns`
  ("직전 실행의 과정", 완료된 프롬프트만) + aside(현재 프롬프트 카드/최근 강의노트/Q&A).
- **활동**: 라이브 히어로(+ 실시간 상태 텍스트, 신규) + `SessionContextBar` +
  `PromptTimeline`(진행 중 노드 호버 시 라이브 상태 툴팁, 신규) + `TurnDetailPanel`
  (구조도 → 클릭 시 코드 타임라인 → **실시간 진행 로그**(신규) → 변경사항, 순서로 쌓임)
  + FILES TOUCHED 카드 1개(신규, 예전엔 3카드).
- **AI 호출 경로 2개**: `caption-worker`(턴 완료 시 1회, `explainTurn`)와 `step-worker`
  (스텝 완료 시마다, `summarizeSteps`)가 독립적으로 돈다 — 같은 `aiProvider` 인스턴스를
  공유하므로 Gemini 키 풀/모델 폴백 쿨다운도 공유된다.
- **실시간 갱신**: 기존 `data-changed` push(kind: trace/code-units/explanation/
  lecture-note/session) 그대로 — step 요약도 `ai_explanations` 행이라 `'explanation'`
  kind로 push된다. 라이브 상태만 별도의 `step-live-status` 채널(휘발성, DB 캐치업 대상 아님).

### 파이프라인 안정성/기능 (백엔드)
지난 라운드 내용(manual-watch add/unlink, 세션 재개 PK 분리, async stop, Gemini 모델
폴백 체인)은 전부 그대로 유지. 이번 라운드 추가분은 위 "⑦ 실시간 진행 로그" 참조
(`result_content`/`assistant_notes` 캡처).

### AI 프로바이더
`explainTurn`/`explainUnitVersions`/`synthesizeLectureNote`/`answerQuestion`은 지난
라운드와 동일. **`summarizeSteps`가 신규 추가**(Gemini + Mock 둘 다 구현) — 나머지 3개
메서드처럼 `generateJson`/`generateText` 공통 헬퍼와 모델 폴백 체인을 그대로 재사용한다.

## 아키텍처 핵심 결정
- **AIProvider 인터페이스**(`src/ai/types.ts`): `explainTurn` · `summarizeSteps`(신규) ·
  `explainUnitVersions` · `synthesizeLectureNote` · `answerQuestion`.
- **워커 3개가 독립적으로 돈다**: `caption-worker`(턴 완료 시), `lecture-note-worker`
  (세션 종료 시), `step-worker`(스텝 완료 시마다, 가장 촘촘한 주기) — 전부 같은
  `aiProvider`/`db` 인스턴스를 공유하고, 각자 실패 시 자기 대상만 60초 쿨다운.
- **"최신 세션" 조회는 항상 `rowid DESC`를 2차 정렬로 넣을 것** — 세션 재개로 발급된
  논리 id들이 `started_at`을 공유할 수 있어서, 이거 없으면 동점 처리가 쿼리 플래너에
  좌우된다(위 "이번에 고친 버그" 참조). 새로 "최신 세션 하나"를 뽑는 쿼리를 짤 때 반드시
  같이 넣을 것.
- **스텝(step)은 별도 테이블에 저장하지 않고 항상 파생시킨다**: `db:getSteps` IPC와
  `step-worker`가 똑같이 `groupIntoSteps(notes, events)`를 그때그때 다시 계산해서
  `ai_explanations(target_type='step')`와 조인한다 — 두 곳의 경계 정의가 어긋날 일이
  없다. 새로 스텝 관련 조회를 추가할 때도 이 패턴을 따를 것(스텝 경계를 별도로
  캐싱/저장하지 말 것).
- **DB 스키마를 바꿀 때 기존 로컬 DB 마이그레이션도 같이 고려할 것**: `CREATE TABLE
  IF NOT EXISTS`는 새 테이블엔 되지만 기존 테이블에 컬럼을 추가하는 덴 안 먹는다(SQLite는
  `ALTER TABLE ADD COLUMN IF NOT EXISTS`를 지원 안 함) — `db/connection.ts`의
  `applyMigrations`(컬럼 존재 여부 확인 후 조건부 `ALTER TABLE`)에 추가할 것.
- **프로젝트 삭제 시 캐스케이드 삭제 순서 주의**: FK가 있는 새 테이블을 추가하면
  `deleteProject()`의 삭제 순서(자식 → 부모)에도 반드시 반영할 것 — 이번에 `assistant_notes`
  누락으로 실제 버그가 났었다.
- 그 외 결정(세션 id ≠ JSONL 파일명 1:1, IPC push 디바운스, DB 경로 계산 규칙 등)은
  지난 라운드와 동일 — `KNOWN_BUGS_HANDOFF.md` 참조.

## 스키마 (db/schema.sql)
이번 라운드에서 추가된 것: `assistant_notes` 테이블(+`idx_assistant_notes_session_time`
인덱스), `tool_events.result_content`, `code_unit_versions.step_id`,
`ai_explanations.key_code_snippet/key_code_lang/key_code_file/key_code_other_files/
key_code_explanation/key_code_importance/key_code_application/error_detail/status`.
전부 nullable 추가 컬럼이라 기존 데이터/쿼리와 호환된다. 로컬 dev DB는 `db/*.db*`가
gitignore 대상 — 리셋하려면 `rm -f db/factcoding.db* && npm run db:init`(그러면
`applyMigrations`가 처음부터 다 반영된 스키마로 새로 만들어짐).

## IPC 표면 (전체 목록 — preload가 `window.factcoding`으로 노출)
```
project:list, project:create, project:selectFolder, project:delete,
db:getLatestSessionId, db:getToolEvents, db:getPrompts,
db:getSkillLevel, db:setSkillLevel, db:getExplanations, db:getSteps,
db:getCodeUnits, db:getUnitVersions, db:getUnitVersionExplanations,
db:getUnitVersionsByPrompt, db:getUnitVersionExplanationsByPrompt,
db:getCodeUnitEdges, db:getLectureNotes,
db:isOnboardingComplete, db:completeOnboarding,
db:getOnboardingProfile, db:saveOnboardingProfile,
db:explainVersionOverride, db:regenerateLectureNote,
db:answerQuestion(sessionId, question, skillLevel),
db:getSessions, pipeline:startMonitoring, pipeline:completeMonitoring,
pipeline:getMonitoringStatus, step:getLiveStatus
```
+ **push 채널**: `data-changed`(kind: `trace`|`code-units`|`explanation`|`lecture-note`|
`session`, `window.factcoding.onDataChanged`로 구독) + **`step-live-status`**(신규,
`LiveStatus` 페이로드, `window.factcoding.onStepLiveStatus`로 구독 — DB 캐치업 대상
아님, 마운트 시엔 `getLiveStatus()` pull로 현재값을 한 번 당겨올 것).

새 IPC 추가할 땐 `src/app/main/index.ts`(핸들러) + `src/app/preload/index.ts`(브릿지) 둘 다
고칠 것. 대부분의 `db:*` 조회는 `projectId`(또는 project로 스코프된 sessionId)를 인자로
받는다 — 새 쿼리 추가 시 프로젝트 스코프를 빠뜨리지 않도록 주의.

## 렌더러 구조 (컴포넌트/훅 현재 목록)
- **컴포넌트(신규)**: `StepProgressLog`(활동 탭 TurnDetailPanel 안, 실시간 진행 로그 카드).
- **컴포넌트(변경)**: `TurnDetailPanel`(steps prop 추가, 코드 타임라인 + 진행 로그 섹션),
  `PromptTimeline`(liveStatus prop, 진행 중 노드 툴팁), `MonitoringControl`(삭제 버튼),
  `RecentTurns`(steps/삭제 관련 prop 전달만, 로직 변화 없음). `SessionList.tsx`는 더 이상
  App.tsx에서 안 씀(파일은 남아있음, import만 제거).
- **훅(신규)**: `useSteps(sessionId, skillLevel)`, `useLiveStatus()`.
- **훅(기존 유지)**: `useProjects`(deleteProject 추가), `useSessions`(더 이상 App.tsx에서
  안 씀), 나머지는 지난 라운드와 동일.
- **공유 로직(신규)**: `src/shared/steps.ts`(`groupIntoSteps`), `src/shared/stepProgress.ts`
  (`LiveStatus` 타입). `src/ai/prompt-templates/stepCodeExtract.ts`(결정론적 코드 후보
  추출 — `pickCodeCandidate`/`extractDiffSnippetLines`/`summarizeRawPayload`/
  `errorDetailOf`), `summarizeStepsPrompt.ts`(AI 프롬프트).

## 알려진 이슈 / 최근 고친 버그
- **알아둘 것, 안 고침**: Gemini 무료 티어는 여전히 하루 총량이 유한하다(모델 폴백으로
  완화됐을 뿐). `code_unit_versions.step_id`는 스키마엔 있지만 백필 로직 미구현(항상
  null) — 필요해지면 `step-worker.ts`에 `tool_event_id` 역추적 로직을 추가할 것(포크한
  원본 브랜치의 `progress-worker.ts`에 참고 구현 있음, 단 거기는 `assistant_notes.id` 기준이라
  그대로 베끼면 안 되고 지금 스키마의 "스텝 id = 첫 tool_event id" 기준으로 다시 맞춰야 함).
- **더 이상 문제 아님**: 필러 강의노트 생성, 고아 세션이 영원히 "진행 중"으로 남는 문제,
  세션 동점 처리로 "최신"이 엉뚱하게 뽑히는 문제, 프로젝트 삭제 시 FK 위반 — 전부 이번
  라운드에 해소.
- **로컬 DB에 테스트 잔재 다수**: `sessions` 168개 중 상당수가 이번 라운드 검증(반복
  재시작)으로 생긴 빈 세션이다. 강의노트 게이트/캡션 게이트 둘 다 "프롬프트·tool_event
  없는 세션은 스킵"하므로 화면에 필러로 나타나진 않지만, DB 자체는 지저분하다 — 필요하면
  `rm -f db/factcoding.db* && npm run db:init`으로 리셋하고 실사용으로 다시 채울 것.

## 아직 안 만든 것 / 남은 리스크
- `code_unit_versions.step_id` 백필 미구현(위 참조) — 지금은 "구조도 노드 클릭 → 그 유닛을
  만든 스텝으로 스크롤/하이라이트" 같은 연결은 안 된다. 코드 타임라인과 진행 로그는 각자
  독립적으로 보여줄 뿐.
- Q&A 대화 히스토리 미포함(지난 라운드에서 이미 알려진 한계, 그대로).
- 온보딩 원본 프로필을 다시 보여주거나 재계산하는 UI 없음.
- 같은 프로세스에 파이프라인 인스턴스가 하나뿐 — 동시에 여러 프로젝트 관찰 불가.
  `step-worker`도 전역 "최신 세션" 하나만 보므로 이 제약과 일관된다.
- packaged 빌드(extraResources, Windows nsis) 실검증 안 됨 — dev 모드만 E2E 확인함.
- `feature/openai-provider-and-observation-fixes`의 나머지 부분(OpenAI 프로바이더, 퀴즈,
  세션 idle-switch 로직, JSONL 커서 영속화)은 이번에 안 가져왔다 — 필요해지면 그 브랜치
  diff를 다시 참고할 것(`git log origin/feature/openai-provider-and-observation-fixes`).

## 다음 세션이 제일 먼저 할 일
1. `git status`/`git branch`로 지금 `dev` 브랜치에 있는지, 워킹트리가 깨끗한지 확인.
   `dev`/`feature/project-workspace-realtime-ai` 둘 다 아직 `main`에 안 머지됨 — 필요하면
   먼저 PR/머지 처리.
2. `ps aux | grep electron-vite`로 이미 떠 있는 dev 인스턴스가 있는지 확인(중복 실행 방지).
3. `.claude/skills/verify/SKILL.md` 읽기(ABI 리빌드, `ELECTRON_RUN_AS_NODE`, 스크린샷 방법).
   `node_modules/better-sqlite3`가 지금 Node용인지 Electron용인지 확인 후 필요하면 리빌드.
4. `env -u ELECTRON_RUN_AS_NODE npm run dev`로 기동 → 프로젝트 탭에서 `factcoding-real` 선택
   (다른 프로젝트가 없으면 이것만 있을 것) → "시작하기"로 관찰 재개.
5. 위 "아직 안 만든 것"에서 다음 작업 선택, 또는 `code_unit_versions.step_id` 백필처럼
   이번 라운드에서 의도적으로 미룬 항목부터 검토.
