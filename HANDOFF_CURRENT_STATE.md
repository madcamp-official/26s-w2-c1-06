# Factcoding — 현재 구현 상태 핸드오프 (Day 1~7 + 파이프라인 통합 완료 시점)

이 문서는 `SPEC.md`/`HANDOFF_B_AI_UI.md`(원래 기획 핸드오프)를 대체하지 않는다.
그 문서들은 "무엇을 만들기로 했는지"를 담고, 이 문서는 **"지금 실제로 뭐가 만들어져 있고 뭐가 없는지"**를 담는다.
새 세션을 시작하는 사람은 이 문서 → 필요하면 `SPEC.md` 순서로 읽을 것.

## 한 줄 요약
Person B(AI 가공 + UI) Day 1~7 전부 + Person A 파이프라인 병합·**런타임 통합**까지 완료.
Electron main이 `startPipeline()`을 모듈로 임포트해 단일 프로세스로 실행하며(SPEC 4.6),
가짜 Claude Code 트랜스크립트로 관찰→AST diff→실제 Gemini 캡션→SessionEnd→강의노트 합성
전체 루프를 E2E 검증함. 실제 Gemini 키(gemini-flash-latest)로 종단 검증 완료.

## 돌아가는 것 (실제로 실행해서 확인함)
- Electron + Vite + React + TS 셸, `npm run dev`로 기동
- SQLite 스키마 초기화(`db/init.ts`) + 목업 시드(`db/seed.ts`): session 1개, prompt 3개, tool_event 8개,
  code_unit 3개(TracePanel/useToolEvents/formatDuration), code_unit_version 5개, code_unit_edge 4개
- 실시간 트레이스 패널: tool_event를 턴(prompt) 단위로 그룹핑해 표시, AI 캡션 병기
- 구조도(React Flow): code_units를 노드, code_unit_edges를 엣지로 렌더. 노드 클릭 시 우측 코드 유닛
  타임라인이 그 유닛의 버전 체인으로 drill-down
- 코드 유닛 타임라인: 버전별 diff(`<details>`로 기본 접힘) + AI 요약 + 개념 태그
- 강의노트 뷰어: `sessions.ended_at`이 채워진(=SessionEnd 훅 또는 "완료" 버튼) 세션을 자동으로
  Markdown 강의노트로 합성해 표시, 세션별로 그룹핑 + 다른 난이도로 온디맨드 재생성 가능
- 난이도 토글(초급/중급/고급, 헤더 고정): 전환 시 `ai_explanations` 캐시를 `(target_type, target_id, skill_level)`
  키로 조회 — 캐시 있으면 API 재호출 없음, 없으면 온디맨드 생성
- `GEMINI_KEY_A`/`GEMINI_KEY_B`가 `.env`에 없으면 `MockAIProvider`로 자동 폴백 (결정론적 가짜 응답,
  네트워크 호출 없음). 실제 키 2개로 실호출 검증 완료 — 단 모델은 `gemini-2.5-flash`가 신규 사용자에게
  404라 **`gemini-flash-latest` alias**를 사용 (GeminiProvider.ts, 특정 버전 고정 금지)
- **파이프라인 런타임 통합 (SPEC 4.6)**: main 프로세스가 `@pipeline/index`의 `startPipeline()`을 직접 실행.
  관찰 대상은 `FACTCODING_PROJECT_PATH` env로 지정(없으면 앱 리포 자체 = 셀프 관찰). 파이프라인은 같은
  DB에 자체 커넥션(WAL이라 안전). Day 6~7 항목(Q&A 챗, 온보딩 모달, 항목별 난이도 오버라이드,
  강의노트 온디맨드 재생성, packaged 모드 userData DB 경로)도 구현·검증 완료.
- **모니터링 시작/완료 버튼 + 세션 목록**: 앱을 켜도 관찰이 자동으로 시작되지 않는다 — 사용자가 여러
  AI 에이전트/비코딩 작업을 오갈 수 있어서, 헤더의 "시작하기"를 눌러야 그 시점부터만 관찰한다
  (`PipelineConfig.startAtEnd: true`로 그 이전 트랜스크립트는 스킵). "완료"를 누르면 관찰을 멈추고
  `pipeline.markSessionEnded()`로 세션을 종료 처리해 강의노트 자동 합성을 트리거한다. 헤더 아래
  `SessionList`가 `sessions` 테이블 전체를 최신순으로 보여주고, 클릭하면 그 세션의 트레이스에
  고정(pin)해서 볼 수 있다(라이브 폴링은 "실시간" 모드에서만 동작). 디버깅용으로 앱 기동과 동시에
  자동 관찰을 켜고 싶으면 `FACTCODING_AUTOSTART_PIPELINE=1`.

## 아키텍처 핵심 결정
- **AIProvider 인터페이스**(`src/ai/types.ts`)로 Gemini/Mock을 교체 가능하게 분리.
  `createAIProvider()`가 키 존재 여부로 자동 선택.
- **GeminiKeyPool은 라운드로빈**(매 호출 키 교대) + 429 시 해당 키 60초 쿨다운 + 폴백.
  한때 "세션당 한 키 고정(sticky)"으로 바꿨다가 다시 라운드로빈으로 되돌림 — 이유: caption-worker가
  틱당 1회 호출로 워스트케이스 12 RPM인데, 무료 티어 한도(10~15 RPM)를 한 키가 단독으로 받으면 넘길 수
  있음. 라운드로빈으로 절반씩(~6 RPM) 나누는 게 실제로 더 안전함. **키 선택 방식은 Gemini 호출의
  "문맥 기억"과 무관** — `generateContent`는 원래 무상태라 어떤 키를 쓰든 대화 히스토리는 매번 프롬프트에
  직접 넣어야 함 (Day 6 Q&A에서 처리할 부분).
- **caption-worker**(`src/app/main/caption-worker.ts`): 5초 틱, 틱당 provider 호출 1회로 제한.
  tool_event 캡션을 우선 처리하고, 밀린 게 없으면 그 틱에 code_unit_version 요약을 처리.
- **lecture-note-worker**(`src/app/main/lecture-note-worker.ts`): 3초 틱마다
  "`ended_at IS NOT NULL`인데 `lecture_notes` 행이 아직 없는 세션"을 찾아 세션 전체를 한 번에 Gemini에
  던져 합성. NULL→NOT NULL 전이를 직접 추적하지 않고 "노트 존재 여부"를 처리 완료 플래그로 씀.
  `ended_at`은 두 경로로 채워질 수 있음: ① Person A 파이프라인의 SessionEnd 훅 감지, ② 헤더 "완료"
  버튼(`pipeline.markSessionEnded()`) — 둘 다 실제 Gemini 호출까지 E2E로 검증 완료.
- **DB 경로 계산**은 `__dirname`/`import.meta.url`에 의존하면 안 됨 — vite가 번들링하면 엉뚱한 경로를
  가리키게 됨. 스크립트(`db:init`/`db:seed`)는 `process.cwd()` 기준(`db/paths.ts`), Electron main은
  `app.getAppPath()` 기준으로 각자 계산해서 `openDatabase()`/`applySchema()`에 명시적으로 넘김.
- **파이프라인 정적 자산도 같은 규칙**: schema.sql/tree-sitter wasm/훅 스크립트 경로는
  `PipelineConfig.assets`(shared/types.ts)로 호출부가 주입. CLI는 `config.ts`의 `loadConfig()`가
  import.meta 기준으로 채우고(→ **config.ts는 CLI 전용, Electron main에서 import 금지**),
  Electron은 main/index.ts가 dev(`app.getAppPath()`)/packaged(`process.resourcesPath`,
  electron-builder.yml extraResources) 분기로 채움. CLI 기본 dbPath도 `db/factcoding.db`로 통일함.
- **훅 커맨드의 실행 바이너리**: hook-installer가 Electron 안에서 돌 때 `process.execPath`를 쓰면
  훅이 불릴 때마다 앱이 통째로 또 켜진다 — `process.versions.electron` 감지 시 PATH의 `node`로 위임.

## IPC 표면 (전체 목록 — preload가 `window.factcoding`으로 노출)
`getLatestSessionId, getToolEvents, getPrompts, getSkillLevel, setSkillLevel, getExplanations,
getCodeUnits, getUnitVersions, getUnitVersionExplanations, getCodeUnitEdges, getLectureNotes,
isOnboardingComplete, completeOnboarding, explainVersionOverride, regenerateLectureNote,
answerQuestion, getSessions, startMonitoring, completeMonitoring, getMonitoringStatus`
새 IPC 추가할 땐 `src/app/main/index.ts`(핸들러) + `src/app/preload/index.ts`(브릿지) 둘 다 고칠 것.

## 알려진 이슈 / 이번에 고친 버그
- (고침) `useSessionTrace`가 세션이 아예 없으면(`sessionId === null`) `loading`을 내려주는 경로가 없어서
  트레이스 패널이 "세션을 불러오는 중…"에 무한 로딩 — 세션 null이면 그 자리에서 loading=false 처리함.
- (고침) React Flow 기본 노드 스타일이 라이트 테마 하드코딩(`inherit` 텍스트색 + 흰 배경)이라 우리 앱
  다크 배경에서 텍스트가 안 보였음 — `<ReactFlow colorMode="system">`으로 해결.
- (고침) `startPipeline()`의 최초 `attachTo()` 호출이 핸들을 반환하기 *전에* 동기적으로
  `session-file-changed`를 emit해서, 호출자(main/index.ts)가 반환된 핸들에 리스너를 붙이기도 전에
  첫 이벤트를 놓치는 레이스가 있었음 — `installHooks`에 이미 있던 것과 정확히 같은 문제인데
  이 호출만 빠져 있었음. `markSessionEnded`로 세션을 종료하려면 이 이벤트로 받은 session id가
  필요한데 계속 null이라 "완료" 버튼이 조용히 아무 효과가 없었던 게 이걸로 발견·수정됨
  (src/pipeline/index.ts, 초기 attachTo도 setImmediate로 미루도록 변경).
- (알아둘 것, 안 고침) `better-sqlite3`는 네이티브 애드온이라 **Node ABI와 Electron ABI가 다르면 로드
  실패**. `npm run db:init`/`db:seed`(순수 tsx/Node)와 `npm run dev`(Electron)를 오갈 때마다:
  - Node용으로: `npm rebuild better-sqlite3`
  - Electron용으로: `npx electron-rebuild -f -w better-sqlite3` (`electron-builder install-app-deps`는
    가끔 조용히 no-op 함 — 안 먹으면 이 명령으로)
  - 지금 저장소 상태의 `node_modules/better-sqlite3`가 어느 쪽으로 빌드돼 있는지 항상 먼저 확인할 것.
- 이 개발 환경(샌드박스) 셸에 `ELECTRON_RUN_AS_NODE=1`이 박혀있어서 Electron 바이너리가 그냥 Node처럼
  동작해버림 — `env -u ELECTRON_RUN_AS_NODE npm run dev`로 실행해야 함. (로컬 개발 환경에는 보통 없는
  변수라 사용자 본인 컴퓨터에서는 문제 안 될 수 있음, 확인 필요.)
- `.claude/skills/verify/SKILL.md`에 위 두 가지(ABI 리빌드, ELECTRON_RUN_AS_NODE)와 스크린샷 방법이
  이미 정리되어 있음 — 실행/검증 전에 그것부터 읽을 것.
- `screencapture` CLI가 이 샌드박스에서 동작 안 함 — UI 확인은 `mainWindow.webContents.capturePage()`를
  임시로 넣어서 PNG로 찍는 방식으로 해왔음 (검증 후 반드시 제거).

## 아직 안 만든 것 / 남은 리스크
- 같은 Claude Code CLI 프로세스(JSONL 파일 하나)를 "완료" 후 다시 "시작하기"로 재개하면, 세션 id가
  JSONL 파일명 그대로라 이미 `ended_at`/`lecture_notes`가 있는 session row를 재사용하게 된다 —
  이 경우 재개 이후 내용은 자동 강의노트 재생성 트리거가 안 걸림(이미 노트가 있어서). 실사용에서는
  "새 작업 = 새 터미널" 흐름이 자연스러워 잘 안 부딪히지만, 같은 터미널에서 시작/완료를 여러 번
  반복하는 워크플로우를 지원하려면 세션 PK를 JSONL 파일 1:1에서 분리하는 스키마 변경이 필요함
  (Person A와 조율 필요 — SPEC.md 4.4).
- 통합 모드 UI 갱신은 아직 renderer 1초 폴링만 사용 — 파이프라인 이벤트 → IPC push(SPEC 4.6 기본)는
  미배선 (폴링 폴백이 이미 동작하므로 데모에는 지장 없음).
- packaged 빌드에서 파이프라인 자산 로드(extraResources) 실검증 안 됨 — dev 모드만 E2E 확인함.
  Windows(nsis) 패키징도 미검증 (mac dmg는 이전에 성공).
- 실제 라이브 Claude Code 세션(수십 MB JSONL)을 관찰할 때의 초기 리플레이 부하/캡션 백로그는 미측정.

## 다음 세션이 제일 먼저 할 일
1. `.claude/skills/verify/SKILL.md` 읽기
2. `node_modules/better-sqlite3`가 지금 Node용인지 Electron용인지 확인 후 필요하면 리빌드
3. `env -u ELECTRON_RUN_AS_NODE npm run dev`로 기동 확인 — 이번엔 자동으로 관찰이 시작되지
   않으니 헤더의 "시작하기"를 눌러야 함 (자동 시작 디버그용: `FACTCODING_AUTOSTART_PIPELINE=1`,
   다른 프로젝트 관찰은 `FACTCODING_PROJECT_PATH`)
4. 위 "아직 안 만든 것"에서 다음 작업 선택
