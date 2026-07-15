-- Factcoding SQLite 스키마 (SPEC.md 4.4의 단일 소스)
-- Person A(파이프라인)와 Person B(AI+UI)가 공유하는 계약.
-- 변경 시 반드시 SPEC.md 4.4도 함께 갱신하고 서로에게 알릴 것.
--
-- 실행 시 주의: 초기화 스크립트에서 아래 PRAGMA를 함께 적용할 것.
--   PRAGMA journal_mode = WAL;   -- 파이프라인/Electron 두 프로세스 동시 접근 대비
--   PRAGMA busy_timeout = 5000;  -- 잠금 경합 시 즉시 실패 대신 대기
--   PRAGMA foreign_keys = ON;

-- 코드베이스 단위 묶음. 관제실/구조도/강의노트는 모두 이 project_id로 스코프된다.
-- workspace_path가 실제 관찰 대상 폴더(= PipelineConfig.projectPath로 넘어가는 값).
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  workspace_path TEXT NOT NULL UNIQUE,
  created_at DATETIME
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,       -- Claude Code 세션 UUID (JSONL 파일명 기준)
  project_id TEXT REFERENCES projects(id),
  project_path TEXT,
  started_at DATETIME,
  ended_at DATETIME,         -- SessionEnd 훅/앱 종료/고아 세션 정리 등 "관찰이 끝났다"는 신호.
  completed_at DATETIME      -- 사용자가 UI의 "완료" 버튼을 명시적으로 누른 시각(그 외 경로는 NULL).
                             -- 강의노트 자동 합성은 ended_at이 아니라 이 값이 있어야만 트리거된다.
);

CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  turn_index INTEGER,
  user_text TEXT,
  plan_text TEXT,           -- 화면에 보여줄 실제 계획. JSONL의 TodoWrite tool_use에서 추출한
                            -- 목록이거나, TodoWrite가 없을 때는 plan-worker가
                            -- pending_plan_source_text를 AI로 재구성한 결과 (SPEC 4.1)
  pending_plan_source_text TEXT, -- TodoWrite 없이 남은 해당 턴 첫 assistant 텍스트(의도 선언문).
                            -- plan-worker가 이걸 plan_text로 정리할 때까지의 임시 대기열.
  created_at DATETIME,
  completed_at DATETIME     -- Stop 훅(매 턴 종료마다 발생)이 잡은 "에이전트 작업이 끝난 시각".
                            -- UI의 진행중 스피너/진행바, caption-worker의 턴 완료 판정이 사용.
);

CREATE TABLE IF NOT EXISTS tool_events (
  id TEXT PRIMARY KEY,      -- tool_use id (JSONL 기준)
  session_id TEXT REFERENCES sessions(id),
  prompt_id TEXT REFERENCES prompts(id),
  tool_name TEXT,           -- Edit/Write/Bash/...
  file_path TEXT,
  source TEXT,              -- agent | manual
  status TEXT DEFAULT 'pending',  -- pending | success | error (tool_result 매칭 시 갱신)
  duration_ms INTEGER,      -- tool_use → tool_result 소요시간
  raw_payload TEXT,
  result_content TEXT,      -- tool_result의 텍스트화된 내용(성공 출력/에러 메시지, truncate됨).
                            -- 실시간 진행 로그가 "왜 실패했는지" 보여줄 근거(step-worker.ts).
  created_at DATETIME
);

-- 에이전트의 assistant_text 조각 전부(턴당 1개만 살아남는 prompts.plan_text
-- 폴백과 달리 전부 보존). 스텝 경계는 아니지만(유휴시간/이벤트 개수 기준), 그
-- 시간대에 있던 note는 진행 로그 카드의 참고 텍스트(요약 실패 시 폴백)로 쓰인다.
CREATE TABLE IF NOT EXISTS assistant_notes (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  prompt_id TEXT REFERENCES prompts(id),
  text TEXT,
  created_at DATETIME
);

CREATE TABLE IF NOT EXISTS code_units (
  id TEXT PRIMARY KEY,      -- hash(project_id + file_path + unit_name) — 프로젝트마다 독립된 id 공간
  project_id TEXT REFERENCES projects(id),
  file_path TEXT,
  unit_name TEXT,
  unit_type TEXT,           -- function | component | hook | class
  first_seen_at DATETIME,
  last_seen_at DATETIME
);

CREATE TABLE IF NOT EXISTS code_unit_versions (
  id TEXT PRIMARY KEY,
  unit_id TEXT REFERENCES code_units(id),
  version_no INTEGER,
  change_type TEXT,         -- created | modified | deleted
  diff_text TEXT,
  tool_event_id TEXT REFERENCES tool_events(id),
  prompt_id TEXT REFERENCES prompts(id),
  step_id TEXT,             -- 이 버전을 만든 스텝의 id(=그 스텝 첫 tool_event의 id).
                            -- pipeline insert 시점엔 스텝 개념이 없어 항상 NULL로 들어오고,
                            -- step-worker가 매 tick마다 tool_event_id로 역추적해 채운다
                            -- (구조도 노드 클릭 → 진행 로그 카드 연결에 사용).
  created_at DATETIME,
  UNIQUE(unit_id, version_no)
);

-- "현재 상태" 스냅샷. 파일을 재파싱할 때마다 그 파일 안에서 나온는
-- from인 기존 엣지를 삭제 후 재삽입한다 (stale 엣지 방지, SPEC 4.2).
-- to_unit_id는 워크스페이스 내에서 해석된 유닛만 기록 (외부 모듈 호출은 MVP에서 생략).
CREATE TABLE IF NOT EXISTS code_unit_edges (
  from_unit_id TEXT REFERENCES code_units(id),
  to_unit_id TEXT REFERENCES code_units(id),
  edge_type TEXT,           -- imports | calls | renders
  PRIMARY KEY (from_unit_id, to_unit_id, edge_type)
);

CREATE TABLE IF NOT EXISTS lecture_notes (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  markdown TEXT,
  skill_level TEXT,         -- beginner | intermediate | advanced
  created_at DATETIME
);

-- 난이도별 AI 해설 캐시 (SPEC.md 5.1)
-- step 행(실시간 진행 로그, step-worker.ts)은 content(짧은 요약) + key_code_*
-- (결정론적으로 뽑은 실제 diff + AI가 채운 설명/중요도/학습포인트)를 쓴다.
-- code_unit_version 행도 key_code_snippet만 함께 채운다 — AI가 diff에 매겨진 줄 번호로
-- "핵심 범위"를 고르면 우리가 그 줄들을 그대로 잘라 넣는다(explainVersionsPrompt.ts의
-- sliceKeySnippet) — AI가 코드를 직접 생성하지 않으므로 항상 diff_text의 정확한 부분 문자열이다.
-- prompt/qna 행은 기존 그대로 content(+ concept_tags)만 채우고 key_code_*/error_detail/status는 전부 null.
CREATE TABLE IF NOT EXISTS ai_explanations (
  id TEXT PRIMARY KEY,
  target_type TEXT,         -- tool_event | prompt | code_unit_version | qna | step
  target_id TEXT,
  skill_level TEXT,         -- beginner | intermediate | advanced
  content TEXT,
  key_code_snippet TEXT,    -- 핵심 코드 스니펫(nullable) — 결정론적으로 추출된 실제 diff, AI가 만들지 않음. step/code_unit_version 행에서 사용.
  key_code_lang TEXT,       -- 코드 언어(ts, tsx 등). step 행 전용.
  key_code_file TEXT,       -- 코드가 위치한 파일 경로. step 행 전용.
  key_code_other_files TEXT,     -- 같은 스텝에서 함께 바뀐 나머지 파일 목록(JSON 배열). step 행 전용.
  key_code_explanation TEXT,     -- 이 코드가 무엇인지. step 행 전용.
  key_code_importance TEXT,      -- 이 코드가 중요한 이유. step 행 전용.
  key_code_application TEXT,     -- 이 코드로 배우는 점(학습 포인트). step 행 전용.
  error_detail TEXT,        -- 실패 스텝의 원본 에러 메시지(요약 없이 truncate만). step 행 전용.
  status TEXT,              -- success | failed. step 행 전용 — 스텝에 속한 tool_event 중
                            -- 하나라도 error가 있으면 failed(로컬 계산, AI 응답과 무관).
  concept_tags TEXT,        -- JSON 배열, 예: ["디바운스","useEffect"] → Level 3 개념 태그 (SPEC 5장, code_unit_version 전용)
  created_at DATETIME,
  UNIQUE(target_type, target_id, skill_level)
);

-- 전역 설정값 (기본 skill_level 등 단일 사용자 로컬 설정)
CREATE TABLE IF NOT EXISTS user_settings (
  key TEXT PRIMARY KEY,     -- 예: 'skill_level'
  value TEXT                -- 예: 'intermediate'
);

-- 조회 패턴에 맞춘 인덱스
-- (트레이스 패널: 세션별 시간순 / 타임라인: 유닛별 버전 체인 / 구조도: 파일별 유닛)
CREATE INDEX IF NOT EXISTS idx_tool_events_session_time ON tool_events(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_prompts_session_turn ON prompts(session_id, turn_index);
CREATE INDEX IF NOT EXISTS idx_assistant_notes_session_time ON assistant_notes(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_versions_unit ON code_unit_versions(unit_id, version_no);
CREATE INDEX IF NOT EXISTS idx_units_file ON code_units(file_path);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id, started_at);
CREATE INDEX IF NOT EXISTS idx_units_project ON code_units(project_id, file_path);
