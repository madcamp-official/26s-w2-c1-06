// db/schema.sql과 1:1로 대응하는 공유 타입. 스키마를 바꾸면 이 파일도 함께 갱신할 것.

export type ToolSource = 'agent' | 'manual'
export type ToolStatus = 'pending' | 'success' | 'error'
export type ChangeType = 'created' | 'modified' | 'deleted'
export type UnitType = 'function' | 'component' | 'hook' | 'class'
export type EdgeType = 'imports' | 'calls' | 'renders'
// 5단계로 확장 — 온보딩 3단계(수강 과목/프로젝트 경험/교육 스타일)를 합쳐 계산한
// 초기 위치를 사이드바의 "난이도 조절" 슬라이더가 5칸 중 하나로 표시하고, 이후
// 사용자가 슬라이더를 밀어 더 쉽거나 어렵게 재조정할 수 있다. 각 값은 AI 프롬프트
// 톤 지시문(SKILL_TONE_INSTRUCTIONS)의 키로도 그대로 쓰인다.
export type SkillLevel = 'novice' | 'beginner' | 'intermediate' | 'advanced' | 'expert'

// 온보딩 1단계: 수강 과목 자기 신고 (KAIST 전산학부 교육과정 기준).
// courses에는 전공필수 체크 목록 + 전산기구조/시스템프로그래밍(주요 전공선택) +
// 사용자가 직접 추가한 과목명이 모두 문자열로 섞여 들어간다.
export interface OnboardingCourses {
  courses: string[]
}

// 온보딩 2단계: 프로젝트 경험 (Top-down 신호).
export type ProjectCountBucket = '0' | '1-2' | '3-5' | '6+'

export interface OnboardingProjects {
  projectBucket: ProjectCountBucket
  stack: string[]
}

// 온보딩 3단계: 전반적인 교육 스타일 선호.
export type TeachingStyle = 'theory-first' | 'practice-first' | 'analogy' | 'balanced'

// 3단계를 합친 전체 프로필 — user_settings에 JSON으로 저장되고, 난이도 슬라이더의
// 초기 위치를 계산하는 데 쓰인다 (src/shared/skillProfile.ts의 computeSkillProfile).
export interface OnboardingProfile extends OnboardingCourses, OnboardingProjects {
  style: TeachingStyle
}
// 'prompt' = 턴(요청) 전체를 묶은 feature 단위 해설. 개별 tool_event(Read/Write/Bash 등)
// 단위 해설은 더 이상 생성하지 않는다 — 관제실은 코딩 수정이 "완료된" 턴 단위로만
// AI를 호출해 정리한다(caption-worker.ts 참조). 'tool_event'는 과거 데이터 호환용으로 남겨둔다.
// 'step'은 실시간 진행 로그(step-worker.ts) 전용 — 턴보다 더 잘게(유휴시간/이벤트
// 개수 기준) 나눈 단위로, 턴이 끝나기 전에도(진행 중에도) 실시간으로 채워진다.
export type AiExplanationTargetType = 'tool_event' | 'prompt' | 'code_unit_version' | 'qna' | 'step'

export interface Project {
  id: string
  name: string
  workspace_path: string
  created_at: string | null
}

export interface Session {
  id: string
  project_id: string | null
  project_path: string | null
  started_at: string | null
  ended_at: string | null
  // 사용자가 UI의 "완료" 버튼을 명시적으로 누른 시각 — SessionEnd 훅/앱 종료/고아
  // 세션 정리로 ended_at만 채워진 세션과 구분된다. 강의노트 자동 합성은 이 값이
  // 있어야만 트리거된다(lecture-note-worker.ts).
  completed_at: string | null
}

// 사이드바의 "지난 턴" 목록처럼 세션을 커밋 해시 대신 실제 프롬프트 내용으로 식별해
// 보여줄 때 쓰는 조인 결과 (main의 getAllSessions 쿼리 반환 형태).
export interface SessionWithPreview extends Session {
  first_prompt_text: string | null
}

export interface Prompt {
  id: string
  session_id: string
  turn_index: number
  user_text: string | null
  plan_text: string | null
  created_at: string | null
  // Stop 훅(매 턴 종료마다 발생)이 잡은 "에이전트 작업이 끝난 시각". NULL이면 아직
  // 진행 중이거나 훅 신호를 못 받은 턴 — UI 스피너/진행바와 caption-worker가 사용.
  completed_at: string | null
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
  // tool_result의 텍스트화된 내용(성공 출력/에러 메시지, truncate됨) — 실시간 진행
  // 로그가 "왜 실패했는지" 보여줄 근거(step-worker.ts).
  result_content: string | null
  created_at: string | null
}

// 에이전트의 assistant_text 조각 전부(턴당 1개만 살아남는 prompts.plan_text 폴백과
// 달리 전부 보존). 스텝 경계는 아니지만, 그 시간대에 있던 note는 진행 로그 카드의
// 참고 텍스트(요약 실패 시 폴백)로 쓰인다.
export interface AssistantNote {
  id: string
  session_id: string
  prompt_id: string | null
  text: string
  created_at: string | null
}

export interface CodeUnit {
  id: string
  project_id: string | null
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
  // 이 버전을 만든 스텝의 id(=그 스텝 첫 tool_event의 id). pipeline insert 시점엔
  // 스텝 개념이 없어 항상 null로 들어오고, step-worker가 역추적해 채운다.
  step_id: string | null
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
  // 아래는 target_type === 'step'(실시간 진행 로그) 행에만 채워짐 — 그 외 행은 전부 null.
  // 예외: key_code_snippet만 'code_unit_version' 행에도 채워진다(TurnChanges "핵심 코드").
  key_code_snippet: string | null // 결정론적으로 추출된 실제 diff(AI가 만들지 않음)
  key_code_lang: string | null
  key_code_file: string | null
  key_code_other_files: string | null // JSON 배열 문자열 — 같은 스텝에서 함께 바뀐 나머지 파일
  key_code_explanation: string | null // 이 코드가 무엇인지
  key_code_importance: string | null // 이 코드가 중요한 이유
  key_code_application: string | null // 이 코드로 배우는 점(학습 포인트)
  error_detail: string | null // 실패 스텝의 원본 에러 메시지(truncate만, AI 생성 아님)
  status: 'success' | 'failed' | null // 스텝에 속한 tool_event 중 error가 있으면 failed
  concept_tags: string | null // JSON 배열 문자열
  created_at: string | null
}

// db:getSteps 반환 형태: shared/steps.ts의 groupIntoSteps로 나눈 스텝 메타데이터 +
// 아직 생성 안 됐을 수 있는 ai_explanations(target_type='step') 조인 결과.
// explanation이 null이면 step-worker가 아직 요약하지 않은 것(진행 중 스텝이거나
// 대기 중) — 렌더러는 "생성 중…" 상태로 보여준다.
export interface StepWithExplanation {
  stepId: string
  promptId: string | null
  startedAt: string // ISO
  inProgress: boolean // 세션이 안 끝났고 이 스텝이 마지막 스텝인 경우(아직 유휴시간 전)
  explanation: AiExplanation | null
  // 이 스텝에 속한 모든 tool_event id(stepId=첫 이벤트 id뿐 아니라 전체) — 렌더러가
  // code_unit_versions.tool_event_id로 "이 코드 유닛이 어느 스텝에서 나왔는지" 매칭해
  // 실시간 진행 로그 카드 아래에 그 스텝에서 생긴 코드 유닛을 중첩해서 보여줄 때 쓴다
  // (TurnDetailPanel 참조).
  toolEventIds: string[]
}

export interface UserSetting {
  key: string
  value: string | null
}

// SPEC 4.6 "파이프라인 이벤트 → IPC push": main이 DB를 갱신할 때마다 이 중 하나의
// kind로 렌더러에 push해 즉시 재조회를 트리거한다. 렌더러의 폴링은 이 push를 놓친
// 경우(리스너 등록 전 이벤트, 예외 등)의 안전망으로 더 느린 주기로 계속 남겨둔다.
export type DataChangeKind =
  | 'trace' // prompts/tool_events (관찰 중인 세션의 턴/액션)
  | 'code-units' // code_units/code_unit_versions/code_unit_edges (구조도, AST diff)
  | 'explanation' // ai_explanations upsert (턴 해설, 유닛 버전 해설)
  | 'lecture-note' // lecture_notes insert (강의노트 자동 합성)
  | 'session' // sessions insert/update (started_at/ended_at, 모니터링 상태)

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
  /** Universal Ctags 실행 파일 — JS/TS/TSX 외 언어의 구조도 추출(ctags-extractor.ts)에 사용 */
  ctagsBinaryPath: string
}

export interface PipelineConfig {
  /** projects.id — code_units/sessions를 이 프로젝트로 스코프하는 데 쓰인다 */
  projectId: string
  /** 관찰 대상 프로젝트 절대 경로 (~/.claude/projects/<hash> 매핑에 사용) */
  projectPath: string
  /** SQLite DB 파일 경로 */
  dbPath: string
  assets: PipelineAssetPaths
  /**
   * true면 현재 세션 파일의 "지금 이 시점"부터만 tail한다(기존 내용은 스킵).
   * Electron의 "시작하기" 버튼처럼 사용자가 명시적으로 관찰을 켠 시점부터만
   * 보고 싶을 때 켠다. CLI 기본값(false/미지정)은 항상 파일 처음부터 리플레이한다
   * (디버깅 시 과거 세션 전체를 다시 보고 싶은 경우가 많아서).
   */
  startAtEnd?: boolean
}

export interface PipelineHandle {
  // 진행 중인 AST diff(비동기 파싱 → DB 기록)를 모두 끝내고 커넥션을 닫은 뒤 resolve된다.
  // 프로세스를 곧바로 종료할 호출자는 반드시 await할 것 — 아니면 마지막 변경이 유실될 수 있다.
  stop(): Promise<void>
  on(event: 'transcript-event', listener: (e: TranscriptEvent) => void): void
  on(event: 'session-file-changed', listener: (filePath: string) => void): void
  // AST diff(runAstDiff)가 code_units/code_unit_versions/code_unit_edges를 커밋한 직후 emit —
  // 렌더러에 구조도/타임라인 갱신을 push하기 위한 신호(Electron main이 구독, SPEC 4.6).
  on(event: 'code-units-changed', listener: () => void): void
  // SessionStart/SessionEnd 훅 마커를 반영한 직후 emit — sessions 테이블이 바뀌었다는 신호.
  on(event: 'session-updated', listener: () => void): void
  // Stop 훅(턴 종료) 마커로 prompts.completed_at을 실제로 갱신한 직후 emit —
  // 렌더러가 진행중 스피너/진행바를 즉시 완료 상태로 바꿀 수 있게 push하는 신호.
  on(event: 'turn-completed', listener: () => void): void
  /**
   * 지금 실제로 DB에 기록 중인 "논리" 세션 id가 정해질 때마다 emit(세션 재개 감지 포함,
   * index.ts의 resolveLogicalSessionId 참조). session-file-changed는 JSONL 파일명(=원본
   * id) 기준이라 재개 시나리오에서 실제 논리 id와 달라질 수 있어, 호출자는 markSessionEnded에
   * 넘길 id를 이 이벤트로 추적해야 한다.
   */
  on(event: 'session-resolved', listener: (sessionId: string) => void): void
  on(event: 'error', listener: (err: unknown) => void): void
  /**
   * SessionEnd 훅(자동: /exit, Ctrl-C, /clear, 로그아웃 등)과는 별개로, UI의 "프로젝트/세션
   * 완료" 버튼처럼 사용자가 명시적으로 끝냈다고 표시하는 경로. sessions.ended_at을 즉시 기록한다
   * (Person B가 Day 5+ Electron 통합 후 버튼 클릭 핸들러에서 직접 호출).
   */
  markSessionEnded(sessionId: string): void
}
