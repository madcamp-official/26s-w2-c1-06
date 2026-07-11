# Factcoding — 현재 구현 상태 핸드오프 (Day 1~5 완료 시점)

이 문서는 `SPEC.md`/`HANDOFF_B_AI_UI.md`(원래 기획 핸드오프)를 대체하지 않는다.
그 문서들은 "무엇을 만들기로 했는지"를 담고, 이 문서는 **"지금 실제로 뭐가 만들어져 있고 뭐가 없는지"**를 담는다.
새 세션을 시작하는 사람은 이 문서 → 필요하면 `SPEC.md` 순서로 읽을 것.

## 한 줄 요약
Person B(AI 가공 + UI) 담당 범위의 Day 1~5가 구현·검증 완료됨. Person A(관찰 파이프라인)의 실제 코드는
**아직 이 저장소에 존재하지 않음** — 지금 돌아가는 모든 것은 `db/seed.ts`가 채운 목업 데이터 기준.

## 돌아가는 것 (실제로 실행해서 확인함)
- Electron + Vite + React + TS 셸, `npm run dev`로 기동
- SQLite 스키마 초기화(`db/init.ts`) + 목업 시드(`db/seed.ts`): session 1개, prompt 3개, tool_event 8개,
  code_unit 3개(TracePanel/useToolEvents/formatDuration), code_unit_version 5개, code_unit_edge 4개
- 실시간 트레이스 패널: tool_event를 턴(prompt) 단위로 그룹핑해 표시, AI 캡션 병기
- 구조도(React Flow): code_units를 노드, code_unit_edges를 엣지로 렌더. 노드 클릭 시 우측 코드 유닛
  타임라인이 그 유닛의 버전 체인으로 drill-down
- 코드 유닛 타임라인: 버전별 diff(`<details>`로 기본 접힘) + AI 요약 + 개념 태그
- 강의노트 뷰어: `sessions.ended_at`이 채워진(=Stop 감지) 세션을 자동으로 Markdown 강의노트로 합성해 표시
- 난이도 토글(초급/중급/고급, 헤더 고정): 전환 시 `ai_explanations` 캐시를 `(target_type, target_id, skill_level)`
  키로 조회 — 캐시 있으면 API 재호출 없음, 없으면 온디맨드 생성
- `GEMINI_KEY_A`/`GEMINI_KEY_B`가 `.env`에 없으면 `MockAIProvider`로 자동 폴백 (결정론적 가짜 응답,
  네트워크 호출 없음) — 지금 이 저장소엔 아직 실제 키가 없어 **Gemini 실호출은 한 번도 검증 안 됨**

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
  세션 종료를 실제로 감지하는 주체는 Person A의 파이프라인(Stop 훅) — 아직 없으므로 지금은
  `sqlite3 UPDATE sessions SET ended_at=...`로 수동 시뮬레이션해서만 검증함.
- **DB 경로 계산**은 `__dirname`/`import.meta.url`에 의존하면 안 됨 — vite가 번들링하면 엉뚱한 경로를
  가리키게 됨. 스크립트(`db:init`/`db:seed`)는 `process.cwd()` 기준(`db/paths.ts`), Electron main은
  `app.getAppPath()` 기준으로 각자 계산해서 `openDatabase()`/`applySchema()`에 명시적으로 넘김.

## IPC 표면 (전체 목록 — preload가 `window.factcoding`으로 노출)
`getLatestSessionId, getToolEvents, getPrompts, getSkillLevel, setSkillLevel, getExplanations,
getCodeUnits, getUnitVersions, getUnitVersionExplanations, getCodeUnitEdges, getLectureNotes`
새 IPC 추가할 땐 `src/app/main/index.ts`(핸들러) + `src/app/preload/index.ts`(브릿지) 둘 다 고칠 것.

## 알려진 이슈 / 이번에 고친 버그
- (고침) `useSessionTrace`가 세션이 아예 없으면(`sessionId === null`) `loading`을 내려주는 경로가 없어서
  트레이스 패널이 "세션을 불러오는 중…"에 무한 로딩 — 세션 null이면 그 자리에서 loading=false 처리함.
- (고침) React Flow 기본 노드 스타일이 라이트 테마 하드코딩(`inherit` 텍스트색 + 흰 배경)이라 우리 앱
  다크 배경에서 텍스트가 안 보였음 — `<ReactFlow colorMode="system">`으로 해결.
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

## 아직 안 만든 것 (SPEC 6장 기준 Day 6~7)
- Q&A 챗 버튼 (`answerQuestion` — `AIProvider`에 아직 메서드 자체가 없음, 타입부터 추가 필요)
- 온보딩 난이도 질문 흐름, Level 3/4 항목별 "쉽게/자세히" 오버라이드 버튼
- 강의노트 온디맨드 재생성(다른 난이도로 다시 보기) — 지금은 세션당 딱 1회 자동 생성만 됨
- Person A 파이프라인 실통합 (Electron main에 모듈로 임포트), electron-builder 실제 패키징
- 실제 Gemini API 키로 GeminiProvider 종단 검증 (지금까지 전부 MockAIProvider로만 확인)

## 다음 세션이 제일 먼저 할 일
1. `.claude/skills/verify/SKILL.md` 읽기
2. `node_modules/better-sqlite3`가 지금 Node용인지 Electron용인지 확인 후 필요하면 리빌드
3. `env -u ELECTRON_RUN_AS_NODE npm run dev`로 기동 확인
4. 위 "아직 안 만든 것"에서 다음 작업 선택 (보통 Day 6: Q&A + 온보딩)
