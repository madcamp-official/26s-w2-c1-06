# Factcoding — Person A 구현 계획 (데이터 파이프라인)

> [HANDOFF_A_PIPELINE.md](./HANDOFF_A_PIPELINE.md), [SPEC.md](./SPEC.md) 4.1/4.2/4.6, [schema.sql](./schema.sql) 최신본(v2) 기준 실행 계획. 스키마 변경은 이 문서가 아니라 `schema.sql`+`SPEC.md` 4.4를 갱신하고 팀원에게 알린다.

## 0. 목표 재확인 (최신 스펙 반영)

- **쓰는 테이블**: `sessions`, `prompts`, `tool_events`, `code_units`, `code_unit_versions`, `code_unit_edges`
- **건드리지 않는 것**: `ai_explanations`, `lecture_notes`, `user_settings`, Electron/React, Gemini 호출
- **완료 기준**: Electron 없이 Node CLI로 독립 검증 가능해야 하지만, **Day 5부터는 Electron main 프로세스가 그대로 `import`해서 쓸 수 있는 라이브러리 형태로 export**되어야 함 (SPEC 4.6) — CLI 전용으로 짜면 안 됨.
- 이전 버전 계획과 달라진 핵심 3가지:
  1. `turn-plan.jsonl` / `UserPromptSubmit` 훅 방식 **폐기** → JSONL 안의 `TodoWrite` tool_use에서 계획 추출 (없으면 턴 첫 assistant 텍스트로 대체)
  2. 온보딩 훅이 `SessionStart`/`SessionEnd`로 변경(HANDOFF/SPEC 원문의 "Stop"은 실제로는 매 턴마다 발생하는 이벤트라 세션 종료 신호로 쓸 수 없음이 Day 3에 확인됨 — 아래 참조) → `.factcoding/session-events.jsonl`에 시작/종료 마커 → `sessions.started_at`/`ended_at` (특히 `ended_at`은 Person B의 강의노트 합성 트리거 신호이므로 정확도가 중요)
  3. `code_unit_edges`는 "현재 상태" 스냅샷 — 파일을 재파싱할 때마다 그 파일 소속 유닛이 `from`인 기존 엣지를 삭제 후 재삽입

---

## 1. 프로젝트 구조

```
/db/schema.sql          (기존 — 그대로 사용, IF NOT EXISTS라 재실행 안전)
/src/shared/types.ts     (공용 타입 — ToolEvent, CodeUnit, CodeUnitVersion, PipelineHandle 등, Person B와 합의)
/src/pipeline/
  index.ts               (★ 라이브러리 진입점 — startPipeline(config): PipelineHandle export. Electron main이 import)
  cli.ts                  (Node 단독 실행용 얇은 wrapper: index.ts의 startPipeline 호출 + 콘솔 로그)
  config.ts               (project_path → JSONL 해시 매핑, DB 경로, PRAGMA 설정)
  db/
    init.ts               (better-sqlite3 로드 + schema.sql 실행 + PRAGMA)
    repo.ts               (sessions/prompts/tool_events/code_units/versions/edges CRUD)
  observation/
    session-locator.ts     (~/.claude/projects/<hash> 탐색)
    jsonl-tail.ts           (byte offset 기반 증분 tail, 세션 JSONL + session-events.jsonl 공용)
    transcript-parser.ts   (user/assistant/tool_use/tool_result 파싱, TodoWrite 감지)
    plan-extractor.ts       (턴별 TodoWrite → plan_text, 없으면 첫 assistant 텍스트 fallback)
    hook-installer.ts       (.claude/settings.json에 SessionStart/SessionEnd 훅 등록)
    session-events-tail.ts  (.factcoding/session-events.jsonl tail → sessions.started_at/ended_at)
    snapshot-cache.ts      (파일별 인메모리 전체 내용 캐시 — 시딩/치환/동기화)
    manual-watch.ts         (chokidar fallback + snapshot-cache 동기화)
  ast-diff/
    parser.ts               (web-tree-sitter 초기화, JS/TS/TSX grammar)
    unit-extractor.ts       (함수/컴포넌트/훅/클래스 노드 추출)
    unit-matcher.ts         (before/after 매칭 → created/modified/deleted)
    edge-extractor.ts       (imports/calls/renders, delete-then-reinsert)
    diff-text.ts            (diff-match-patch 래퍼)
package.json / tsconfig.json
```

**패키지**: `better-sqlite3`, `web-tree-sitter`(+ JS/TS/TSX wasm grammar), `chokidar`, `diff-match-patch`. TS 실행은 `tsx`.

**핵심 구조 원칙**: `index.ts`는 부수효과(콘솔 출력, process.exit 등) 없이 순수하게 `startPipeline(config) → { stop(), on(event, cb) }` 형태의 핸들만 반환해야 Electron main이 그대로 재사용 가능하다. Day 1부터 이 경계를 지키고, `cli.ts`에서만 콘솔 출력을 붙인다.

---

## 2. Day별 실행 계획

### Day 1 — DB 초기화 + Observation 프로토타입

1. `db/init.ts`: better-sqlite3로 DB 파일 오픈 → `PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;` 적용 → `schema.sql` 실행 (`IF NOT EXISTS`라 매번 실행해도 안전).
2. `session-locator.ts`: 현재 프로젝트 cwd → `~/.claude/projects/<hash>` 매핑 규칙을 **로컬에서 실물 디렉토리명을 먼저 열어 확인**한 뒤 구현(추정 금지). 최신 `*.jsonl`을 mtime 기준 선택.
3. `jsonl-tail.ts`: 마지막으로 읽은 byte offset을 유지하며 append된 라인만 파싱. 파일 회전, 아직 flush 안 된 미완성 마지막 줄 방어.
4. `transcript-parser.ts`: 라인의 `type` 필드로 분기 — `user`/`assistant`(`text`/`thinking`/`tool_use` 블록)/`tool_result`. **TodoWrite tool_use를 다른 tool_use와 구분해 별도 콜백으로 노출** (plan-extractor가 Day 3에 사용).
5. Day 1은 **콘솔 출력까지만** (HANDOFF 지시와 동일) — `cli.ts`에서 이벤트를 받아 타입별로 찍는다. DB insert는 아직 없음.

검증: 실제 Claude Code 세션에서 프롬프트/Edit/Bash를 몇 번 실행하며 CLI 콘솔에 빠짐없이 스트리밍되는지 확인.

### Day 2 — DB 적재 + tree-sitter AST Diff Engine

1. Day 1 파서 출력을 실제 테이블에 연결:
   - `user` → `sessions` upsert(최초 1회) + `prompts` insert (`turn_index` 증가, `plan_text`는 잠정 NULL)
   - `assistant`의 tool_use → `tool_events` insert (`status='pending'`, `source='agent'`, `raw_payload`에 원본 JSON)
   - `tool_result` → 매칭되는 `tool_events` 행의 `status`(success/error)와 `duration_ms`(tool_use~tool_result 시간차) UPDATE
2. `snapshot-cache.ts` 구현 (설계 상세는 3장 "스냅샷 캐시" 참조):
   - 세션 관찰 시작 시점 또는 파일이 처음 언급되는 시점(Read/Edit 최초 1회)에 디스크에서 읽어 시딩
   - Edit: 캐시된 before에 `old_string→new_string`을 메모리에서 치환해 after 계산 (디스크 재읽기 없음, `tool_result` 성공 시에만 반영, `replace_all` 처리)
   - Write: payload의 전체 내용을 그대로 캐시. 캐시에 없던 파일(신규 생성)이면 before=빈 문자열 → 모든 유닛이 `created`
3. `ast-diff/parser.ts`: `web-tree-sitter` 초기화 + JS/TS/TSX grammar 로드.
4. `unit-extractor.ts`: `function_declaration`/`arrow_function`(변수 할당)/`class_declaration`/`method_definition` 추출. PascalCase+JSX 반환 → `component`, camelCase+`use` 접두 → `hook`, 나머지 → `function`/`class`.
5. `unit-matcher.ts`: `file_path+unit_name` 키로 before/after 비교 → `created`/`modified`(diff-match-patch로 `diff_text` 생성)/`deleted`/스킵(본문 동일).
6. `code_units` upsert(`first_seen_at`/`last_seen_at` 갱신) + `code_unit_versions` insert (`UNIQUE(unit_id, version_no)` 준수 위해 다음 version_no 계산 후 insert).

검증: 샘플 TS 파일에 함수 추가/수정/삭제를 실제 Edit으로 발생시켜 `code_unit_versions`에 올바른 `version_no` 체인이 쌓이는지 SQL로 확인.

**Day 2 구현 메모 (실제 API 스파이크 결과)**:
- wasm grammar는 `tree-sitter-wasms` npm 패키지 전체(51MB)를 의존성으로 넣지 않고, 필요한 3개 파일(`tree-sitter-javascript.wasm`/`tree-sitter-typescript.wasm`/`tree-sitter-tsx.wasm`)만 `npm pack`으로 받아 `src/pipeline/ast-diff/grammars/`에 직접 벤더링(런타임 의존성 아님, 저장소에 커밋되는 정적 자산).
- `web-tree-sitter@0.24`의 실제 런타임 API(타입 선언과 다소 다름): `const Parser = require('web-tree-sitter')` 자체가 Parser 클래스이고, `Parser.Language`/`Parser.Query`는 `await Parser.init({ locateFile })` 호출 **이후에만** 존재한다. Language 로드는 `await Parser.Language.load(wasmPath)`, 쿼리는 `new Parser.Query(...)`가 아니라 `lang.query(queryString)`으로 생성한다. `Parser.init`의 `locateFile`은 `node_modules/web-tree-sitter/tree-sitter.wasm`(코어 런타임 wasm) 경로를 가리켜야 한다.
- 파일 확장자별 grammar 매핑: `.js`/`.jsx` → javascript grammar(JSX 노드까지 자체 지원 확인됨), `.ts` → typescript grammar(JSX 미지원), `.tsx` → tsx grammar. 세 grammar 인스턴스를 한 번 로드해 재사용(매 파일마다 재로드 금지).

### Day 3 — TodoWrite 계획 추출 + SessionStart/SessionEnd 훅 [완료]

1. `plan-extractor.ts` (`PlanTracker`): 턴 경계(다음 `user` 메시지 전까지) 동안 관찰되는 assistant 블록을 추적.
   - TodoWrite tool_use 발견 시 → 그 내용을 요약해 `prompts.plan_text` UPDATE (이후 같은 턴에서 재등장해도 최신 것으로 덮어씀).
   - 턴이 끝날 때까지 TodoWrite가 한 번도 없었으면 → 해당 턴의 첫 assistant 텍스트 메시지로 대체.
   - 구현: 턴 시작 시 `PlanTracker.startTurn()`으로 상태 리셋 → 첫 assistant 텍스트만 잠정값으로 채택(`considerAssistantText`, 이후 텍스트는 무시) → TodoWrite 발견 시 항상 최종값으로 덮어씀(`considerTodoWrite`, 텍스트보다 늦게 와도 우선).
   - **오픈 이슈 해소**: TodoWrite tool_use의 payload는 실제 JSONL에서 확인한 결과 `input.todos: [{content, status, activeForm}]`이 맞음 (Day 1에서 검증 완료).
2. `hook-installer.ts`: 대상 프로젝트 `.claude/settings.json`에 훅 등록 (기존 훅 배열이 있으면 append, 덮어쓰지 않음, 재호출해도 중복 등록 안 되게 커맨드 문자열로 존재 여부 체크).
   - **⚠️ SPEC/HANDOFF 원문 정정**: SPEC 4.1/4.3.2와 HANDOFF는 "SessionStart/**Stop**" 훅이라고 되어 있으나, 실제로는 틀린 가정이다. Claude Code의 `Stop` 훅은 **세션 전체가 아니라 매 턴(어시스턴트 응답) 종료마다** 발생한다(claude-code-guide 조사로 공식 문서 확인). 이걸 그대로 썼다면 `sessions.ended_at`이 첫 턴이 끝나자마자 채워지고, 이후 매 턴마다 계속 갱신되는 완전히 잘못된 동작이 됐을 것이다. 세션이 실제로 끝나는 시점(정상 종료/Ctrl-C 등, `reason: 'other'` 등)을 잡는 올바른 훅은 **`SessionEnd`**이며, 구현은 이것을 사용한다. **Person B와 SPEC.md 4.1/4.3.2의 "Stop 훅" 표기를 "SessionEnd 훅"으로 정정 공유 필요.**
   - `SessionStart`는 matcher 생략(모든 source), `SessionEnd`는 matcher `""`(모든 reason)로 등록.
   - 두 훅 모두 `session-event-hook.mjs`(순수 JS, TS 빌드 불필요, `node <path>`로 직접 실행)를 호출해 `.factcoding/session-events.jsonl`에 `{type: 'start'|'end', session_id, ts}` 마커를 append.
3. `session-events-tail.ts`: `jsonl-tail.ts`의 `tailFile`을 재사용해 이 파일도 tail. `start` 마커 → `sessions.started_at` 기록(+ 세션 row 없으면 생성), `end` 마커 → `sessions.ended_at` 기록.
   - **정확도 요구사항**: `ended_at`은 Person B가 NULL→NOT NULL 전이를 폴링/IPC로 감지해 강의노트 합성을 트리거하는 신호. `SessionEnd`는 공식 문서상 크래시(kill -9 등) 시 발동을 보장하지 않는 것으로 확인됨 — 정상 종료/Ctrl-C/`/clear`/logout 등은 커버되지만, 프로세스가 강제 종료되는 극단적 경우 `ended_at`이 영영 채워지지 않을 수 있음(알려진 한계로 문서화, MVP에서는 별도 타임아웃/heartbeat 미구현).
4. **수동 종료 트리거 (`PipelineHandle.markSessionEnded(sessionId)`)**: SessionEnd 훅(자동: exit/Ctrl-C/clear/logout)과는 별개로, UI의 "세션/프로젝트 완료" 버튼처럼 **사용자가 명시적으로 끝냈다고 표시**하는 경로가 필요하다는 논의에서 추가. 훅과 똑같이 `sessions.ended_at`을 기록하되, 파일 tail을 거치지 않고 `repo.setSessionEndedAt`을 직접 호출 — Day 5+ Electron 통합 후 Person B가 버튼 클릭 핸들러에서 `pipelineHandle.markSessionEnded(sessionId)`를 바로 부르면 된다. **주의**: "세션"(Claude Code 대화 하나)과 "프로젝트"(여러 세션에 걸칠 수 있는 상위 개념)가 다를 수 있다는 점은 Person B와 조율이 필요 — 지금 스키마는 `ended_at`이 세션 1개당 1개이므로, "프로젝트 완료" 버튼이 여러 세션을 묶는 의미라면 별도 개념/테이블이 필요할 수 있음(MVP 범위 밖, 열린 질문으로 남김).

검증: 격리된 스크래치 프로젝트 디렉토리에 대해 (1) `installHooks` 2회 호출로 멱등성(중복 등록 없음) 확인, (2) 등록된 커맨드 문자열을 실제 셸에서 시뮬레이션된 SessionStart/SessionEnd payload로 직접 실행해 `session-events.jsonl`에 정확히 append되는지 확인, (3) `tailSessionEvents`가 그 파일을 읽어 `sessions.started_at`/`ended_at`을 정확히 기록하는지 확인, (4) `markSessionEnded(sessionId)`를 직접 호출해 훅 없이도 `ended_at`이 즉시 기록되는지 확인. 실제 Claude Code 세션을 재시작하는 것은 이 환경(서브에이전트/CLI 세션)에서 불가능해 시뮬레이션으로 검증했다 — 실사용 시 실제 세션 시작/종료로 한 번 더 확인 필요. `plan_text`는 이 세션 자체를 리플레이해 TodoWrite 있는 턴(최신 계획 텍스트)과 없는 턴(첫 assistant 텍스트) 모두 정확히 채워지는 것을 확인.

### Day 4 — Edge 추출 + manual fallback + 엣지 케이스 + 스키마 최종 고정 [완료]

1. `edge-extractor.ts`: 유닛별 subtree를 순회해 call/JSX/일반 참조를 수집하고, import된 이름(상대경로만 해석) 또는 같은 파일 내 다른 유닛 이름과 매칭되면 엣지 후보로 만든다.
   - 분류 우선순위: JSX 태그로 쓰이면 `renders`, 함수 호출 콜리(callee)면 `calls`, 그 외 단순 참조면 `imports`.
   - **"현재 상태" 스냅샷 규칙**: 파일을 재파싱할 때마다, 그 파일에 속한 유닛이 `from_unit_id`인 기존 `code_unit_edges`를 **전부 DELETE 후 새로 추출한 것을 INSERT** (한 트랜잭션으로 묶어 중간 상태 노출 방지).
   - `to_unit_id`는 워크스페이스 내에서 경로 해석이 가능한 경우만 기록 (상대경로 import만 지원, 외부 패키지/tsconfig paths는 MVP에서 스킵). `class_declaration`의 name 필드가 grammar마다 다르다는 Day 2 교훈처럼, import/call/jsx 노드 구조도 실제 wasm grammar로 스파이크 검증 후 구현(3종 grammar 모두 `call_expression function: (identifier)`, `jsx_opening_element name: (identifier)` 동일 — Day 2와 달리 이번엔 언어별 분기가 필요 없었음).
   - **알려진 한계**: 이름 기반 매칭이라 스코프/섀도잉 구분 불가(지역변수가 우연히 import/다른 유닛과 같은 이름이면 오탐 가능). `obj.method()`처럼 멤버 표현식 호출은 대상 특정이 안 돼 스킵.
   - **실제 발견한 버그 — 크로스 파일 엣지 해석 순서 레이스**: A 파일이 B 파일의 함수를 import해서 부르는 상태에서, A에 짧은 시간 안에 연속 Edit이 여러 번 일어나면(디바운스 타이머가 계속 리셋됨) A의 flush가 예상보다 늦어질 수 있고, 이때 B의 flush가 먼저 끝나 A→B 엣지를 만들려 할 때 B의 `code_unit`이 아직 DB에 없어 `findUnitId`가 실패 → 엣지가 조용히 스킵된다(실제 재현 확인). 파일 간 flush 순서를 보장하지 않는 현재 구조의 근본적 한계 — 일반적인 사용 패턴(파일을 순차적으로 만들고 편집)에서는 드물지만, 완전히 고치려면 "미해석 엣지 재시도" 메커니즘(새 code_unit이 생길 때마다 대기 중인 엣지를 재확인)이 필요함. MVP에서는 알려진 한계로 남기고 Day 5+로 이연.
2. `manual-watch.ts`: chokidar로 워크스페이스 감시(`node_modules`/`.git`/`.factcoding`/DB 파일 등 제외). 변경 감지 시:
   - 직전 2초 이내 동일 파일에 대한 `agent` 소스 Edit/Write가 있었으면 무시(에이전트 자신의 디스크 변화를 수동 수정으로 중복 기록 방지).
   - 없으면 `tool_events.source='manual', tool_name='ManualEdit'`로 insert(즉시 success 처리, turn에 속하지 않으므로 `prompt_id=NULL`) 후 동일 AST diff 파이프라인(디바운스 포함) 실행.
   - 이 변경 후 반드시 `snapshot-cache.syncFromDisk`로 캐시를 갱신 — 다음 에이전트 Edit의 before가 어긋나지 않도록.
   - **실제 발견한 버그 — chokidar truncate 레이스**: 셸 리다이렉션(`>`)이나 일부 에디터는 파일을 먼저 0바이트로 truncate한 뒤 내용을 쓰는데, 이 순간 chokidar가 `change` 이벤트를 곧바로 쏘면 `syncFromDisk`가 일시적으로 빈 파일을 읽어버려 "파일 안의 모든 함수가 삭제됨(deleted)"으로 완전히 잘못 diff되는 것을 실제로 재현·확인함. `chokidar.watch`에 `awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 }`를 추가해 파일 크기가 안정될 때까지 이벤트 발생을 늦춰서 해결.
3. 엣지 케이스:
   - 여러 파일 동시 수정 → 파일별 독립 캐시 키 + 독립 디바운스 타이머로 처리(위 "크로스 파일 엣지 해석 순서" 한계와 연결됨).
   - 빠른 연속 Edit → `tool_events`는 매번 개별 기록하되, AST diff는 파일별 500ms 디바운스(`scheduleAstDiff`/`flushPendingDiff`) 후 "burst 시작 시점의 before" vs "flush 시점의 최신 after" 1회만 비교해 의미 없는 중간 버전 난립 방지. 캐시 자체의 순차 치환(`snapshotCache.applyEdit`)은 디바운스 없이 매 Edit마다 즉시 동기 적용(정확성 유지) — 디바운스는 오직 "언제 tree-sitter로 다시 파싱할지"만 늦춘다. `pipeline.stop()` 시 대기 중인 디바운스 타이머는 완료를 기다리지 않고 취소(알려진 한계: 종료 직전 500ms 이내의 마지막 배치 하나는 유실 가능).
4. Person B와 `src/shared/types.ts`, 스키마 최종 고정 — 이 시점 이후 스키마 변경은 최소화. (스키마 자체는 Day 4에서 변경 없음 — `code_unit_edges`는 이미 v2 스키마에 있던 테이블을 채운 것뿐)

검증: 실제 Write/Edit로 파일 2~3개짜리 import/call/render 관계망(함수→함수 호출, 훅이 컴포넌트 렌더)을 만들어 `code_unit_edges`가 정확히 채워지는지 확인. 한 파일에 연속 Edit 3회를 몰아넣어 디바운스가 중간 버전 없이 최종 상태 1회로 수렴하는지 확인(관련해 "크로스 파일 엣지 해석 순서" 버그를 실제로 발견·문서화, 위 참조). `cat > file` 셸 리다이렉션으로 Edit/Write 도구를 거치지 않은 수동 수정을 발생시켜 `tool_events.source='manual'`로 잡히고 AST diff가 정확히(엉뚱하게 "deleted"로 나오지 않고) 반영되는지 확인(chokidar truncate 레이스를 실제로 발견·수정, 위 참조).

### Day 5-7 — Electron 통합 + end-to-end 검증

1. `src/pipeline/index.ts`의 `startPipeline(config): PipelineHandle`을 Electron main 프로세스에서 그대로 `import`해 단일 프로세스로 실행 (SPEC 4.6 — SQLite 동시 쓰기 문제 원천 차단).
   - **Person B와 합의 완료 (4장 오픈 이슈 4 참조)**: UI 갱신은 **폴링**(Person B가 SQLite를 주기적으로 직접 재조회)으로 확정 — `tool_event`/`code_unit_version` 등 세분화된 push 이벤트는 추가하지 않는다. `PipelineHandle`은 지금 형태(`stop()`, `on('transcript-event'|'session-file-changed'|'error')`, `markSessionEnded(sessionId)`) 그대로 사용 가능, 추가 확장 불필요.
   - `config.dbPath`/`config.projectPath`는 Person B(Electron main)가 결정해 주입, 파이프라인은 그대로 사용.
   - Electron main은 사용자가 프로젝트 폴더를 선택/확정한 직후에 `startPipeline()`을 호출(앱 실행 즉시가 아님), 프로젝트 전환 시 기존 핸들을 `stop()`하고 재시작.
2. standalone CLI 모드(`cli.ts`)는 디버깅용으로 계속 유지.
3. **실제 세션으로 end-to-end 리허설 [완료 — 진짜 `claude` CLI 세션으로 검증]**: 이 서브에이전트 환경엔 `claude` CLI가 없어 초반엔 이 대화 자체의 반복 리플레이 + 훅 시뮬레이션으로만 검증했으나, 사용자가 실제 로컬 터미널에 `npm install -g @anthropic-ai/claude-code`로 CLI를 설치하고 별도의 임시 프로젝트(`factcoding-e2e-test`)에서 **진짜 새 세션**(`claude` 실행 → 프롬프트 2회 → Write+Edit → `/exit`)을 띄워 파이프라인이 실시간으로 관찰하는 것까지 전부 실제로 재현·확인함.
   - `sessions.started_at`/`ended_at`이 진짜 SessionStart/SessionEnd 훅으로 정확히 기록됨(시뮬레이션이 아니라 최초의 완전 실측 확인).
   - TodoWrite 없이 진행된 짧은 세션이라 `plan_text`가 설계대로 "턴의 첫 assistant 텍스트"로 정확히 폴백됨.
   - Write(`add` 생성) → Edit(`add`→`sum` 이름 변경)이 `code_unit_versions`에 `add: created→deleted`, `sum: created`로 잡힘 — 이는 버그가 아니라 SPEC에 명시된 대로 "리네임 매칭은 MVP 미구현, created+deleted 페어로 남김"이 정확히 재현된 것.
   - 수동 수정(manual-watch) 케이스는 이번 리허설엔 포함 안 함 — Day 4에서 별도로 이미 실증 완료(위 참조).
4. **버그 픽스, 각 tail 루프에 try/catch로 프로세스가 죽지 않도록 방어 [완료 — Electron 없이도 가능한 부분]**:
   - `jsonl-tail.ts`의 `tailFile`: 한 줄을 처리하는 `onLine` 콜백(그 안에서 emit되는 `transcript-event` 리스너, `handleTranscriptEvent` 시작 부분까지 포함)을 try/catch로 감싸 예외를 `onError` 콜백으로 넘김. 감싸지 않으면 한 줄의 파싱 오류나 리스너 버그가 그 tailer 전체를 조용히 멈춰 세운다(세션 transcript와 `session-events.jsonl` 둘 다 이 함수를 공유하므로 한 곳만 고치면 양쪽 다 방어됨).
   - `manual-watch.ts`: `onManualEdit` 콜백(DB insert 등)을 try/catch로 감싸고, chokidar 자체의 `'error'` 이벤트에도 리스너를 등록(리스너 없는 `'error'` 이벤트는 Node가 그대로 throw해 프로세스를 죽인다는 사실을 실제로 확인 후 반영).
   - `session-events-tail.ts`: `onError`를 인자로 받아 내부 `tailFile` 호출에 그대로 전달.
   - `index.ts`: 위 세 곳(`tailFile`/`tailSessionEvents`/`watchManualEdits`) 전부 `(err) => emitter.emit('error', err)`로 연결해 `PipelineHandle.on('error', ...)`로 일관되게 수신 가능. `checkForNewerSession`(setInterval 콜백)도 try/catch로 감쌈 — 안 그러면 디렉토리 스캔 중 예외 하나로 세션 전환 감지 자체가 영구히 멈출 수 있음.
   - **검증**: 격리된 스크립트로 (1) `tailFile`에 일부러 예외를 던지는 줄을 흘려보내 그 줄만 스킵되고 이후 줄은 계속 처리되는지, (2) `watchManualEdits`의 콜백이 특정 파일에서 예외를 던져도 워처가 죽지 않고 다른 파일 변경은 계속 감지하는지 각각 실제로 재현해 확인함.

---

## 3. 핵심 설계 결정 메모

| 항목 | 결정 | 근거 |
|---|---|---|
| ID 생성 | `crypto.randomUUID()`(세션/prompt), tool_use id 그대로(`tool_events.id`), `sha1(file_path+unit_name)`(code_units) | schema.sql 주석과 일치 |
| plan_text 수집 | 훅이 아니라 JSONL의 TodoWrite tool_use 추출, 없으면 턴 첫 assistant 텍스트 | SPEC 4.1 — UserPromptSubmit은 계획 생성 이전 시점이라 사용 불가 |
| 세션 시작/종료 | SessionStart/**SessionEnd**(Stop 아님 — Day 3 정정) 훅 → `.factcoding/session-events.jsonl` → tail | `ended_at`이 Person B의 강의노트 합성 트리거 신호 (SPEC 4.1, 4.3.2 정정 필요) |
| tree-sitter grammar | JS/TS/TSX 3종만 | MVP 범위, SPEC 7 리스크 대응 |
| edges 갱신 방식 | 파일 재파싱마다 해당 파일 소속 from 엣지 전체 delete-then-reinsert | SPEC 4.2 — "현재 상태" 스냅샷이므로 stale 엣지 방지 |
| AST diff 배칭/디바운스 | tool_events 기록은 즉시, AST 파싱만 파일 단위로 디바운스 | 실시간 트레이스(Level 2)는 즉시 필요, AST 요약은 약간 지연 허용 |
| DB 동시성 | WAL + busy_timeout=5000 + foreign_keys=ON (schema.sql 명시) | 파이프라인/Electron 동시 접근 대비 |
| 프로세스 모델 | Day 1-4는 standalone CLI, Day 5+는 Electron main에 모듈로 임포트(단일 프로세스) | SPEC 4.6 — SQLite 동시 쓰기 문제 원천 차단 |
| UI 갱신 방식 | 폴링 확정(Person B가 SQLite 주기적 재조회), `tool_event`/`code_unit_version` 등 세분화된 push 이벤트 미사용 | Person B와 합의 완료(4장 오픈 이슈 4) — `PipelineHandle` 확장 불필요 |

### 스냅샷 캐시 (before/after 확보, 레이스 컨디션 방지) — SPEC 4.2 공식 반영

파이프라인은 에이전트를 직접 구동하지 않는 옵저버이므로 "tool_use를 본 시점"과 "디스크에 실제로 쓰인 시점"의 순서를 보장할 수 없다. 디스크 재읽기 대신 인메모리 치환으로 이 레이스를 원천 제거한다.

1. **시딩**: 세션 관찰 시작 시점, 또는 파일이 처음 언급되는 시점(Read 최초 1회)에 디스크에서 1회 읽어 캐시. Claude Code는 Read 없이 Edit을 허용하지 않으므로 실제로는 거의 항상 Read가 선행한다.
2. **Edit 처리**: 캐시된 before에 `old_string→new_string`을 메모리에서 치환해 after 계산. `tool_result` 성공 시에만 반영, `replace_all` 플래그 처리, 같은 turn 내 동일 파일 다중 Edit은 JSONL 순서대로 순차 적용(병렬 금지).
3. **Write 처리**: payload의 전체 내용을 그대로 캐시. 캐시에 항목이 없던 파일(신규 생성)은 before=빈 문자열로 처리 → 모든 유닛이 `created`로 기록됨 (SPEC 4.2에 명시된 동작).
4. **manual-watch 동기화**: chokidar가 잡은 수동 수정은 반드시 캐시를 갱신해야, 다음 에이전트 Edit의 before가 정확하다.
5. **캐시 미스 폴백은 Edit 전용, Write에는 절대 적용 금지**: 프로세스 재시작 직후처럼 캐시가 비어있는 예외 상황에서 **Edit**은 디스크를 1회 읽어 시딩(콜드 스타트라 레이스 위험 낮음). 반면 **Write**는 캐시 미스 자체가 "신규 생성"이라는 정상 신호(3번 항목)이므로 여기서 디스크를 읽으면 안 된다 — 특히 세션 히스토리를 처음부터 리플레이하는 구조에서는 디스크가 "그 시점"이 아니라 "지금(리플레이 시점)의 최종 상태"를 반영하므로, 과거의 Write를 최종 상태와 비교하는 완전히 틀린 diff가 나온다(Day 2 실제 재현·수정된 버그).
6. **알려진 갭**: 에이전트가 Bash(`sed -i` 등)로 파일을 바꾸면 Edit/Write 이벤트 자체가 없어 이 메커니즘 밖 — SPEC 범위(Edit/Write만 AST diff 대상)와 일치하는 한계로 문서화만 하고 MVP에서 처리하지 않는다.

### 전체 코드 리뷰(code-review 스킬, high effort)에서 발견·수정한 치명적 버그 3건

Day 1~4 전체 구현을 8개 관점(정확성 3, 재사용/단순화/효율/설계고도 4, 컨벤션 1—CLAUDE.md 없어 스킵)으로 병렬 리뷰한 결과 총 10건 발견, 그중 아래 3건은 실제 데이터 유실/오염으로 이어지는 치명적 버그라 즉시 수정함(나머지 7건은 심각도가 낮거나 손보는 비용이 커서 알려진 한계로 남김):

1. **`index.ts` — 안 건드린 유닛을 참조하는 edge insert가 FOREIGN KEY 위반으로 트랜잭션 전체를 롤백시킴**: 파일에 함수가 여러 개 있는데 그중 하나만 수정하면, 나머지 안 건드린 함수들이 `code_units`에 아직 없는 상태에서 edge의 from/to로 참조될 수 있다. `INSERT OR IGNORE`는 FOREIGN KEY 위반을 흡수하지 못한다는 걸 better-sqlite3로 직접 실험해 확인(→ 그대로 throw). 트랜잭션이 롤백되면서 방금 만든 정상적인 `code_unit_versions` 기록까지 함께 사라지는 실제 데이터 유실 버그였다. **수정**: `changes`(변경분)만이 아니라 `beforeUnits ∪ afterUnits`(이 파일에 현재/직전 존재했던 모든 유닛) 전체를 버전/엣지 처리보다 먼저 upsert하도록 변경.
2. **`snapshot-cache.ts` — `String.prototype.replace(문자열, 문자열)`이 교체 문자열 안의 `$&`/`$$`/`` $` `` 특수 패턴을 그대로 해석**: Edit의 새 코드에 리터럴 `$$`(쉘 PID 등)나 `$&`가 들어있으면 실제 디스크 파일과 캐시가 서로 다르게 저장되어 이후 모든 diff가 어긋난다. **수정**: `indexOf`+슬라이싱 기반의 순수 문자열 치환으로 교체(특수 패턴 해석 없음).
3. **`edge-extractor.ts` — NodeNext 스타일(`.js`로 끝나지만 실제로는 `.ts` 소스를 가리키는) relative import를 전혀 해석 못함**: 이 저장소 자체의 import 스타일(`from './foo.js'`)이 정확히 이 패턴이라, 이 코드베이스를 스스로 관찰하면 imports/calls 엣지가 사실상 하나도 안 잡히는 상태였다. **수정**: `.js`/`.jsx`/`.mjs`/`.cjs`로 끝나는 specifier는 그 확장자를 뗀 버전도 후보 경로로 추가 탐색.

3건 모두 격리된 스크립트로 재현·수정 확인 완료(타입체크 통과 포함).

---

## 4. 오픈 이슈 (Day 1~3 착수 시 우선 확인)

1. **`~/.claude/projects/` 해시 규칙**: 로컬 환경에서 실물 디렉토리명을 먼저 열어 확인하고 매핑 로직 구현 (Day 1 최우선).
2. **TodoWrite tool_use의 실제 payload 구조**: 필드명(`input.todos` 등)을 실제 JSONL 샘플에서 확인 후 `plan-extractor.ts` 파싱 로직 확정 (Day 1~3).
3. **`code_unit_edges`의 import 경로 해석 범위 — 해결**: 상대경로 import만 지원(`.ts`/`.tsx`/`.js`/`.jsx`/`index.*` 후보 순차 탐색), tsconfig `paths` 별칭이나 배럴 파일 re-export는 MVP에서 스킵하기로 확정. 추가로 Day 4 실측 검증 중 "크로스 파일 엣지 해석 순서 레이스"(2장 Day 4 참조)와 chokidar truncate 레이스 2건을 실제 버그로 발견·수정함.
4. **`PipelineHandle` 인터페이스 — Person B와 합의 완료**:
   - **UI 갱신 방식**: 폴링으로 확정 (1초 간격 등으로 Person B가 SQLite를 직접 재조회). Push용 이벤트(`tool_event`/`code_unit_version` 등 세분화된 emit)는 **불필요** — 그 결과 "push payload 모양을 어떻게 설계할지"였던 하위 질문도 자동으로 소멸. 현재 `PipelineHandle`의 `on('transcript-event')`는 CLI 콘솔 디버깅용으로만 유지, Electron 통합에는 필수 아님.
   - **DB 파일 경로**: Person B가 결정해 `config.dbPath`로 주입 (OS별 앱 데이터 폴더 등 실제 경로 산정은 Electron main 쪽 책임). 파이프라인은 이미 `PipelineConfig.dbPath`를 외부 값으로만 받는 구조라 코드 변경 불필요.
   - **세션 vs 프로젝트**: 세션 단위로 확정, 별도의 "프로젝트" 개념 불필요. `markSessionEnded(sessionId)`를 그대로 완료 버튼 핸들러에 연결하면 됨.
   - **파이프라인 시작 시점**: 사용자가 관찰할 프로젝트 폴더를 선택/확정한 직후 `startPipeline(config)` 호출(앱 실행 즉시가 아님 — 그 전엔 `projectPath`가 없음). 프로젝트를 바꾸면 기존 핸들을 `stop()`하고 새 `config`로 다시 `startPipeline()`.
   - **에러 UX**: 대부분 복구 가능한 에러(훅 설치 실패, 일시적 tail 오류 등)라 화면을 막는 모달보다 콘솔 로그 + 가벼운 상태 표시를 권장(최종 UI 결정은 Person B 몫).
   - **종료 시 유실 허용 범위**: `stop()`은 대기 중인 디바운스를 완료까지 기다리지 않고 취소한다는 현재 동작을 MVP 기본값으로 유지 — 앱 종료 직전 500ms 이내의 마지막 Edit 배치 하나가 유실될 수 있음(3장 "AST diff 배칭/디바운스" 참조). 완벽한 flush-on-exit은 비용 대비 효과가 낮아 보류.

---

## 5. Definition of Done 체크리스트 (HANDOFF 최신본 기준)

- [x] JSONL tail이 프롬프트/tool_use/tool_result를 빠짐없이 파싱해 각 테이블에 저장 (`tool_events.status`/`duration_ms` 포함)
- [x] 파일 스냅샷 캐시가 세션 시작/파일 최초 언급 시 정확히 시딩되고, Edit은 디스크 재읽기 없이 메모리 치환으로, manual 수정은 chokidar(awaitWriteFinish 적용) 트리거로 동기화됨
- [x] Edit/Write 발생 시 AST diff가 실행되어 `code_units`/`code_unit_versions`가 정확히 생성 (created/modified/deleted 판별 포함)
- [x] `code_unit_edges`에 imports/calls/renders가 최소 JS/TS/JSX 기준으로 채워짐 (파일 재파싱 시 from 기준 삭제 후 재삽입) — 크로스 파일 해석 순서 레이스는 알려진 한계로 문서화
- [x] TodoWrite 기반 계획 추출이 `prompts.plan_text`로 연결됨
- [x] SessionStart/SessionEnd 훅이 자동 설치되고 `sessions.started_at`/`ended_at`이 정확히 기록됨 (SPEC 원문 "Stop"은 매 턴마다 발생하는 이벤트라 세션 종료 신호로 부적합함을 확인, SessionEnd로 대체)
- [ ] 위 전체가 Electron 없이 Node 스크립트만으로 재현·검증 가능 (완료 — 실제 `claude` CLI 신규 세션으로도 실측 확인) + Electron main에서 모듈로 임포트해 실제로 동작 확인 (Person B의 Electron 앱이 아직 없어 Day 5 전엔 검증 불가 — `PipelineHandle` 인터페이스 자체는 4장 오픈 이슈 4에서 Person B와 합의 완료, 코드 추가 준비는 끝난 상태)
