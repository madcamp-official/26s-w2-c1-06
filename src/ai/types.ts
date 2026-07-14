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
import type { QuizLesson } from '@shared/quiz'

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

// 학습 파이프라인 4단계: 스텝(유휴시간/개수로 나뉜 이벤트 묶음) 단위 요약.
// noteText는 이제 스텝 경계가 아니라 우연히 그 시간대에 있던 참고 텍스트라 optional.
// codeCandidate는 progress-worker가 이미 결정론적으로 뽑아둔 대표 diff — AI는 이걸
// 보고 설명만 채우지, 코드 자체를 새로 만들어내지 않는다.
export interface StepInput {
  stepId: string
  noteText: string | null
  events: ToolEvent[]
  codeCandidate: { filePath: string; lang: string; snippet: string; otherFiles: string[] } | null
}

// 진행상황 패널(거북이 로딩바) 전용 — 스텝 완료 시 생성되는 초단문 요약 + 핵심 코드.
// filePath/lang/snippet은 AI가 아니라 progress-worker가 결정론적으로 채운 뒤 병합한다.
export interface KeyCode {
  filePath: string
  lang: string
  snippet: string
  otherFiles: string[]
  explanation: string
  importance: string
  application: string
}

// AIProvider.summarizeProgress가 실제로 채우는 부분 — 이미 주어진 codeCandidate에
// 대한 설명 3필드만. filePath/lang/snippet/otherFiles는 여기 없다(AI 책임 아님).
export interface KeyCodeExplanation {
  explanation: string
  importance: string
  application: string
}

export interface ProgressSummary {
  stepId: string
  summary: string
  keyCode: KeyCodeExplanation | null
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
  // 복습 퀴즈(SPEC 패치 v3): 세션에서 실제로 바뀐 코드 유닛마다 학습 카드(1분 학습 +
  // 문항 6개, 문항당 10초) 하나씩 생성.
  generateQuiz(versions: CodeUnitVersionWithUnit[], skillLevel: SkillLevel): Promise<QuizLesson[]>
}
