// 공용 타입 — Person A(파이프라인)와 Person B(AI+UI)가 함께 씀.
// Day 1 범위: transcript 파싱 결과 이벤트 + 파이프라인 진입점 인터페이스만 정의.
// code_units/versions/edges 관련 타입은 Day 2에서 추가.

export interface ParsedPrompt {
  kind: 'prompt';
  sessionId: string;
  uuid: string;
  userText: string;
  timestamp: string;
}

export interface ParsedToolUse {
  kind: 'tool_use';
  sessionId: string;
  toolUseId: string;
  toolName: string;
  input: unknown;
  filePath?: string;
  timestamp: string;
}

export interface ParsedTodoWrite {
  kind: 'todo_write';
  sessionId: string;
  toolUseId: string;
  todos: { content: string; status: string; activeForm: string }[];
  timestamp: string;
}

export interface ParsedToolResult {
  kind: 'tool_result';
  sessionId: string;
  toolUseId: string;
  isError: boolean;
  content: unknown;
  timestamp: string;
}

export interface ParsedAssistantText {
  kind: 'assistant_text';
  sessionId: string;
  text: string;
  timestamp: string;
}

export type TranscriptEvent =
  | ParsedPrompt
  | ParsedToolUse
  | ParsedTodoWrite
  | ParsedToolResult
  | ParsedAssistantText;

export interface PipelineConfig {
  /** 관찰 대상 프로젝트 절대 경로 (~/.claude/projects/<hash> 매핑에 사용) */
  projectPath: string;
  /** SQLite DB 파일 경로 */
  dbPath: string;
}

export interface PipelineHandle {
  stop(): void;
  on(event: 'transcript-event', listener: (e: TranscriptEvent) => void): void;
  on(event: 'session-file-changed', listener: (filePath: string) => void): void;
  on(event: 'error', listener: (err: unknown) => void): void;
  /**
   * SessionEnd 훅(자동: /exit, Ctrl-C, /clear, 로그아웃 등)과는 별개로, UI의 "프로젝트/세션
   * 완료" 버튼처럼 사용자가 명시적으로 끝냈다고 표시하는 경로. sessions.ended_at을 즉시 기록한다
   * (Person B가 Day 5+ Electron 통합 후 버튼 클릭 핸들러에서 직접 호출).
   */
  markSessionEnded(sessionId: string): void;
}
