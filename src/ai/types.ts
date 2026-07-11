import type {
  CodeUnit,
  CodeUnitEdge,
  CodeUnitVersionWithUnit,
  Prompt,
  Session,
  SkillLevel,
  ToolEvent
} from '@shared/types'

export interface BatchCaption {
  toolEventId: string
  caption: string
  conceptTags: string[]
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

// SPEC 4.3의 AIProvider: 실시간 해설(4.3.1)·코드 유닛 변경 요약(Level 3)·
// 강의노트 합성(4.3.2)·Q&A 챗(4.3.3).
export interface AIProvider {
  explainBatch(events: ToolEvent[], skillLevel: SkillLevel): Promise<BatchCaption[]>
  explainUnitVersions(
    versions: CodeUnitVersionWithUnit[],
    skillLevel: SkillLevel
  ): Promise<VersionCaption[]>
  synthesizeLectureNote(trace: SessionTrace, skillLevel: SkillLevel): Promise<string>
  answerQuestion(question: string, context: ContextBundle, skillLevel: SkillLevel): Promise<string>
}
