-- Factcoding SQLite 스키마 (SPEC.md 4.4의 단일 소스)
-- Person A(파이프라인)와 Person B(AI+UI)가 공유하는 계약.
-- 변경 시 반드시 SPEC.md 4.4도 함께 갱신하고 서로에게 알릴 것.
--
-- 실행 전제: 초기화 스크립트에서 아래 PRAGMA를 함께 적용할 것.
--   PRAGMA journal_mode = WAL;   -- 파이프라인/Electron 두 프로세스 동시 접근 대비
--   PRAGMA busy_timeout = 5000;  -- 잠금 경합 시 즉시 실패 대신 대기
--   PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,       -- Claude Code 세션 UUID (JSONL 파일명 기준)
  project_path TEXT,
  started_at DATETIME,
  ended_at DATETIME          -- Stop 이벤트 감지 시 파이프라인(A)이 기록.
                             -- B는 이 값의 NULL→NOT NULL 전이를 보고 강의노트 합성 트리거.
);

CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  turn_index INTEGER,
  user_text TEXT,
  plan_text TEXT,           -- 에이전트의 계획. JSONL의 TodoWrite tool_use에서 추출,
                            -- 없으면 해당 턴 첫 assistant 텍스트로 대체 (SPEC 4.1)
  created_at DATETIME
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
  created_at DATETIME
);

CREATE TABLE IF NOT EXISTS code_units (
  id TEXT PRIMARY KEY,      -- hash(file_path + unit_name)
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
  created_at DATETIME,
  UNIQUE(unit_id, version_no)
);

-- "현재 상태" 스냅샷. 파일을 재파싱할 때마다 그 파일 소속 유닛들이
-- from인 기존 엣지를 삭제 후 재삽입한다 (stale 엣지 방지, SPEC 4.2).
-- to_unit_id는 워크스페이스 내에서 해석된 유닛만 기록 (외부 모듈 호출은 MVP에서 스킵).
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
CREATE TABLE IF NOT EXISTS ai_explanations (
  id TEXT PRIMARY KEY,
  target_type TEXT,         -- tool_event | code_unit_version | qna
  target_id TEXT,
  skill_level TEXT,         -- beginner | intermediate | advanced
  content TEXT,
  concept_tags TEXT,        -- JSON 배열, 예: ["디바운스","useEffect"] — Level 3 개념 태그 (SPEC 5장)
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
CREATE INDEX IF NOT EXISTS idx_versions_unit ON code_unit_versions(unit_id, version_no);
CREATE INDEX IF NOT EXISTS idx_units_file ON code_units(file_path);