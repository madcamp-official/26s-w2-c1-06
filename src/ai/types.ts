import type {
  AssistantNote,
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

// 학습 파이프라인 4단계: 스텝(에이전트 의도 1개 + 그 안 액션들) 단위 요약.
export interface StepInput {
  stepId: string
  noteText: string
  events: ToolEvent[]
}

// 진행상황 패널(거북이 로딩바) 전용 — 스텝 완료 시 생성되는 초단문 요약 + 핵심 코드.
export interface KeyCode {
  filePath: string
  lang: string
  snippet: string
  reason: string
}

export interface ProgressSummary {
  stepId: string
  summary: string
  keyCode: KeyCode | null
}

// 강의노트에 넣을 학습 스텝 요약(도구 나열 대신 탑다운 서사 우선).
export interface StepSummaryForNote {
  summary: string
}

// SPEC 4.3.2 강의노트 합성 입력: 세션 전체를 한 번에 컨텍스트로 투입.
export interface SessionTrace {
  session: Session
  prompts: Prompt[]
  toolEvents: ToolEvent[]
  versions: CodeUnitVersionWithUnit[]
  steps: StepSummaryForNote[]
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
  explainBatch(events: ToolEvent[], notes: AssistantNote[], skillLevel: SkillLevel): Promise<BatchCaption[]>
  summarizeProgress(steps: StepInput[], skillLevel: SkillLevel): Promise<ProgressSummary[]>
  explainUnitVersions(
    versions: CodeUnitVersionWithUnit[],
    skillLevel: SkillLevel
  ): Promise<VersionCaption[]>
  synthesizeLectureNote(trace: SessionTrace, skillLevel: SkillLevel): Promise<string>
  answerQuestion(question: string, context: ContextBundle, skillLevel: SkillLevel): Promise<string>
}
