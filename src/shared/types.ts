// db/schema.sql과 1:1로 대응하는 공유 타입. 스키마를 바꾸면 이 파일도 함께 갱신할 것.

export type ToolSource = 'agent' | 'manual'
export type ToolStatus = 'pending' | 'success' | 'error'
export type ChangeType = 'created' | 'modified' | 'deleted'
export type UnitType = 'function' | 'component' | 'hook' | 'class'
export type EdgeType = 'imports' | 'calls' | 'renders'
export type SkillLevel = 'beginner' | 'intermediate' | 'advanced'
export type AiExplanationTargetType = 'tool_event' | 'code_unit_version' | 'qna' | 'step'

export interface UnitMatchStat {
  unitId: string
  versionCount: number
  latestChangeType: ChangeType | null
  lastSeenAt: string | null
  // 이 유닛의 최신 버전을 만든 스텝(assistant_notes.id) — 구조도 노드 클릭 시
  // 진행상황 카드로 스크롤 이동하는 데 사용(SPEC 패치 v2 #6). 백필 전이면 null.
  latestStepId: string | null
}

export interface MatchStats {
  success: number
  error: number
  pending: number
  created: number
}

export interface Session {
  id: string
  project_path: string | null
  started_at: string | null
  ended_at: string | null
}

export interface Prompt {
  id: string
  session_id: string
  turn_index: number
  user_text: string | null
  plan_text: string | null
  created_at: string | null
}

export interface ToolEvent {
  id: string
  session_id: string
  prompt_id: string | null
  tool_name: string
  file_path: string | null
  source: ToolSource
  status: ToolStatus
  duration_ms: number | null
  raw_payload: string | null
  result_content: string | null
  created_at: string | null
}

export interface AssistantNote {
  id: string
  session_id: string
  prompt_id: string | null
  text: string
  created_at: string | null
}

export interface CodeUnit {
  id: string
  file_path: string
  unit_name: string
  unit_type: UnitType
  first_seen_at: string | null
  last_seen_at: string | null
}

export interface CodeUnitVersion {
  id: string
  unit_id: string
  version_no: number
  change_type: ChangeType
  diff_text: string | null
  tool_event_id: string | null
  prompt_id: string | null
  step_id: string | null    // 이 버전을 만든 스텝(assistant_notes.id). progress-worker가 백필.
  created_at: string | null
}

// 타임라인/해설용 조인 결과: 버전 + 소속 유닛 정보 (main의 JOIN 쿼리 반환 형태)
export interface CodeUnitVersionWithUnit extends CodeUnitVersion {
  unit_name: string
  unit_type: UnitType
  file_path: string
}

export interface CodeUnitEdge {
  from_unit_id: string
  to_unit_id: string
  edge_type: EdgeType
}

export interface LectureNote {
  id: string
  session_id: string
  markdown: string
  skill_level: SkillLevel
  created_at: string | null
}

export interface AiExplanation {
  id: string
  target_type: AiExplanationTargetType
  target_id: string
  skill_level: SkillLevel
  // 짧은 요약 텍스트. step 행: progress-worker가 채우는 진행상황 요약.
  // code_unit_version 행: 기존 그대로 "무엇이 왜 바뀌었는지" 캡션.
  summary: string
  // 아래 4개는 step 행에만 채워짐(진행상황 패널의 "핵심 코드" 카드) — code_unit_version 행은 전부 null.
  key_code_snippet: string | null
  key_code_lang: string | null
  key_code_file: string | null
  key_code_reason: string | null
  // step 행에만 채워짐: 이 스텝 완료 시점의 누적 퍼센트(0~100). code_unit_version 행은 null.
  step_percent: number | null
  // success | failed. step 행 전용 — 스텝에 속한 tool_event 중 error가 하나라도 있으면 failed.
  status: 'success' | 'failed' | null
  concept_tags: string | null // JSON 배열 문자열. code_unit_version 행에서만 쓰임(Level 3 개념 태그)
  created_at: string | null
}

export interface UserSetting {
  key: string
  value: string | null
}

// --- 아래는 Person A(파이프라인) 전용 타입: JSONL 트랜스크립트 파싱 결과와
// 파이프라인 진입점 인터페이스. 위 DB 행 타입들과 달리 스키마 테이블에 직접
// 대응하지 않고, 파이프라인 내부에서 파싱 → AST diff → DB 기록으로 이어지는
// 중간 표현이다.

export interface ParsedPrompt {
  kind: 'prompt'
  sessionId: string
  uuid: string
  userText: string
  timestamp: string
}

export interface ParsedToolUse {
  kind: 'tool_use'
  sessionId: string
  toolUseId: string
  toolName: string
  input: unknown
  filePath?: string
  timestamp: string
}

export interface ParsedTodoWrite {
  kind: 'todo_write'
  sessionId: string
  toolUseId: string
  todos: { content: string; status: string; activeForm: string }[]
  timestamp: string
}

export interface ParsedToolResult {
  kind: 'tool_result'
  sessionId: string
  toolUseId: string
  isError: boolean
  content: unknown
  timestamp: string
}

export interface ParsedAssistantText {
  kind: 'assistant_text'
  sessionId: string
  text: string
  timestamp: string
}

export type TranscriptEvent =
  | ParsedPrompt
  | ParsedToolUse
  | ParsedTodoWrite
  | ParsedToolResult
  | ParsedAssistantText

/**
 * 파이프라인이 런타임에 읽어야 하는 정적 자산들의 절대 경로. 이 저장소 규칙상
 * (db/connection.ts 참조) __dirname/import.meta.url 기반 계산은 vite 번들링 시
 * 산출물 경로를 가리키게 되므로, 항상 호출부(CLI는 config.ts의 loadConfig,
 * Electron main은 app.getAppPath()/process.resourcesPath 기준)가 정해서 넘긴다.
 */
export interface PipelineAssetPaths {
  /** db/schema.sql */
  schemaPath: string
  /** web-tree-sitter 코어 wasm (node_modules/web-tree-sitter/tree-sitter.wasm) */
  coreWasmPath: string
  /** 언어별 grammar wasm 디렉토리 (src/pipeline/ast-diff/grammars) */
  grammarsDir: string
  /** SessionStart/SessionEnd 훅 스크립트 (src/pipeline/hooks/session-event-hook.mjs) */
  hookScriptPath: string
}

export interface PipelineConfig {
  /** 관찰 대상 프로젝트 절대 경로 (~/.claude/projects/<hash> 매핑에 사용) */
  projectPath: string
  /** SQLite DB 파일 경로 */
  dbPath: string
  assets: PipelineAssetPaths
}

export interface PipelineHandle {
  stop(): void
  on(event: 'transcript-event', listener: (e: TranscriptEvent) => void): void
  on(event: 'session-file-changed', listener: (filePath: string) => void): void
  on(event: 'error', listener: (err: unknown) => void): void
  /**
   * SessionEnd 훅(자동: /exit, Ctrl-C, /clear, 로그아웃 등)과는 별개로, UI의 "프로젝트/세션
   * 완료" 버튼처럼 사용자가 명시적으로 끝냈다고 표시하는 경로. sessions.ended_at을 즉시 기록한다
   * (Person B가 Day 5+ Electron 통합 후 버튼 클릭 핸들러에서 직접 호출).
   */
  markSessionEnded(sessionId: string): void
}
