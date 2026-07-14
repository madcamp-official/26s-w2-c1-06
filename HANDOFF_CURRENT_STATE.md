# Factcoding — 현재 구현 상태 핸드오프 (프로젝트화 + 턴 단위 재구성 완료 시점)

이 문서는 `SPEC.md`/`HANDOFF_B_AI_UI.md`(원래 기획 핸드오프)를 대체하지 않는다.
그 문서들은 "무엇을 만들기로 했는지"를 담고, 이 문서는 **"지금 실제로 뭐가 만들어져 있고 뭐가 없는지"**를 담는다.
새 세션을 시작하는 사람은 이 문서 → 필요하면 `SPEC.md` 순서로 읽을 것.

## 한 줄 요약
Day 1~7 + 파이프라인 런타임 통합에 이어, 이번 세션에서 4가지 큰 변화가 추가됨:
① UI를 Figma "AI learning prototype" 톤(Tailwind v4 + 다크 민트)으로 전면 개편,
② 코드베이스를 **프로젝트 단위**로 등록·전환하는 워크스페이스 개념 도입,
③ 온보딩을 **KAIST 전산학부 교육과정 기반 3단계 위저드**로 바꾸고 난이도를 5단계 슬라이더로 세분화,
④ AI 해설 생성을 **개별 tool_event 단위 → 턴(prompt) 완료 단위**로 바꿔 API 호출을 줄이고,
관제실을 "턴을 선택하면 그 턴의 구조도·변경사항·요약을 큰 화면에서 보는" 구조로 재구성함.

## 돌아가는 것 (실제로 실행해서 확인함)

### 프로젝트 워크스페이스 (신규)
- 앱을 켜면 **항상 "프로젝트" 탭이 먼저 뜬다** — 관제실/구조도/강의노트는 전부 `project_id`로
  스코프되므로, 프로젝트를 고르거나 새로 등록해야 그 화면들을 볼 수 있다.
- 새 프로젝트 등록: 이름 입력 + `dialog.showOpenDialog`로 코드 워크스페이스 폴더 선택 →
  `projects` 테이블에 저장. 워크스페이스 경로가 이미 등록돼 있으면 기존 row를 그대로 반환(get-or-create).
- `code_units.id` 해시(`computeUnitId`)에 `project_id`를 포함시켜, 서로 다른 프로젝트가 같은
  상대경로+유닛명을 가져도(예: 둘 다 `src/App.tsx`의 `App`) id가 충돌해 구조도/버전이 섞이지 않는다.
- 사이드바 "현재 프로젝트" 카드 클릭 시 프로젝트 탭으로 즉시 전환. 모니터링은 프로세스 전체에
  파이프라인 인스턴스가 하나뿐이라, 다른 프로젝트를 관찰 중이면 "시작하기" 버튼이 비활성화되고
  이유가 표시된다.

### 온보딩 + 난이도 (전면 개편)
- 온보딩이 3단계 위저드로 바뀜: **①수강 과목**(KAIST 전산학부 전공필수 9과목 체크리스트 +
  전산기구조/시스템 프로그래밍 강조 옵션 + 직접 추가) → **②프로젝트 경험**(프로젝트 개수 4구간 +
  기술 스택 프리셋 9개 + 직접 추가) → **③교육 스타일**(원리부터/일단 만들어보고/비유로/균형).
- `src/shared/skillProfile.ts`의 `computeSkillProfile()`이 ①(이론/Bottom-up 신호)과 ②(실전/Top-down
  신호)를 절반씩 정규화해 합치고, ③으로 ±1칸 미세조정해 5단계 중 하나로 매핑한다.
- `SkillLevel`이 3단계(`beginner/intermediate/advanced`) → **5단계**(`novice/beginner/intermediate/
  advanced/expert`)로 확장됨. 전부 `Record<SkillLevel,string>` 테이블(AI 톤 지시문 등)이라 값 추가만으로
  안전하게 확장됨 — 기존 3개 값은 그대로 유효해 DB 마이그레이션 불필요.
- 헤더의 "초급/중급/고급" 3버튼 토글은 **"난이도 조절" 슬라이더**(`DifficultySlider.tsx`, 5칸)로 교체 —
  온보딩이 계산한 위치에서 시작해 언제든 밀어서 더 쉽거나 어렵게 재조정 가능.
- 온보딩 원본 프로필(과목/프로젝트/스타일)은 `user_settings.onboarding_profile`에 JSON으로 저장돼
  있지만, 계산된 `skill_level` 외에는 아직 다른 곳에서 다시 읽지 않음 (향후 "프로필 다시 보기"용 보관).

### 관제실 (턴 단위로 재구성)
- **AI 호출 시점 변경**: 예전엔 5초마다 아직 캡션 없는 tool_event(Read/Write/Bash 등)를 최대 5개씩
  계속 배치 호출했음. 지금은 `caption-worker.ts`가 "턴이 완료됐는지"(같은 세션에 다음 턴이 이미
  시작됐거나 세션이 끝났는지)부터 확인하고, 완료된 턴 하나당 **딱 한 번만** AI를 호출해 그 턴에서
  일어난 모든 액션(Read/Edit/Write/Bash 등)을 하나의 feature 단위 요약으로 합친다
  (`AIProvider.explainTurn`, `ai/prompt-templates/explainTurnPrompt.ts`). 아직 진행 중인 마지막 턴은
  완료될 때까지 호출하지 않는다. `ai_explanations.target_type = 'prompt'`로 저장.
- **턴 해설 서술식(말풍선) 개편**: 턴 요약이 딱딱한 한 덩어리 caption이 아니라, "코딩을 알려주고
  싶어하는 친절한 사수"가 슬랙 말풍선을 보내듯 **overview(전체 구조도에서 이번 턴이 만진 곳 짚기)
  → change(바뀐 내용 서술식 해설, 1~3개) → concept(알아야 하는 개념·자료구조·알고리즘, 1~2개)**
  순서의 말풍선 배열로 생성된다. `explainTurn(prompt, events, context, skillLevel)`의 `context`로
  이 턴의 변경 유닛 버전(diff 포함) + 프로젝트 전체 구조도(유닛/엣지)를 넘겨서, overview 말풍선이
  실제 유닛 이름을 가리키며 서술할 수 있다. 결과는 `serializeTurnNarrative()`(shared/format.ts)로
  기존 `ai_explanations.content` 컬럼에 JSON(`turn-narrative-v1`) 직렬화 — 렌더러는
  `parseTurnNarrative()`로 읽고, **개편 전에 캐시된 평문 요약은 overview 말풍선 하나로 폴백**되므로
  스키마 변경·캐시 무효화가 없다.
- **레이아웃 변경**: 왼쪽 `TurnList`(컴팩트한 턴 선택자 — 요청 텍스트 + 완료/진행중 상태 + 작업
  개수만 표시, Read/Write/Bash 나열 없음) + 오른쪽 `TurnDetailPanel`(턴 헤더[요청+한 줄 요약+개념
  태그] 아래에 **전체 구조도**(이번 턴에서 바뀐 유닛만 하이라이트, 나머지 노드·엣지는 흐림 —
  `StructureOverview`의 `highlightUnitIds` prop)와 **"사수의 해설" 말풍선 컬럼**(concept 말풍선은
  전구 아이콘+노란 계열로 구분)을 나란히 배치, **diff 목록은 맨 아래 "코드 변경 상세" `<details>`로
  접어서** 보조 정보로 강등). 예전의 `TracePanel`/`ExplainerPanel`은 삭제되고 이 둘로 대체됨.
- 프롬프트에 연결되지 않은 이벤트(수동 수정 등, SPEC 4.1 fallback)는 `TurnList`에 "수동 수정" 항목으로
  묶여 나오고, 선택하면 `prompt_id IS NULL` 스코프로 조회된 변경사항을 보여준다(feature 요약은 없음 —
  요약은 프롬프트가 있는 턴에만 생성됨).
- 코드 유닛 버전(Level 3) 요약은 예전과 동일하게 caption-worker의 남는 틱에서 계속 생성됨(구조도 탭
  전용, 이번 변경과 무관).

### UI 전면 재스타일 (Figma "AI learning prototype" 톤)
- Tailwind CSS v4 + `@tailwindcss/vite` + lucide-react 아이콘 + IBM Plex Sans KR/JetBrains Mono 폰트로
  전환. 사이드바(로고 + 프로젝트/관제실/구조도/강의노트 네비 + 현재 프로젝트 + 세션 목록 + 난이도
  슬라이더) + 72px 헤더(질문하기 · 모니터링 상태 · 시작하기/완료) 셸.
- 다크 민트 팔레트는 `src/app/renderer/src/styles.css`에 CSS 변수로 정의, react-flow/markdown용
  최소 커스텀 클래스만 남기고 나머지는 Tailwind 유틸리티 클래스.

### 기존 그대로 유지되는 것
- SQLite 스키마 초기화(`db/init.ts`) + 목업 시드(`db/seed.ts`, 이제 데모 프로젝트 "campus-market (demo)"도
  같이 생성함).
- 구조도(전체 프로젝트, React Flow) + 코드 유닛 타임라인(유닛 하나의 버전 체인, `UnitTimeline.tsx`) —
  관제실의 턴 스코프 미니 구조도와는 별개로 그대로 존재.
- 강의노트 뷰어, Q&A 챗, 모니터링 시작/완료 버튼 + 세션 목록, 파이프라인 런타임 통합(SPEC 4.6).
- `GEMINI_KEY_A`/`GEMINI_KEY_B`가 `.env`에 없으면 `MockAIProvider`로 자동 폴백.

## 아키텍처 핵심 결정
- **AIProvider 인터페이스**(`src/ai/types.ts`): `explainTurn(prompt, events, context, skillLevel)`(턴 단위,
  이번에 `explainBatch`를 대체, `context: TurnContext`로 변경 유닛 버전 + 전체 구조를 주입) ·
  `explainUnitVersions` · `synthesizeLectureNote` · `answerQuestion`.
  `createAIProvider()`가 키 존재 여부로 Gemini/Mock 자동 선택.
- **GeminiProvider.generateJson은 제네릭**(`generateJson<T>(prompt, schema, fallback)`)으로 바꿔
  배열 응답(유닛 버전)과 단일 객체 응답(턴 요약)을 둘 다 지원.
- **GeminiKeyPool은 라운드로빈** + 429 시 해당 키 60초 쿨다운 + 폴백. **무료 티어 일일 쿼터(20회/일,
  모델당)에 실제로 걸림** — 하루 안에 여러 번 검증하다 보면 `RESOURCE_EXHAUSTED` 429가 뜨는데, 코드
  버그가 아니라 쿼터 소진이다. 이 경우 `.env`를 잠시 옮겨 `MockAIProvider`로 강제 전환해 로직만
  검증하는 방식을 씀(검증 후 반드시 `.env` 복구).
- **caption-worker**(`src/app/main/caption-worker.ts`): 5초 틱, 틱당 provider 호출 1회 제한.
  1순위 = "완료된 턴" 중 아직 요약 없는 것(있으면 그 턴만 처리하고 return), 2순위 = 남는 틱에
  code_unit_version 요약. 턴 완료 판정 SQL은 `EXISTS(다음 turn_index) OR sessions.ended_at IS NOT NULL`.
- **lecture-note-worker**: 이전과 동일(세션 종료 감지 → 세션 전체 강의노트 합성), 이번 세션에서
  변경 없음.
- **프로젝트 스코프**: `PipelineConfig.projectId` 추가 → `Repo.ensureSession`/`upsertCodeUnit`/`findUnitId`
  전부 projectId를 받아 저장·조회. `computeUnitId(projectId, filePath, unitName)`로 해시 변경.
  CLI(`config.ts`)는 `FACTCODING_PROJECT_ID` env(기본값 `'cli-default'`)로 계속 동작 — Electron의
  프로젝트 등록 흐름과는 별개의 단독 실행 경로.
- **DB 경로/정적 자산 계산 규칙**은 이전과 동일(`__dirname`/`import.meta.url` 금지, 호출부가 명시적으로
  계산해 주입) — 이번 세션에서 안 건드림.

## 스키마 (db/schema.sql) — 이번 세션에서 바뀐 부분
- `projects` 테이블 신규: `id, name, workspace_path(UNIQUE), created_at`.
- `sessions`에 `project_id` 컬럼 추가(nullable, FK).
- `code_units`에 `project_id` 컬럼 추가(nullable, FK) — id 자체도 project_id를 포함해 재해시됨.
- `ai_explanations.target_type`에 `'prompt'`(턴 단위 feature 요약) 값이 새로 쓰임. 기존
  `'tool_event'`/`'code_unit_version'`/`'qna'`는 컬럼 자체가 자유 TEXT라 스키마 변경 없이 공존.
- 인덱스 추가: `idx_sessions_project`, `idx_units_project`.
- 로컬 dev DB는 `db/*.db*`가 gitignore 대상이라, 스키마 바뀔 때마다
  `rm -f db/factcoding.db* && npm run db:init && npm run db:seed`로 리셋하면 됨(운영 마이그레이션 없음,
  아직 배포 전이라 허용되는 방식).

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
db:explainVersionOverride, db:regenerateLectureNote, db:answerQuestion,
db:getSessions, pipeline:startMonitoring, pipeline:completeMonitoring,
pipeline:getMonitoringStatus
```
새 IPC 추가할 땐 `src/app/main/index.ts`(핸들러) + `src/app/preload/index.ts`(브릿지) 둘 다 고칠 것.
대부분의 `db:*` 조회는 이제 `projectId`(또는 세션이 이미 project로 스코프된 경우 sessionId)를
인자로 받는다 — 새 쿼리 추가 시 프로젝트 스코프를 빠뜨리지 않도록 주의.

## 렌더러 구조 (컴포넌트/훅 현재 목록)
- **컴포넌트**: `ProjectsView`(프로젝트 탭), `SessionList`, `SessionContextBar`, `TurnList` +
  `TurnDetailPanel` + `TurnChanges`(관제실, 신규), `StructureOverview` + `UnitTimeline`(구조도 탭),
  `LectureNotesViewer`, `QnaChat`, `MonitoringControl`, `OnboardingModal`(3단계 위저드),
  `DifficultySlider`(신규, 예전 `SkillLevelToggle` 대체).
- **훅**: `useProjects`, `useSessions`, `useSessionTrace`, `useUnitTimeline`, `useTurnDetail`(신규),
  `useLectureNotes`, `useQna`, `useMonitoring`, `useOnboarding`, `useSkillLevel`.
- **공유 로직**: `src/shared/skillProfile.ts`(KAIST 교과과정 데이터 + `computeSkillProfile` 순수함수),
  `src/shared/format.ts`(기존 유지).

## 알려진 이슈 / 이번에 고친 버그
- (알아둘 것, 이번에 처음 겪음) **Gemini 무료 티어 일일 쿼터(모델당 20회/일)가 하루 안에 여러 번
  검증하면 실제로 소진됨** — `RESOURCE_EXHAUSTED` 429가 뜨면 코드 버그가 아니라 쿼터 문제다.
  `.env`를 임시로 옮겨(`mv .env .env.bak`) `MockAIProvider`로 강제 전환해서 로직만 검증하고, 검증 후
  반드시 `.env`를 원상 복구할 것.
- (알아둘 것, 안 고침) `better-sqlite3` Node/Electron ABI 문제는 이전과 동일 — 아래 "다음 세션이 할 일"
  참조.
- 이전 세션에서 고친 버그들(`useSessionTrace` null 세션 무한로딩, React Flow 라이트 테마, `startPipeline`
  초기 이벤트 레이스)은 계속 유효, 이번 세션에서 재발 없음.

## 아직 안 만든 것 / 남은 리스크
- 온보딩 원본 프로필(`onboarding_profile`)을 다시 보여주거나 재계산하는 UI 없음 — 저장만 해두고 있음.
- 같은 프로세스에 파이프라인 인스턴스가 하나뿐이라, 동시에 여러 프로젝트를 동시 관찰하는 건 안 됨
  (다른 프로젝트 관찰 중이면 "시작하기"가 비활성화되고 안내만 뜸 — 멀티 파이프라인 지원은 로드맵).
- packaged 빌드(extraResources, Windows nsis) 실검증 안 됨 — dev 모드만 E2E 확인함.
- 실제 라이브 Claude Code 세션(수십 MB JSONL) 관찰 시 초기 리플레이 부하/캡션 백로그 미측정.
- **(2026-07-14 해소됨)** 아래는 이 문서 작성 시점엔 리스크였지만 이후 세션에서 고쳐짐 —
  자세한 내용은 `KNOWN_BUGS_HANDOFF.md`의 "2026-07-14에 구현한 다음 작업 후보" 참조:
  세션 재개 시 세션 PK 재사용 문제, 파이프라인 이벤트 → IPC push 미배선, Q&A 대화 히스토리
  미포함, manual-watch가 파일 생성/삭제를 감지 못하던 것.

## 다음 세션이 제일 먼저 할 일
1. `.claude/skills/verify/SKILL.md` 읽기 (ABI 리빌드, `ELECTRON_RUN_AS_NODE`, 스크린샷 방법)
2. `node_modules/better-sqlite3`가 지금 Node용인지 Electron용인지 확인 후 필요하면 리빌드
3. `env -u ELECTRON_RUN_AS_NODE npm run dev`로 기동 → **프로젝트 탭**에서 프로젝트를 고르거나
   새로 등록해야 관제실/구조도/강의노트가 보임 (데모 시드에는 "campus-market (demo)" 프로젝트가
   이미 등록돼 있음)
4. 실제 Gemini 캡션이 계속 "생성 중…"이면 일일 쿼터 소진일 수 있음 — `.env` 유무로 Mock/실제 provider
   전환해 원인 구분할 것
5. 위 "아직 안 만든 것"에서 다음 작업 선택
