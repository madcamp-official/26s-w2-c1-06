import type {
  CodeUnit,
  CodeUnitEdge,
  CodeUnitVersionWithUnit,
  Prompt,
  QnaHistoryEntry,
  Session,
  SkillLevel,
  ToolEvent,
  TurnNarrativeBubble
} from '@shared/types'

export type { QnaHistoryEntry }

// 턴(prompt) 전체를 하나로 묶은 feature 단위 해설 — 개별 tool_event가 아니라
// 그 턴에서 실제로 완성된 변경 사항을 다룬다. summary는 목록용 한 줄 요약,
// bubbles는 사수가 슬랙으로 설명하듯 이어지는 서술식 말풍선들(관제실 턴 상세에 표시).
export interface TurnCaption {
  promptId: string
  summary: string
  bubbles: TurnNarrativeBubble[]
  conceptTags: string[]
}

// explainTurn에 넘기는 구조 컨텍스트: 이 턴에서 바뀐 유닛 버전들 + 프로젝트 전체
// 구조도(유닛/엣지). "전체 구조에서 이번 턴이 어디를 만졌는지"를 서술하는 데 쓴다.
export interface TurnContext {
  versions: CodeUnitVersionWithUnit[]
  units: CodeUnit[]
  edges: CodeUnitEdge[]
}

export interface VersionCaption {
  versionId: string
  caption: string
  conceptTags: string[]
}

// SPEC 4.3.2 강의노트 합성 입력: 세션 전체를 한 번에 컨텍스트로 투입.
export interface SessionTrace {
  session: Session
  prompts: Prompt[]
  toolEvents: ToolEvent[]
  versions: CodeUnitVersionWithUnit[]
}

// SPEC 4.3.3 Q&A 입력: 질문 시점까지의 구조(유닛+엣지) + 세션의 요청(prompt) 이력.
export interface ContextBundle {
  session: Session
  prompts: Prompt[]
  units: CodeUnit[]
  edges: CodeUnitEdge[]
}


// SPEC 4.3의 AIProvider: 실시간 해설(4.3.1, 턴/feature 단위)·코드 유닛 변경 요약(Level 3)·
// 강의노트 합성(4.3.2)·Q&A 챗(4.3.3).
export interface AIProvider {
  // 프롬프트를 보낼 때가 아니라, 그 턴의 코딩 수정이 "완료된" 시점에 한 번만 호출된다
  // (caption-worker.ts의 완료 판정 참조) — Read/Write/Bash 등 개별 tool_event 단위가
  // 아니라 턴 전체를 하나의 feature로 묶어, 구조도 위에서 짚어주는 서술식 말풍선으로 푼다.
  explainTurn(
    prompt: Prompt,
    events: ToolEvent[],
    context: TurnContext,
    skillLevel: SkillLevel
  ): Promise<TurnCaption>
  explainUnitVersions(
    versions: CodeUnitVersionWithUnit[],
    skillLevel: SkillLevel
  ): Promise<VersionCaption[]>
  synthesizeLectureNote(trace: SessionTrace, skillLevel: SkillLevel): Promise<string>
  answerQuestion(
    question: string,
    context: ContextBundle,
    history: QnaHistoryEntry[],
    skillLevel: SkillLevel
  ): Promise<string>
}
