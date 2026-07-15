# Factcoding 기술 명세서

버전: v0.1 (기획 확정 단계)
전제 조건: **무료 API만 사용** (Gemini free tier 중심), **AST 기반 코드 단위 diffing** 적용

---

## 1. 개요

### 1.1 목적
Vibecoding(AI 코딩 에이전트를 활용한 개발) 중 에이전트의 작업 과정을 실시간으로 관찰·해설하고, 세션 종료 후에는 복습 가능한 형태(강의노트, 구조도)로 문서화하는 학습용 데스크톱 플랫폼.

### 1.2 핵심 설계 원칙
- **비용 제로**: 관찰 레이어는 API 호출 없이 동작. AI 가공 레이어만 무료 티어(Gemini) 사용.
- **결정론적 구조화 우선**: 구조도/관계도 가능한 한 AST 파싱으로 결정론적으로 뽑고, LLM은 "설명"에만 사용 (Rate limit 제약 + 정확도 확보).
- **1차 타겟 에이전트: Claude Code**. 세션 로그(JSONL)가 이미 구조화되어 있어 별도 wrapper 없이 관찰 가능. 타 에이전트 지원은 로드맵으로 분리.

### 1.3 대상 플랫폼
Windows, macOS 데스크톱 앱 (Electron)

---

## 2. 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                     Factcoding Desktop App (Electron)         │
│                                                                 │
│  ┌───────────────┐   ┌──────────────────┐   ┌──────────────┐ │
│  │ Observation   │──▶│ AST Diff Engine  │──▶│ SQLite Store │ │
│  │ Layer         │   │ (tree-sitter)    │   │              │ │
│  │ (JSONL tail)  │   └──────────────────┘   └──────┬───────┘ │
│  └───────────────┘                                  │         │
│         │                                            │         │
│         ▼                                            ▼         │
│  ┌───────────────┐                          ┌──────────────┐  │
│  │ AI Processing │──────────────────────────│ React UI     │  │
│  │ Layer         │  (배치된 이벤트/질의)      │ (실시간 트레이스,│ │
│  │ Gemini Key A/B│──────────────────────────▶│  타임라인,구조도)│ │
│  └───────────────┘   (해설/강의노트/답변)     └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
         ▲
         │ 읽기 전용 tail
┌────────┴─────────┐
│ ~/.claude/projects/<hash>/*.jsonl   (사용자가 이미 실행 중인 Claude Code 세션) │
└───────────────────┘
```

---

## 3. 기술 스택

| 레이어 | 선택 | 비고 |
|---|---|---|
| 데스크톱 셸 | Electron + Vite | Win/Mac 빌드, electron-builder로 패키징 |
| UI | React + TypeScript | 타임라인/트레이스/구조도 뷰 |
| 구조도 렌더링 | React Flow | code_unit_edges → 그래프 노드/엣지로 직결 |
| 마크다운 렌더 | react-markdown + shiki | 강의노트, 코드 스니펫 하이라이트 |
| 파일 관찰 | Node `fs.watch`/`readline` (JSONL tail) + chokidar(보조) | 아래 4.1 참조 |
| AST 파싱 | tree-sitter (`web-tree-sitter`) | 언어별 grammar 교체로 확장 가능 |
| 로컬 저장소 | SQLite (`better-sqlite3`) | 임베드 불필요, 오프라인 |
| AI 파운데이션 | Gemini 2.5 Flash (Google AI Studio, 무료) | 실시간 해설/강의노트/Q&A |
| AI 키 풀 | Gemini API Key A + Key B (서로 다른 Google 계정) | Key A 429 시 Key B로 전환, 사실상 RPM 예산 2배 |
| 임베딩(선택) | Gemini `text-embedding-004` | 장기기억 검색용, MVP 이후 |

---

## 4. 컴포넌트 상세 설계

### 4.1 관찰 레이어 (Observation Layer)

**데이터 소스**: `~/.claude/projects/<project-hash>/*.jsonl`
Claude Code가 세션마다 자동 기록하는 트랜스크립트. 각 라인은 JSON 객체이며 `user` 메시지, `assistant` 메시지(텍스트/thinking/tool_use), `tool_result`가 순서대로 기록됨.

**동작 방식**:
1. 앱 시작 시 현재 프로젝트에 대응하는 최신 JSONL 파일을 탐색 (프로젝트 경로 → 해시 규칙 매핑).
2. 파일을 append-only로 가정하고 `fs.watch` + 마지막으로 읽은 byte offset을 저장해 증분 tail (신규 로그 라인만 파싱).
3. 파싱된 이벤트를 타입별로 분기:
   - `user` (prompt) → `prompts` 테이블에 저장
   - `assistant` + `tool_use` (Edit/Write/Bash 등) → `tool_events` 테이블에 저장, **Edit/Write는 4.2 AST Diff Engine으로 전달**
   - `tool_result` → 해당 tool_use와 매칭해 `tool_events.status`(success/error)와 `duration_ms` 갱신
4. **비용**: 0 (API 호출 없음, 파일 읽기만).

**턴 계획(plan) 추적**:
"이번 턴 계획"은 파일로 명시적으로 저장되지 않는다 → `UserPromptSubmit` 훅은 사용자가 프롬프트를 제출하는 시각 실행되므로 사용자 입력만 잡을 수 있고, 계획은 그 이후 에이전트가 만들기 때문. 대신 **JSONL 트랜스크립트에 이미 기록되는 에이전트의 TodoWrite(계획 수립) tool_use를 tail에서 추출**해 `prompts.plan_text`로 저장한다. TodoWrite가 없는 단순 턴은 해당 턴 첫 assistant 텍스트 메시지를 계획 요약으로 대체. 별도 파일·훅 불필요.

**온보딩 자동화** (특이사항 대응):
- 최초 실행 시 앱이 대상 프로젝트의 `.claude/settings.json`에 훅 등록 (사용자가 수동 설정할 필요 없음).
- 두 훅은 `.factcoding/session-events.jsonl`에 세션 시작/종료 마커를 append → 동일한 tail 메커니즘으로 관찰해 `sessions.started_at`/`ended_at`을 확정적으로 기록. (`ended_at`은 4.3.2 강의노트 합성의 트리거가 된다.)

**fallback**: Claude Code 세션이 없는 상태 파일 수정(사용자가 직접 고칠 경우)은 chokidar로 워크스페이스를 감시해 `tool_events`에 `source: manual`로 별도 기록.

---

### 4.2 AST Diff Engine

**트리거**: 관찰 레이어에서 전달된 `Edit`/`Write` tool_use + 이후 `tool_result`.

**파일 스냅샷 캐시 (before/after 확보 방법)**:
Claude Code의 Edit 로그에는 변경 조각(`old_string`/`new_string`)만 남고 파일 전체 내용은 담지 않는다. AST diff는 파일 전체를 파싱해야 하므로, 파이프라인이 경로별로 **파일 전체 내용을 인메모리 스냅샷**으로 직접 유지한다.

- **적재**: 세션 관찰이 시작하는 시점, 또는 어떤 파일이 처음 언급되는 시점(Read/Edit/Write 최초 1회)에 디스크에서 읽어 캐시에 채운다. 에이전트가 아직 쓰기 전이므로 이 읽기에는 레이스 컨디션이 없다.
- **Edit 처리**: 디스크를 다시 읽지 않고, 캐시된 before 문자열의 `old_string → new_string` 치환을 **메모리에서 직접 적용**해 after를 계산하고 캐시를 갱신한다. (Claude Code의 실제 Edit 툴은 `old_string`이 파일 내에서 유일하게 일치해야 성공하므로, 캐시가 정확하면 이 치환 결과는 디스크 상태와 항상 일치한다.) tool_use 시점과 실제 디스크 쓰기 시점 사이의 타이밍에 의존하지 않아 안전하다.
- **Write 처리**: tool_use 페이로드에 이미 전체 내용이 들어있으므로 그대로 after로 캐시. 디스크 읽기 불필요. 신규 파일 생성(캐시에 항목 없음)이면 before를 빈 문자열로 처리 → 모든 유닛이 `created`로 기록됨.
- **수동 수정 동기화**: chokidar가 잡은 manual 변경(4.1 fallback)도 반드시 이 캐시를 갱신해야 한다. 그렇지 않으면 다음 에이전트 Edit이 낡은 before를 기준으로 diff를 계산하게 된다.

**처리 흐름**:
1. 위 캐시에서 얻은 **before**(수정 전 전체 내용) / **after**(수정 후 전체 내용) 두 버전을 각각 tree-sitter로 파싱.
2. 쿼리로 최상위 선언 노드 추출: `function_declaration`, `arrow_function`(변수 할당), `class_declaration`, `method_definition`.
   - React 컴포넌트 휴리스틱: 이름이 PascalCase + 반환값에 JSX 포함 → `unit_type = component`, 그 외 camelCase + `use`로 시작 → `hook`, 나머지 → `function`/`class`.
3. before/after 유닛 집합을 이름 기준(`file_path + unit_name`)으로 매칭:
   - after에만 존재 → `created`
   - before에만 존재 → `deleted`
   - 둘 다 존재하고 본문 토큰 다름 → `modified` (텍스트 diff는 `diff-match-patch`로 생성해 저장)
   - 둘 다 존재하고 본문 동일 → 스킵 (포맷팅 등 무변경)
4. 같은 쿼리 패스에서 관계도 함께 추출해 `code_unit_edges`에 기록:
   - `import` 문 → `imports` 엣지
   - 함수 본문 내 호출 표현식 → `calls` 엣지
   - JSX 태그 사용 → `renders` 엣지
   - **갱신 의미**: 엣지는 "현재 상태" 스냅샷이다. 파일을 재파싱할 때마다 그 파일 안에서 나온 from인 기존 엣지를 전부 삭제 후 재삽입 (제거된 호출은 stale 엣지 방지). to가 워크스페이스 내에서 해석되지 않는 대상(외부 패키지 등)은 MVP에서 스킵.
5. 결과를 4.3 AI 처리 레이어의 배치 큐에 전달 (해설 생성용).

**리네임 매칭(MVP 이후 stretch)**: 이름이 바뀐 경우 토큰 시퀀스 유사도(Jaccard 등)로 이전 유닛과 매칭해 히스토리 체인을 유지. 1주차 MVP에서는 미구현, `created`+`deleted` 쌍으로 남겨두고 이후 개선.

**비용**: 0 (순수 로컬 파싱, LLM 미사용).

---

### 4.3 AI 처리 레이어

세 가지 용도로 Gemini를 호출하며, 모두 동일한 provider abstraction(`AIProvider` 인터페이스)을 거쳐 내부적으로 **`GeminiKeyPool`이 Key A → Key B(서로 다른 Google 계정) 사이를 라운드로빈/폴백**한다. 모든 메서드는 `skillLevel`을 받아 동일한 원본 데이터라도 난이도에 맞게 설명 톤을 바꾼다 (5.1 참조).

```ts
type SkillLevel = 'beginner' | 'intermediate' | 'advanced';

interface AIProvider {
  explainBatch(events: ToolEvent[], skillLevel: SkillLevel): Promise<string[]>;
  synthesizeLectureNote(session: SessionTrace, skillLevel: SkillLevel): Promise<string /* markdown */>;
  answerQuestion(question: string, context: ContextBundle, skillLevel: SkillLevel): Promise<string>;
}

// AIProvider 내부 구현체
class GeminiKeyPool {
  private keys: string[]; // [KEY_A, KEY_B] — 서로 다른 계정 발급 키
  private cursor = 0;

  // 평상시: 요청마다 라운드로빈으로 두 키에 부하 분산 (사실상 2배)
  // 429 수신 시: 해당 키를 쿨다운 큐에 넣고 즉시 나머지 키로 재시도
  async call(request: GeminiRequest): Promise<GeminiResponse> { /* ... */ }
}
```

**4.3.1 실시간 해설 (캡션)**
- 개별 tool_event마다 호출하지 않고 **3~5초 시간창 또는 5개 이벤트 단위로 배칭**해 한 번의 프롬프트로 처리 → Gemini Flash 무료 티어 RPM 제한(분당 10~15건) 회피.
- 입력: 배칭된 tool_event 목록 + 매칭된 code_unit 변경 요약(4.2 결과) + 현재 turn plan + 현재 `skillLevel`.
- 출력: 이벤트별 1~2문장 해설(난이도별 톤은 5.1 참조) + Level 3용 개념 태그(`concept_tags`), UI 트레이스 패널에 스트리밍 표시. 요약과 태그는 같은 호출에서 한 번에 생성 (별도 호출 금지 → RPM 절약).

**4.3.2 세션 종료 강의노트 합성**
- 트리거 체인: Stop 훅(4.1에서 파이프라인이 이미 설치) → 파이프라인이 `sessions.ended_at` 기록 → **B의 앱이 `ended_at`의 NULL→NOT NULL 전이를 감지**(폴링 또는 IPC)해 합성 시작.
- 세션 전체(prompts + tool_events + code_unit_versions + edges)를 Gemini 1M 컨텍스트에 한 번에 투입 → 청킹 불필요.
- 출력: Markdown 강의노트 (다룬 개념, 변경된 유닛별 요약, 다음 학습 추천), 세션 종료 시점의 `skillLevel` 기준으로 1개 생성 → `lecture_notes` 테이블 저장 + UI에서 react-markdown으로 렌더. 다른 난이도로 다시 보고 싶으면 뷰어에서 재생성 요청(온디맨드).

**4.3.3 Q&A 챗 (진행상황 질문 버튼)**
- 타임라인의 임의 지점에서 "질문하기" 클릭 시, 해당 지점까지의 code_unit 상태 + edges + 관련 prompts를 컨텍스트로 구성해 질의.
- 세션당 호출되어 적어 무료 티어 제약을 거의 압박 없음.

**Rate limit 방어 공통 전략**:
- 요청 사이 지수 백오프 적용, 429 수신 시 즉시 다른 키로 전환하고 해당 키는 일정 시간(예: 60초) 쿨다운 후에 복귀.
- 두 키 모두 429인 극단 상황(짧은 시간에 대량 배칭 발생)에 대비해 요청을 순서 있게 순차 처리(즉시 실패시키지 않음).
- 해설 캐시는 `ai_explanations`의 `(target_type, target_id, skill_level)` 키 기준 → 같은 대상+난이도 재조회 시 API 재호출 없음. 난이도 3종을 다 캐시하면 워스트케이스로 호출이 최대 3배 늘 수 있지만, 사용자가 실제로 전환할 때만 온디맨드 생성하므로 평시에는 영향 없음. (동일 diff 내용이 다른 대상으로 재등장할 때의 내용-해시 dedup은 선택적 추가 최적화.)

---

### 4.4 로컬 저장소 (SQLite)

스키마의 단일 소스는 `db/schema.sql`이며, 아래는 그 요약이다. **이 절과 `db/schema.sql`은 항상 함께 갱신한다.**

```sql
-- 초기화 시 PRAGMA journal_mode=WAL; busy_timeout=5000; foreign_keys=ON 적용 (4.6 참조)
-- 모든 CREATE는 IF NOT EXISTS (초기화 스크립트 재실행 안전)

sessions(id PK, project_path, started_at,
         ended_at)             -- Stop 이벤트로 A가 기록, B의 강의노트 트리거 신호

prompts(id PK, session_id FK, turn_index, user_text,
        plan_text,             -- TodoWrite에서 추출, 없으면 해당 턴 첫 assistant 텍스트 (4.1)
        created_at)

tool_events(id PK,             -- tool_use id
        session_id FK, prompt_id FK, tool_name, file_path,
        source,                -- agent | manual
        status,                -- pending | success | error (tool_result 매칭 시 갱신)
        duration_ms, raw_payload, created_at)

code_units(id PK,              -- hash(file_path + unit_name)
        file_path, unit_name,
        unit_type,             -- function | component | hook | class
        first_seen_at, last_seen_at)

code_unit_versions(id PK, unit_id FK, version_no,
        change_type,           -- created | modified | deleted
        diff_text, tool_event_id FK, prompt_id FK, created_at,
        UNIQUE(unit_id, version_no))

code_unit_edges(from_unit_id FK, to_unit_id FK,
        edge_type,             -- imports | calls | renders
        PK(from, to, type))    -- 파일 재파싱 시 from 기준 삭제 후 재삽입 (4.2)

lecture_notes(id PK, session_id FK, markdown, skill_level, created_at)

ai_explanations(id PK, target_type, target_id, skill_level, content,
        concept_tags,          -- JSON 배열, Level 3 개념 태그 (5장)
        created_at,
        UNIQUE(target_type, target_id, skill_level))

user_settings(key PK, value)   -- 예: skill_level = 'intermediate'

-- 인덱스: tool_events(session_id, created_at), prompts(session_id, turn_index),
--         code_unit_versions(unit_id, version_no), code_units(file_path)
```

---

### 4.5 데스크톱 UI (React)

| 화면 | 내용 |
|---|---|
| 실시간 트레이스 패널 | tool_events를 시각적 스트림으로 표시, 각 항목은 4.3.1 해설 병기 |
| 코드 유닛 타임라인 | 유닛 선택 시 code_unit_versions 체인을 버전별로 보여줌 (diff + ai_explanations) |
| 구조도 오버뷰 (React Flow) | code_units를 노드, code_unit_edges를 엣지로 렌더. 노드 클릭 시 유닛 타임라인으로 drill-down |
| 강의노트 뷰어 | lecture_notes를 세션별 리스트, Markdown 렌더 |
| Q&A 챗 버튼 | 트레이스/타임라인 임의 지점에 배치, 클릭 시 4.3.3 호출 |
| **난이도 토글 (헤더 고정)** | 초급/중급/고급 3-way 세그먼트 컨트롤. `user_settings.skill_level` 전역 기본값을 변경, 이후 생성되는 모든 해설에 적용 |
| **항목별 난이도 오버라이드 버튼** | Level 3(코드 유닛 요약)·Level 4(디테일뷰) 카드마다 "쉽게 설명해줘"/"더 자세히" 버튼 → 전역 설정을 건드리지 않고 해당 항목만 다른 `skill_level`로 재조회/재생성 |

---

### 4.6 프로세스 모델 및 동시성

- **개발 중 (Day 1~4)**: A의 파이프라인은 standalone Node CLI로 실행, B의 Electron은 목업 시드 데이터로 개발. 서로 다른 DB 파일을 써도 무방.
- **통합 후 (Day 5~)**: 파이프라인은 **Electron main 프로세스 내 모듈로 임포트해 단일 프로세스로 실행**하는 것을 기본으로 한다 (SQLite 동시 쓰기 문제 원천 차단 + 파이프라인 이벤트를 IPC로 renderer에 직접 push 가능). standalone CLI 모드도 디버깅용으로 유지.
- **SQLite 설정**: `journal_mode=WAL`, `busy_timeout=5000`, `foreign_keys=ON`. CLI와 Electron이 동시에 같은 DB를 여는 디버깅 상황에서도 WAL 덕에 안전.
- **UI 갱신**: 통합 모드에서는 파이프라인 → IPC push가 기본, 폴백으로 renderer가 1초 간격 폴링. SQLite는 자체 저장소이지 메시지 버스가 아님을 유의.

---

## 5. UI 정보 계층 (교육적 설계)

Vibecoding 화면에 담는 정보를 **Top-down 5 레벨**로 설계한다. 상위 레벨일수록 "큰 그림", 아래로 갈수록 "디테일"이며, 기본값은 상위 레벨을 항상 보이게 하고 하위 레벨은 필요할 때만 펼치는 progressive disclosure를 따른다. 세션 종료 후 복습 화면(강의노트/구조도/타임라인)도 동일한 4단 레벨 데이터를 다른 시점에 재구성한 것이므로 컴포넌트를 재사용한다.

| 레벨 | 보여줄 것 | 교육적 역할 | 데이터 소스 |
|---|---|---|---|
| **0. 세션/목표 컨텍스트** (상단 고정) | 원본 요청 요약 + 이번 turn 계획 + 진행률 | 개별 액션이 "왜 되는지" 항상 해석 가능하게 하는 최상위 앵커 | `prompts.plan_text` |
| **1. 구조적 위치** | 구조도 미니맵 + 현재 파일 하이라이트 + breadcrumb + "왜 이 파일인가" | 지금 보는 코드가 전체에서 어떤 역할인지 미아 방지 | `code_unit_edges` |
| **2. 실시간 액션 스트림** | tool_event + 배칭 해설 캡션 | "블랙박스" 핵심 — 액션과 이유를 함께 노출 | `tool_events` + 4.3.1 |
| **3. 코드 유닛 변경 요약** | 함수/컴포넌트 단위 자연어 요약 + 개념 태그 | 장기기억 자연어 요약의 앵커 | `code_unit_versions` + `ai_explanations` |
| **4. Raw 디테일** (기본 접힘) | diff 텍스트 + "더 자세히보기" 드릴다운 | 궁금한 사람만 온디맨드로, 정보 과부하 방지 + API 비용 절약 | `code_unit_versions.diff_text` + 4.3.3 |

### 5.1 난이도별 설명 (초급/중급/고급)

같은 원본 데이터(tool_event, code_unit_version, 세션 전체)를 두고 **프롬프트 템플릿만 skill_level에 따라 교체**해 톤과 깊이를 바꾼다. AST diff·구조 추출 등 결정론적 파이프라인(4.1, 4.2)은 난이도와 무관하게 동일하게 동작 — 오직 4.3 AI 처리 레이어의 설명 문구만 달라진다.

| 레벨 | 실시간 캡션(Level 2) | 코드 유닛 요약(Level 3) | 강의노트(Level 0 재현) |
|---|---|---|---|
| 초급 | 전문용어 최소화, 일상 비유, "왜"부터 단계적으로 | 처음 배우는 사람 기준으로 개념을 하나씩 풀이 | 배경지식부터 짚어주는 튜토리얼 톤 |
| 중급 | 패턴/함수명 그대로 사용, 간결하게 | 일반적 사용 패턴과 비교하며 설명 | 핵심 개념 위주, 기초 설명 생략 |
| 고급 | 트레이드오프·설계 의도 위주, 압축된 문장 | 성능/아키텍처 함의, 대안 접근 비교 | 설계 결정 근거와 대안 분석 위주 |

**동작 방식**:
1. 최초 실행 온보딩에서 "개발 지식 수준"을 3지선다로 질문 → `user_settings.skill_level` 기본값 저장.
2. 헤더의 난이도 토글로 세션 중 전역 기본값 전환 가능 (라이브 세션 중에도).
3. 신규 해설 요청 시 `ai_explanations`를 `(target_type, target_id, skill_level)`로 조회 → 캐시 있으면 즉시 표시, 없으면 4.3 AIProvider 호출 후 캐시.
4. Level 3/4 카드의 "쉽게/자세히" 버튼은 전역 설정을 바꾸지 않고 해당 항목만 다른 skill_level로 조회 → 특정 개념만 콕 짚어 난이도를 바꿔보고 싶은 경우 대응.

---

## 6. MVP 범위 및 1주 일정

| Day | 목표 |
|---|---|
| 1 | Electron+React 셸 세팅, JSONL tail로 raw 이벤트 화면에 스트리밍 (AI 없이) |
| 2 | tree-sitter AST diff engine 구현, code_units/versions/edges SQLite 저장까지 |
| 3 | Gemini provider 연동 + 배칭 로직, 실시간 해설 UI 연결, `skillLevel` 파라미터 배관 + 난이도별 프롬프트 템플릿 3종 작성 |
| 4 | Key B(보조 계정) 폴백/쿨다운 로직 + rate limit 방어, 코드 유닛 타임라인 UI, `ai_explanations` 캐시 테이블 연결 |
| 5 | 구조도 오버뷰(React Flow) 연결, Stop 훅 + 강의노트 합성 |
| 6 | Q&A 챗 버튼, 온보딩 훅 자동 설치 플로우, **온보딩 난이도 질문 + 헤더 토글 + Level 3/4 항목별 오버라이드 버튼** |
| 7 | 버그 픽스, electron-builder 패키징, 데모 리허설 |

**MVP 제외(로드맵)**: 멀티 에이전트 지원(Cursor/Aider 등), 리네임 매칭, 임베딩 기반 장기기억 검색, Windows/Mac 외 플랫폼.

---

## 7. 리스크 및 대응

| 리스크 | 대응 |
|---|---|
| Gemini 무료 티어 RPM 초과로 데모 중 끊김 | 배칭 + 동일 키(Key A/B) 폴백 + 캐시 (4.3 참조) |
| 두 키 모두 동시에 rate limit 걸리는 상황(배칭 폭주 시) | 순차적으로 순차 처리, 실패 대신 지연으로 흡수 |
| 난이도 3종 캐시로 호출이 늘어날 가능성 | 사용자가 실제로 전환/오버라이드할 때만 온디맨드 생성 (선제적으로 3종 다 미리 만들지 않음) |
| tree-sitter 언어별 grammar 세팅 시간 없음 | MVP는 JS/TS/JSX grammar만 우선 지원 |
| JSONL 포맷이 Claude Code 버전 업으로 변경될 가능성 | 파서를 필드별 optional-safe하게 작성, 스키마 버전 체크 |
| AST 매칭이 대규모 리팩터(파일 이동 등)에서 깨짐 | MVP는 단일 파일 내 변경에 집중, 파일 이동은 `deleted+created`로 단순 처리 후 로드맵에서 개선 |
