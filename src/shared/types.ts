// db/schema.sql과 1:1로 대응하는 공유 타입. 스키마를 바꾸면 이 파일도 함께 갱신할 것.

export type ToolSource = 'agent' | 'manual'
export type ToolStatus = 'pending' | 'success' | 'error'
export type ChangeType = 'created' | 'modified' | 'deleted'
export type UnitType = 'function' | 'component' | 'hook' | 'class'
export type EdgeType = 'imports' | 'calls' | 'renders'
export type SkillLevel = 'beginner' | 'intermediate' | 'advanced'
export type AiExplanationTargetType = 'tool_event' | 'code_unit_version' | 'qna'

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
  content: string
  concept_tags: string | null // JSON 배열 문자열
  created_at: string | null
}

export interface UserSetting {
  key: string
  value: string | null
}
